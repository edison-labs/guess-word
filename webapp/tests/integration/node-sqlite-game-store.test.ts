import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
          temperature: '高度相关',
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
});
