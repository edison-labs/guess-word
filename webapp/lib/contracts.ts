export type GameStatus = 'active' | 'won' | 'abandoned';
export type ScoringMode = 'test' | 'semantic';
export type GameMode = 'random' | 'daily';

export const GAME_CATEGORIES = [
  '动物',
  '食物',
  '职业',
  '自然现象',
  '抽象概念',
  '日常物品',
] as const;

export type GameCategory = (typeof GAME_CATEGORIES)[number];

export function isGameCategory(value: unknown): value is GameCategory {
  return typeof value === 'string' && GAME_CATEGORIES.some((category) => category === value);
}

export type Temperature =
  | '几乎无关'
  | '关联较弱'
  | '有些关联'
  | '关联较强'
  | '高度相关'
  | '非常接近'
  | '猜中';

export type PublicHint = {
  level: 1 | 2 | 3;
  label: string;
  value: string;
};

export type PublicGuess = {
  sequence: number;
  guess: string;
  score: number;
  temperature: Temperature;
  submittedAt: string;
};

export type PublicGame = {
  gameId: string;
  status: GameStatus;
  scoringMode: ScoringMode;
  mode?: GameMode;
  dailyDate?: string;
  category: GameCategory;
  startedAt: string;
  endedAt?: string;
  durationSeconds?: number;
  guessCount: number;
  hintCount: number;
  revealedHints: PublicHint[];
  guesses: PublicGuess[];
  bestGuess: PublicGuess | null;
  answer?: string;
};

export type CreateGameRequest = {
  category: GameCategory;
};

export type CreateGameResponse = {
  game: PublicGame;
  resumeToken: string;
};

export type GameResponse = { game: PublicGame };

export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'INVALID_REQUEST'
  | 'GAME_NOT_FOUND'
  | 'GAME_FINISHED'
  | 'DUPLICATE_GUESS'
  | 'HINTS_EXHAUSTED'
  | 'RATE_LIMITED'
  | 'SCORER_UNAVAILABLE'
  | 'CONFIGURATION_ERROR'
  | 'INTERNAL_ERROR';

export type ApiErrorBody = {
  error: {
    code: ApiErrorCode;
    message: string;
    retryable: boolean;
    field?: 'guess';
  };
};

export type StoredSession = {
  gameId: string;
  resumeToken: string;
};
