import { describe, expect, it, vi } from 'vitest';
import { GameError } from '../../lib/server/game-service';
import type { SemanticScorer } from '../../lib/server/scoring';
import { DeterministicSemanticScorer, SemanticScorerError } from '../../lib/server/scoring';
import { createTestHarness } from '../helpers';

describe('game service integration', () => {
  it('creates an opaque active game and restores it with the token', async () => {
    const { service } = createTestHarness();
    const created = await service.createGame('动物');
    expect(created.game).toMatchObject({
      status: 'active',
      category: '动物',
      guessCount: 0,
      hintCount: 0,
    });
    const serialized = JSON.stringify(created.game);
    expect(serialized).not.toContain('企鹅');
    expect(serialized).not.toContain('animal_penguin');
    expect(serialized).not.toContain('南极');
    expect(created.game.gameId).not.toContain('animal');
    expect(await service.restoreGame(created.game.gameId, created.resumeToken)).toEqual(created.game);
  });

  it('creates a dated daily challenge', async () => {
    const { service } = createTestHarness();
    const created = await service.createDailyGame();
    expect(created.game).toMatchObject({ mode: 'daily', dailyDate: '2026-08-30', status: 'active' });
  });

  it('keeps answer length private until six unsuccessful guesses', async () => {
    const { service } = createTestHarness();
    const created = await service.createGame('动物');
    expect(created.game).not.toHaveProperty('answerLength');

    const guesses = ['银行', '汽车', '鸟类', '海豹', '南极', '寒冷'];
    for (const [index, guess] of guesses.entries()) {
      const game = await service.submitGuess(created.game.gameId, created.resumeToken, guess);
      if (index < guesses.length - 1) expect(game).not.toHaveProperty('answerLength');
      else expect(game.answerLength).toBe(2);
    }
  });

  it('reuses a persistent semantic score across games and records feedback', async () => {
    const scorer: SemanticScorer = {
      cacheNamespace: 'test:model:v1',
      scoreNonExact: vi.fn(async () => ({
        scoreMilliPercent: 61_234,
        relationHint: '同为寒冷地区动物，但类别不同',
      })),
    };
    const { service } = createTestHarness(scorer);
    const first = await service.createGame('动物');
    const second = await service.createGame('动物');
    const firstResult = await service.submitGuess(first.game.gameId, first.resumeToken, '海豹');
    const secondResult = await service.submitGuess(second.game.gameId, second.resumeToken, '海豹');
    expect(scorer.scoreNonExact).toHaveBeenCalledTimes(1);
    expect(firstResult.guesses[0].relationHint).toBe('同为寒冷地区动物，但类别不同');
    expect(secondResult.guesses[0].relationHint).toBe(firstResult.guesses[0].relationHint);
    await service.submitScoreFeedback(first.game.gameId, first.resumeToken, '海豹', 'too_high');
    expect(await service.getAiStats()).toMatchObject({ cacheEntries: 1, feedbackCount: 1 });
  });

  it('submits guesses, updates the best guess, and caps non-exact scores', async () => {
    const scorer: SemanticScorer = { scoreNonExact: vi.fn(async () => 500_000) };
    const { service } = createTestHarness(scorer);
    const created = await service.createGame('动物');
    const updated = await service.submitGuess(created.game.gameId, created.resumeToken, '海豹');
    expect(updated.guesses[0]).toMatchObject({
      sequence: 1,
      guess: '海豹',
      score: 99.9,
      temperature: '非常接近',
    });
    expect(updated.status).toBe('active');
    expect(updated.bestGuess?.guess).toBe('海豹');
    expect(JSON.stringify(updated)).not.toContain('企鹅');
  });

  it('does not call the scorer or add a record for a normalized duplicate', async () => {
    const { service, scoreNonExact } = createTestHarness();
    const created = await service.createGame('动物');
    await service.submitGuess(created.game.gameId, created.resumeToken, ' 海豹 ');
    await expect(
      service.submitGuess(created.game.gameId, created.resumeToken, '海豹'),
    ).rejects.toMatchObject({ code: 'DUPLICATE_GUESS' });
    const restored = await service.restoreGame(created.game.gameId, created.resumeToken);
    expect(restored.guessCount).toBe(1);
    expect(scoreNonExact).toHaveBeenCalledTimes(1);
  });

  it('keeps unregistered deterministic guesses distinct through the public game response', async () => {
    const { service } = createTestHarness(new DeterministicSemanticScorer());
    const created = await service.createGame('动物');
    const first = await service.submitGuess(created.game.gameId, created.resumeToken, '桌子');
    const second = await service.submitGuess(created.game.gameId, created.resumeToken, '手机');

    expect(first.guesses[0].score).not.toBe(second.guesses[1].score);
    expect(second).toMatchObject({ status: 'active', scoringMode: 'test', guessCount: 2 });
  });

  it('exposes a configured AI scorer as semantic mode', async () => {
    const scorer: SemanticScorer = { scoreNonExact: vi.fn(async () => 73_527) };
    const { service } = createTestHarness(scorer, 'semantic');
    const created = await service.createGame('动物');
    const updated = await service.submitGuess(
      created.game.gameId,
      created.resumeToken,
      '海豹',
    );

    expect(updated).toMatchObject({ scoringMode: 'semantic', guessCount: 1 });
    expect(updated.guesses[0]).toMatchObject({ guess: '海豹', score: 73.527 });
  });

  it('reveals two progressively narrower hints and rejects a third', async () => {
    const { service } = createTestHarness();
    const created = await service.createGame('动物');
    const first = await service.useHint(created.game.gameId, created.resumeToken);
    expect(first.revealedHints).toEqual([{
      level: 1,
      label: '思考方向',
      value: '先从生活环境、活动方式和外形特征考虑',
    }]);
    const second = await service.useHint(created.game.gameId, created.resumeToken);
    expect(second.revealedHints).toHaveLength(2);
    expect(second.revealedHints[1]).toEqual({
      level: 2,
      label: '缩小范围',
      value: '再从寒冷环境的适应方式和活动区域缩小',
    });
    await expect(service.useHint(created.game.gameId, created.resumeToken)).rejects.toMatchObject({
      code: 'HINTS_EXHAUSTED',
    });
  });

  it('wins only on exact normalized input and then rejects further mutations', async () => {
    const { service, advance, scoreNonExact } = createTestHarness();
    const created = await service.createGame('动物');
    await service.submitGuess(created.game.gameId, created.resumeToken, '海豹');
    advance(65_000);
    const won = await service.submitGuess(created.game.gameId, created.resumeToken, ' 企鹅 ');
    expect(won.status).toBe('won');
    expect(won.answer).toBe('企鹅');
    expect(won.guesses.at(-1)?.score).toBe(100);
    expect(won.durationSeconds).toBe(65);
    expect(scoreNonExact).toHaveBeenCalledTimes(1);
    await expect(service.submitGuess(created.game.gameId, created.resumeToken, '动物')).rejects.toMatchObject({ code: 'GAME_FINISHED' });
    await expect(service.useHint(created.game.gameId, created.resumeToken)).rejects.toMatchObject({ code: 'GAME_FINISHED' });
  });

  it('abandons, reveals the answer, and prevents further guesses', async () => {
    const { service, advance } = createTestHarness();
    const created = await service.createGame('动物');
    advance(4_000);
    const abandoned = await service.abandon(created.game.gameId, created.resumeToken);
    expect(abandoned).toMatchObject({ status: 'abandoned', answer: '企鹅', durationSeconds: 4 });
    await expect(service.submitGuess(created.game.gameId, created.resumeToken, '海豹')).rejects.toMatchObject({ code: 'GAME_FINISHED' });
  });

  it('handles invalid credentials without revealing whether a game exists', async () => {
    const { service } = createTestHarness();
    const created = await service.createGame('动物');
    await expect(service.restoreGame('not-an-id', created.resumeToken)).rejects.toMatchObject({ code: 'GAME_NOT_FOUND' });
    await expect(service.restoreGame(created.game.gameId, 'wrong-token-value-123456789012345')).rejects.toMatchObject({ code: 'GAME_NOT_FOUND' });
  });

  it('keeps state unchanged when scoring fails and allows retry', async () => {
    let fails = true;
    const scorer: SemanticScorer = {
      async scoreNonExact() {
        if (fails) throw new Error('provider down');
        return 70_000;
      },
    };
    const { service } = createTestHarness(scorer);
    const created = await service.createGame('动物');
    await expect(service.submitGuess(created.game.gameId, created.resumeToken, '海豹')).rejects.toMatchObject({
      code: 'SCORER_UNAVAILABLE',
      retryable: true,
    });
    expect((await service.restoreGame(created.game.gameId, created.resumeToken)).guessCount).toBe(0);
    fails = false;
    expect((await service.submitGuess(created.game.gameId, created.resumeToken, '海豹')).guessCount).toBe(1);
  });

  it('reports rejected AI credentials as a non-retryable configuration error', async () => {
    const scorer: SemanticScorer = {
      async scoreNonExact() {
        throw new SemanticScorerError('denied', 'configuration', false);
      },
    };
    const { service } = createTestHarness(scorer);
    const created = await service.createGame('动物');

    await expect(
      service.submitGuess(created.game.gameId, created.resumeToken, '海豹'),
    ).rejects.toMatchObject({
      code: 'CONFIGURATION_ERROR',
      retryable: false,
    });
    expect((await service.restoreGame(created.game.gameId, created.resumeToken)).guessCount).toBe(0);
  });

  it('commits only one of two concurrent identical guesses', async () => {
    const scorer: SemanticScorer = {
      scoreNonExact: vi.fn(async () => {
        await Promise.resolve();
        return 80_000;
      }),
    };
    const { service } = createTestHarness(scorer);
    const created = await service.createGame('动物');
    const results = await Promise.allSettled([
      service.submitGuess(created.game.gameId, created.resumeToken, '海豹'),
      service.submitGuess(created.game.gameId, created.resumeToken, '海豹'),
    ]);
    expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((item) => item.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(GameError);
    expect(rejected.reason.code).toBe('DUPLICATE_GUESS');
    expect(scorer.scoreNonExact).toHaveBeenCalledTimes(1);
    expect((await service.restoreGame(created.game.gameId, created.resumeToken)).guessCount).toBe(1);
  });
});
