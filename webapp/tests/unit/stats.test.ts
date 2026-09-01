import { describe, expect, it } from 'vitest';
import type { PublicGame } from '../../lib/contracts';
import { EMPTY_STATS, parseLocalStats, recordCompletedGame } from '../../lib/stats';

function completedGame(overrides: Partial<PublicGame> = {}): PublicGame {
  return {
    gameId: crypto.randomUUID(),
    status: 'won',
    scoringMode: 'test',
    category: '动物',
    startedAt: new Date(0).toISOString(),
    endedAt: new Date(10_000).toISOString(),
    durationSeconds: 10,
    guessCount: 5,
    hintCount: 1,
    revealedHints: [],
    guesses: [],
    bestGuess: null,
    answer: '企鹅',
    ...overrides,
  };
}

describe('local statistics', () => {
  it('records wins without persisting the answer', () => {
    const next = recordCompletedGame(structuredClone(EMPTY_STATS), completedGame());
    expect(next.totalGames).toBe(1);
    expect(next.wonGames).toBe(1);
    expect(next.bestGuessCount).toBe(5);
    expect(JSON.stringify(next)).not.toContain('企鹅');
  });

  it('counts abandoned games but does not change the best win', () => {
    const won = recordCompletedGame(structuredClone(EMPTY_STATS), completedGame());
    const abandoned = recordCompletedGame(
      won,
      completedGame({ gameId: crypto.randomUUID(), status: 'abandoned', guessCount: 0 }),
    );
    expect(abandoned.totalGames).toBe(2);
    expect(abandoned.wonGames).toBe(1);
    expect(abandoned.bestGuessCount).toBe(5);
  });

  it('is idempotent and keeps only the latest 20 summaries', () => {
    let stats = structuredClone(EMPTY_STATS);
    const first = completedGame();
    stats = recordCompletedGame(stats, first);
    stats = recordCompletedGame(stats, first);
    expect(stats.totalGames).toBe(1);
    for (let index = 0; index < 25; index += 1) {
      stats = recordCompletedGame(stats, completedGame({ gameId: crypto.randomUUID() }));
    }
    expect(stats.recentGames).toHaveLength(20);
  });

  it('degrades safely for corrupted or answer-bearing data', () => {
    expect(parseLocalStats('{bad')).toEqual(EMPTY_STATS);
    const malicious = JSON.stringify({
      version: 1,
      totalGames: 1,
      wonGames: 1,
      bestGuessCount: 2,
      recentGames: [{ ...recordCompletedGame(EMPTY_STATS, completedGame()).recentGames[0], answer: '企鹅' }],
    });
    expect(parseLocalStats(malicious).recentGames).toEqual([]);
  });
});
