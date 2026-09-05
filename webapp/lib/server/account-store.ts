import type { GameMode, GameStatus } from '../contracts';

export type UserRecord = {
  id: string;
  phoneHash: string;
  phoneLast4: string;
  nickname: string;
  username?: string | null;
  passwordHash?: string | null;
  recoveryCodeHash?: string | null;
  createdAt: number;
  updatedAt: number;
};

export type AuthFailureRecord = {
  id: string;
  scopeKey: string;
  createdAt: number;
};

export type AccountSessionRecord = {
  id: string;
  tokenHash: string;
  playerId: string;
  userId: string | null;
  createdAt: number;
  expiresAt: number;
};

export type VerificationCodeRecord = {
  id: string;
  phoneHash: string;
  codeHash: string;
  createdAt: number;
  expiresAt: number;
  consumedAt: number | null;
  attempts: number;
};

export type OwnedGameResult = {
  gameId: string;
  ownerId: string;
  userId: string | null;
  nickname: string | null;
  questionId: string;
  category: string;
  status: GameStatus;
  mode: GameMode;
  dailyDate: string | null;
  challengeRootGameId: string | null;
  startedAt: number;
  endedAt: number;
  hintCount: number;
  guessCount: number;
};

export interface AccountStore {
  createAccountSession(session: AccountSessionRecord): Promise<void>;
  getAccountSessionByTokenHash(tokenHash: string): Promise<AccountSessionRecord | null>;
  updateAccountSession(
    id: string,
    tokenHash: string,
    playerId: string,
    userId: string | null,
    expiresAt: number,
  ): Promise<void>;
  deleteAccountSession(id: string): Promise<void>;
  deleteOtherAccountSessions(userId: string, exceptSessionId: string): Promise<void>;
  createVerificationCode(code: VerificationCodeRecord): Promise<void>;
  getLatestVerificationCode(phoneHash: string): Promise<VerificationCodeRecord | null>;
  countVerificationCodes(phoneHash: string, since: number): Promise<number>;
  incrementVerificationAttempts(id: string): Promise<void>;
  consumeVerificationCode(id: string, consumedAt: number): Promise<boolean>;
  getUserById(id: string): Promise<UserRecord | null>;
  getUserByPhoneHash(phoneHash: string): Promise<UserRecord | null>;
  getUserByUsername(username: string): Promise<UserRecord | null>;
  createUser(user: UserRecord): Promise<void>;
  updateUserCredentials(id: string, passwordHash: string, recoveryCodeHash: string, updatedAt: number): Promise<void>;
  countAuthFailures(scopeKey: string, since: number): Promise<number>;
  recordAuthFailure(record: AuthFailureRecord): Promise<void>;
  clearAuthFailures(scopeKey: string): Promise<void>;
  updateUserNickname(id: string, nickname: string, updatedAt: number): Promise<void>;
  mergeGameOwner(fromPlayerId: string, toUserId: string): Promise<void>;
  listOwnedGameResults(ownerId: string, limit: number): Promise<OwnedGameResult[]>;
  listDailyGameResults(date: string): Promise<OwnedGameResult[]>;
  listChallengeGameResults(rootGameId: string): Promise<OwnedGameResult[]>;
}
