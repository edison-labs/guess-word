export type GameStatus = 'active' | 'won' | 'abandoned';
export type ScoringMode = 'test' | 'semantic';
export type GameMode = 'random' | 'daily';
export const MAX_HINT_COUNT = 2;
export const ANSWER_LENGTH_UNLOCK_GUESSES = 6;

export const GAME_CATEGORIES = [
  '动物',
  '食物',
  '职业',
  '自然现象',
  '抽象概念',
  '日常物品',
  '历史人物',
  '体育圈',
] as const;

export type GameCategory = (typeof GAME_CATEGORIES)[number];

export function isGameCategory(value: unknown): value is GameCategory {
  return typeof value === 'string' && GAME_CATEGORIES.some((category) => category === value);
}

export type Temperature =
  | '关系较远'
  | '同类线索'
  | '方向接近'
  | '明显相关'
  | '强关系'
  | '非常接近'
  | '猜中';

export type PublicHint = {
  level: 1 | 2;
  label: string;
  value: string;
};

export type PublicGuess = {
  sequence: number;
  guess: string;
  score: number;
  temperature: Temperature;
  relationHint: string;
  submittedAt: string;
};

export type PublicGame = {
  gameId: string;
  status: GameStatus;
  scoringMode: ScoringMode;
  mode?: GameMode;
  dailyDate?: string;
  category: GameCategory;
  answerLength?: number;
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
  excludeGameIds?: string[];
};

export type CreateChallengeGameRequest = {
  sourceGameId: string;
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
  | 'SMS_UNAVAILABLE'
  | 'CONFIGURATION_ERROR'
  | 'AUTH_REQUIRED'
  | 'INTERNAL_ERROR';

export type ApiErrorBody = {
  error: {
    code: ApiErrorCode;
    message: string;
    retryable: boolean;
    field?: 'guess' | 'username' | 'password';
  };
};

export type StoredSession = {
  gameId: string;
  resumeToken: string;
};

export type AccountUser = {
  id: string;
  nickname: string;
  username?: string;
  maskedPhone?: string;
  createdAt: string;
};

export type ViewerResponse = {
  authenticated: boolean;
  user: AccountUser | null;
};

export type CredentialAuthResponse = {
  viewer: ViewerResponse;
  recoveryCode?: string;
};

export type AccountGameSummary = {
  gameId: string;
  category: GameCategory;
  mode: GameMode;
  dailyDate?: string;
  status: Exclude<GameStatus, 'active'>;
  answer: string;
  guessCount: number;
  hintCount: number;
  durationSeconds: number;
  endedAt: string;
};

export type AccountDashboardResponse = {
  user: AccountUser;
  stats: {
    completedGames: number;
    wonGames: number;
    bestGuessCount: number | null;
    dailyStreak: number;
  };
  recentGames: AccountGameSummary[];
};

export type LeaderboardEntry = {
  rank: number;
  nickname: string;
  guessCount: number;
  hintCount: number;
  durationSeconds: number;
  completedAt: string;
  isCurrentUser: boolean;
};

export type LeaderboardResponse = {
  kind: 'daily' | 'challenge';
  title: string;
  entries: LeaderboardEntry[];
  participantCount: number;
  currentUserEntry: LeaderboardEntry | null;
};

export type QuestionProgressResponse = {
  categories: Record<GameCategory, { seen: number; total: number }>;
};
