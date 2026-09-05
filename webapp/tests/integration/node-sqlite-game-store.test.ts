import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { GameRecord } from '../../lib/server/game-store';
import { NodeSqliteGameStore } from '../../lib/server/node-sqlite-game-store';

const createdDirectories: string[] = [];
const openStores: NodeSqliteGameStore[] = [];

afterEach(() => {
  for (const store of openStores.splice(0)) store.close();
  for (const directory of createdDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createStore(): { store: NodeSqliteGameStore; databasePath: string } {
  const directory = mkdtempSync(join(tmpdir(), 'guess-word-sqlite-'));
  createdDirectories.push(directory);
  const databasePath = join(directory, 'game.sqlite');
  const store = new NodeSqliteGameStore(databasePath);
  openStores.push(store);
  return { store, databasePath };
}

function game(id = 'game-1'): GameRecord {
  return {
    id,
    resumeTokenHash: 'hash',
    questionId: 'animal_penguin',
    category: '动物',
    status: 'active',
    startedAt: 1_000,
    endedAt: null,
    hintCount: 0,
  };
}

describe('NodeSqliteGameStore', () => {
  it('persists games and guesses after reopening the database', async () => {
    const { store, databasePath } = createStore();
    await store.createGame(game());
    expect(await store.claimGuess('game-1', '海豹', 'claim-1', 2_000, 0)).toBe('claimed');
    expect(
      await store.commitGuess(
        'game-1',
        {
          normalizedGuess: '海豹',
          displayGuess: '海豹',
          scoreMilliPercent: 88_719,
          temperature: '非常接近',
          relationHint: '同为寒冷地区动物，但类别不同',
          createdAt: 2_100,
        },
        false,
        'claim-1',
      ),
    ).toBe('created');
    store.close();
    openStores.splice(openStores.indexOf(store), 1);

    const reopened = new NodeSqliteGameStore(databasePath);
    openStores.push(reopened);
    expect(await reopened.getGame('game-1')).toMatchObject({ status: 'active', category: '动物' });
    expect(await reopened.getGuesses('game-1')).toEqual([
      expect.objectContaining({ displayGuess: '海豹', scoreMilliPercent: 88_719, sequence: 1 }),
    ]);
  });

  it('allows only one active claim for the same normalized guess', async () => {
    const { store } = createStore();
    await store.createGame(game());
    const results = await Promise.all([
      store.claimGuess('game-1', '南极', 'claim-a', 2_000, 0),
      store.claimGuess('game-1', '南极', 'claim-b', 2_001, 0),
    ]);
    expect(results).toEqual(['claimed', 'in-flight']);
  });

  it('persists hint and terminal state transitions', async () => {
    const { store } = createStore();
    await store.createGame(game());
    expect(await store.useHint('game-1')).toBe(1);
    expect(await store.abandon('game-1', 5_000)).toBe('finished');
    expect(await store.getGame('game-1')).toMatchObject({
      status: 'abandoned',
      hintCount: 1,
      endedAt: 5_000,
    });
    expect(await store.useHint('game-1')).toBe('finished');
  });

  it('atomically resumes one daily game and persists category progress', async () => {
    const { store } = createStore();
    const daily = { ...game('daily-1'), ownerId: 'player-1', mode: 'daily' as const, dailyDate: '2026-09-05' };
    expect((await store.createOrResumeDailyGame(daily)).id).toBe('daily-1');
    const resumed = await store.createOrResumeDailyGame({ ...daily, id: 'daily-2', resumeTokenHash: 'new-hash' });
    expect(resumed).toMatchObject({ id: 'daily-1', resumeTokenHash: 'hash' });
    expect(await store.hasGameAccessToken('daily-1', 'new-hash')).toBe(true);
    expect(await store.getGame('daily-2')).toBeNull();

    await store.recordQuestionSeen('player-1', '动物', 'animal_penguin', 1_000);
    await store.recordQuestionSeen('player-1', '动物', 'animal_panda', 2_000);
    expect(await store.getSeenQuestionIds('player-1', '动物')).toEqual(['animal_penguin', 'animal_panda']);
    expect(await store.getQuestionProgressCounts('player-1')).toEqual({ 动物: 2 });
    await store.resetQuestionProgress('player-1', '动物');
    expect(await store.getQuestionProgressCounts('player-1')).toEqual({});
  });

  it('persists AI cache, usage totals and score feedback', async () => {
    const { store } = createStore();
    await store.createGame(game());
    await store.putSemanticScore('deepseek:model:v4', 'animal_penguin', '海豹', { scoreMilliPercent: 72_345, relationHint: '同为寒冷地区动物' }, 2_000);
    await store.recordAiUsage({ id: 'usage-1', providerKey: 'deepseek:model:v4', questionId: 'animal_penguin', normalizedGuess: '海豹', promptTokens: 100, cachedPromptTokens: 80, completionTokens: 12, latencyMs: 300, estimatedCostMicrousd: 7, createdAt: 2_000 });
    await store.recordScoreFeedback('game-1', '海豹', 'too_low', 2_100);
    expect(await store.getSemanticScore('deepseek:model:v4', 'animal_penguin', '海豹')).toEqual({ scoreMilliPercent: 72_345, relationHint: '同为寒冷地区动物' });
    expect(await store.getAiStats()).toEqual({ requests: 1, promptTokens: 100, cachedPromptTokens: 80, completionTokens: 12, estimatedCostUsd: 0.000007, cacheEntries: 1, feedbackCount: 1 });
  });

  it('upgrades a legacy database without deleting existing games or guesses', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'guess-word-legacy-'));
    createdDirectories.push(directory);
    const databasePath = join(directory, 'game.sqlite');
    const legacy = new DatabaseSync(databasePath);
    legacy.exec(`
      CREATE TABLE games (
        id TEXT PRIMARY KEY NOT NULL, resume_token_hash TEXT NOT NULL,
        question_id TEXT NOT NULL, category TEXT NOT NULL, status TEXT NOT NULL,
        started_at INTEGER NOT NULL, ended_at INTEGER, hint_count INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE guesses (
        game_id TEXT NOT NULL, normalized_guess TEXT NOT NULL, display_guess TEXT NOT NULL,
        score_tenths INTEGER NOT NULL, temperature TEXT NOT NULL, sequence INTEGER NOT NULL,
        created_at INTEGER NOT NULL, PRIMARY KEY (game_id, normalized_guess), UNIQUE (game_id, sequence)
      );
      INSERT INTO games VALUES ('legacy-game', 'hash', 'animal_penguin', '动物', 'active', 1000, NULL, 0);
      INSERT INTO guesses VALUES ('legacy-game', '海豹', '海豹', 727, '明显相关', 1, 2000);
    `);
    legacy.close();

    const store = new NodeSqliteGameStore(databasePath);
    openStores.push(store);
    await store.init();
    expect(await store.getGame('legacy-game')).toMatchObject({
      mode: 'random', ownerId: null, challengeRootGameId: null,
    });
    expect(await store.getGuesses('legacy-game')).toEqual([
      expect.objectContaining({ scoreMilliPercent: 72_700, relationHint: '' }),
    ]);
  });

  it('persists users, sessions, ownership and leaderboard result fields', async () => {
    const { store } = createStore();
    await store.createUser({
      id: 'user-1', phoneHash: 'phone-hash', phoneLast4: '8000', nickname: '测试玩家',
      createdAt: 1_000, updatedAt: 1_000,
    });
    await store.createAccountSession({
      id: 'session-1', tokenHash: 'token-hash', playerId: 'guest-1', userId: null,
      createdAt: 1_000, expiresAt: 9_000,
    });
    await store.createGame({ ...game(), ownerId: 'guest-1' });
    await store.abandon('game-1', 3_000);
    await store.mergeGameOwner('guest-1', 'user-1');

    expect(await store.getUserByPhoneHash('phone-hash')).toMatchObject({ nickname: '测试玩家' });
    expect(await store.getAccountSessionByTokenHash('token-hash')).toMatchObject({ playerId: 'guest-1' });
    expect(await store.listOwnedGameResults('user-1', 10)).toEqual([
      expect.objectContaining({ gameId: 'game-1', nickname: '测试玩家', status: 'abandoned' }),
    ]);
  });

  it('persists username credentials and account-scoped auth failures', async () => {
    const { store } = createStore();
    await store.createUser({
      id: 'local-user', phoneHash: 'synthetic-phone', phoneLast4: '', nickname: '本地玩家',
      username: 'local_player', passwordHash: 'password-hash', recoveryCodeHash: 'recovery-hash',
      createdAt: 1_000, updatedAt: 1_000,
    });
    expect(await store.getUserByUsername('local_player')).toMatchObject({ passwordHash: 'password-hash', phoneLast4: '' });
    await store.updateUserCredentials('local-user', 'new-password-hash', 'new-recovery-hash', 2_000);
    expect(await store.getUserById('local-user')).toMatchObject({ passwordHash: 'new-password-hash', recoveryCodeHash: 'new-recovery-hash', updatedAt: 2_000 });

    await store.recordAuthFailure({ id: 'failure-1', scopeKey: 'scope', createdAt: 2_100 });
    expect(await store.countAuthFailures('scope', 2_000)).toBe(1);
    await store.clearAuthFailures('scope');
    expect(await store.countAuthFailures('scope', 0)).toBe(0);
  });
});
