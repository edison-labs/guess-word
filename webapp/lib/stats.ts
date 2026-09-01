import type { PublicGame } from './contracts';

export type LocalGameSummary = {
  gameId: string;
  category: string;
  status: 'won' | 'abandoned';
  guessCount: number;
  hintCount: number;
  durationSeconds: number;
  bestScore: number | null;
  endedAt: string;
};

export type LocalStats = {
  version: 1;
  totalGames: number;
  wonGames: number;
  bestGuessCount: number | null;
  recentGames: LocalGameSummary[];
};

export const EMPTY_STATS: LocalStats = {
  version: 1,
  totalGames: 0,
  wonGames: 0,
  bestGuessCount: null,
  recentGames: [],
};

export function parseLocalStats(raw: string | null): LocalStats {
  if (!raw) return structuredClone(EMPTY_STATS);
  try {
    const parsed = JSON.parse(raw) as Partial<LocalStats>;
    if (
      parsed.version !== 1 ||
      !Number.isInteger(parsed.totalGames) ||
      !Number.isInteger(parsed.wonGames) ||
      !Array.isArray(parsed.recentGames)
    ) {
      return structuredClone(EMPTY_STATS);
    }
    const recentGames = parsed.recentGames
      .filter(isSafeSummary)
      .slice(0, 20);
    return {
      version: 1,
      totalGames: Math.max(0, parsed.totalGames ?? 0),
      wonGames: Math.max(0, parsed.wonGames ?? 0),
      bestGuessCount:
        parsed.bestGuessCount === null ||
        (Number.isInteger(parsed.bestGuessCount) && (parsed.bestGuessCount ?? 0) > 0)
          ? parsed.bestGuessCount ?? null
          : null,
      recentGames,
    };
  } catch {
    return structuredClone(EMPTY_STATS);
  }
}

function isSafeSummary(value: unknown): value is LocalGameSummary {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.gameId === 'string' &&
    typeof item.category === 'string' &&
    (item.status === 'won' || item.status === 'abandoned') &&
    Number.isInteger(item.guessCount) &&
    Number.isInteger(item.hintCount) &&
    Number.isFinite(item.durationSeconds) &&
    typeof item.endedAt === 'string' &&
    !('answer' in item)
  );
}

export function recordCompletedGame(stats: LocalStats, game: PublicGame): LocalStats {
  if (game.status === 'active' || !game.endedAt || game.durationSeconds === undefined) {
    return stats;
  }
  if (stats.recentGames.some((item) => item.gameId === game.gameId)) {
    return stats;
  }

  const summary: LocalGameSummary = {
    gameId: game.gameId,
    category: game.category,
    status: game.status,
    guessCount: game.guessCount,
    hintCount: game.hintCount,
    durationSeconds: game.durationSeconds,
    bestScore: game.bestGuess?.score ?? null,
    endedAt: game.endedAt,
  };
  const won = game.status === 'won';
  return {
    version: 1,
    totalGames: stats.totalGames + 1,
    wonGames: stats.wonGames + (won ? 1 : 0),
    bestGuessCount: won
      ? stats.bestGuessCount === null
        ? game.guessCount
        : Math.min(stats.bestGuessCount, game.guessCount)
      : stats.bestGuessCount,
    recentGames: [summary, ...stats.recentGames].slice(0, 20),
  };
}
