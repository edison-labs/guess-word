import type { PublicGame } from './contracts';

export type LocalGameSummary = {
  gameId: string;
  category: string;
  mode?: 'random' | 'daily';
  dailyDate?: string;
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
  lastDailyGame: LocalGameSummary | null;
  recentGames: LocalGameSummary[];
};

export const EMPTY_STATS: LocalStats = {
  version: 1,
  totalGames: 0,
  wonGames: 0,
  bestGuessCount: null,
  lastDailyGame: null,
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
      lastDailyGame:
        isSafeSummary(parsed.lastDailyGame) &&
        parsed.lastDailyGame.mode === 'daily' &&
        parsed.lastDailyGame.dailyDate
          ? parsed.lastDailyGame
          : recentGames.find((item) => item.mode === 'daily' && item.dailyDate) ?? null,
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
    (item.mode === undefined || item.mode === 'random' || item.mode === 'daily') &&
    (item.dailyDate === undefined ||
      (typeof item.dailyDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.dailyDate))) &&
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
  const existingIndex = stats.recentGames.findIndex((item) => item.gameId === game.gameId);
  if (existingIndex >= 0) {
    const existing = stats.recentGames[existingIndex];
    const mode = game.mode ?? existing.mode;
    const dailyDate = game.dailyDate ?? existing.dailyDate;
    const shouldRememberDaily = mode === 'daily' && Boolean(dailyDate);
    if (
      existing.mode === mode &&
      existing.dailyDate === dailyDate &&
      (!shouldRememberDaily || stats.lastDailyGame?.gameId === game.gameId)
    ) return stats;

    const recentGames = [...stats.recentGames];
    const enriched = {
      ...existing,
      ...(mode ? { mode } : {}),
      ...(dailyDate ? { dailyDate } : {}),
    };
    recentGames[existingIndex] = enriched;
    return {
      ...stats,
      lastDailyGame: shouldRememberDaily ? enriched : stats.lastDailyGame,
      recentGames,
    };
  }

  const summary: LocalGameSummary = {
    gameId: game.gameId,
    category: game.category,
    mode: game.mode ?? 'random',
    ...(game.dailyDate ? { dailyDate: game.dailyDate } : {}),
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
    lastDailyGame: summary.mode === 'daily' && summary.dailyDate ? summary : stats.lastDailyGame,
    recentGames: [summary, ...stats.recentGames].slice(0, 20),
  };
}
