import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { GameMode, GameStatus, Temperature } from '../contracts';
import type {
  AccountSessionRecord,
  AccountStore,
  AuthFailureRecord,
  OwnedGameResult,
  UserRecord,
  VerificationCodeRecord,
} from './account-store';
import type {
  ClaimGuessResult,
  CommitGuessResult,
  FinishMutationResult,
  GameRecord,
  GameStore,
  GuessRecord,
  HintMutationResult,
  AiStats,
  AiUsageRecord,
  SemanticScoreRecord,
} from './game-store';

type GameRow = {
  id: string;
  resume_token_hash: string;
  question_id: string;
  category: string;
  status: GameStatus;
  started_at: number;
  ended_at: number | null;
  hint_count: number;
  mode: GameMode;
  daily_date: string | null;
  owner_id: string | null;
  challenge_root_game_id: string | null;
};

type GuessRow = {
  game_id: string;
  normalized_guess: string;
  display_guess: string;
  score_milli_percent: number;
  temperature: Temperature;
  relation_hint: string;
  sequence: number;
  created_at: number;
};

type AccountSessionRow = {
  id: string; token_hash: string; player_id: string; user_id: string | null;
  created_at: number; expires_at: number;
};
type VerificationCodeRow = {
  id: string; phone_hash: string; code_hash: string; created_at: number;
  expires_at: number; consumed_at: number | null; attempts: number;
};
type UserRow = {
  id: string; phone_hash: string; phone_last4: string; nickname: string;
  username: string | null; password_hash: string | null; recovery_code_hash: string | null;
  created_at: number; updated_at: number;
};
type OwnedGameRow = {
  game_id: string; owner_id: string; user_id: string | null; nickname: string | null;
  question_id: string; category: string; status: GameStatus; mode: GameMode;
  daily_date: string | null; challenge_root_game_id: string | null;
  started_at: number; ended_at: number; hint_count: number; guess_count: number;
};

const ACCOUNT_GAME_SELECT = `SELECT
  g.id game_id, g.owner_id, u.id user_id, u.nickname, g.question_id, g.category,
  g.status, g.mode, g.daily_date, g.challenge_root_game_id, g.started_at, g.ended_at,
  g.hint_count, (SELECT COUNT(*) FROM guesses q WHERE q.game_id = g.id) guess_count
  FROM games g LEFT JOIN users u ON u.id = g.owner_id`;

/**
 * Single-ECS persistent store for the Alibaba Cloud deployment path.
 * SQLite WAL plus BEGIN IMMEDIATE keeps claims and result commits atomic even
 * when multiple requests arrive together. The database lives on a Docker
 * volume and is not included in the application image.
 */
export class NodeSqliteGameStore implements GameStore, AccountStore {
  private readonly db: DatabaseSync;
  private initialized = false;

  constructor(databasePath: string) {
    if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true });
    this.db = new DatabaseSync(databasePath);
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA busy_timeout = 5000;
    `);
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS games (
        id TEXT PRIMARY KEY NOT NULL,
        resume_token_hash TEXT NOT NULL,
        question_id TEXT NOT NULL,
        category TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active', 'won', 'abandoned')),
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        hint_count INTEGER NOT NULL DEFAULT 0 CHECK (hint_count BETWEEN 0 AND 3)
        ,mode TEXT NOT NULL DEFAULT 'random' CHECK (mode IN ('random','daily'))
        ,daily_date TEXT
        ,owner_id TEXT
        ,challenge_root_game_id TEXT
      );
      CREATE TABLE IF NOT EXISTS guesses (
        game_id TEXT NOT NULL,
        normalized_guess TEXT NOT NULL,
        display_guess TEXT NOT NULL,
        score_tenths INTEGER NOT NULL CHECK (score_tenths BETWEEN 0 AND 1000),
        score_milli_percent INTEGER NOT NULL DEFAULT 0 CHECK (score_milli_percent BETWEEN 0 AND 100000),
        temperature TEXT NOT NULL,
        relation_hint TEXT NOT NULL DEFAULT '',
        sequence INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (game_id, normalized_guess),
        UNIQUE (game_id, sequence),
        FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS guess_claims (
        game_id TEXT NOT NULL,
        normalized_guess TEXT NOT NULL,
        claim_token TEXT NOT NULL,
        claimed_at INTEGER NOT NULL,
        PRIMARY KEY (game_id, normalized_guess),
        FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS semantic_scores (
        provider_key TEXT NOT NULL, question_id TEXT NOT NULL, normalized_guess TEXT NOT NULL,
        score_milli_percent INTEGER NOT NULL CHECK (score_milli_percent BETWEEN 0 AND 100000),
        relation_hint TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL, PRIMARY KEY (provider_key, question_id, normalized_guess)
      );
      CREATE TABLE IF NOT EXISTS ai_usage (
        id TEXT PRIMARY KEY NOT NULL, provider_key TEXT NOT NULL, question_id TEXT NOT NULL,
        normalized_guess TEXT NOT NULL, prompt_tokens INTEGER NOT NULL, cached_prompt_tokens INTEGER NOT NULL,
        completion_tokens INTEGER NOT NULL, latency_ms INTEGER NOT NULL,
        estimated_cost_microusd INTEGER NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS score_feedback (
        game_id TEXT NOT NULL, normalized_guess TEXT NOT NULL,
        direction TEXT NOT NULL CHECK (direction IN ('too_high','too_low')), created_at INTEGER NOT NULL,
        PRIMARY KEY (game_id, normalized_guess), FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY NOT NULL, phone_hash TEXT NOT NULL UNIQUE, phone_last4 TEXT NOT NULL,
        nickname TEXT NOT NULL, username TEXT, password_hash TEXT, recovery_code_hash TEXT,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS auth_failures (
        id TEXT PRIMARY KEY NOT NULL, scope_key TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS account_sessions (
        id TEXT PRIMARY KEY NOT NULL, token_hash TEXT NOT NULL UNIQUE, player_id TEXT NOT NULL,
        user_id TEXT, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE TABLE IF NOT EXISTS verification_codes (
        id TEXT PRIMARY KEY NOT NULL, phone_hash TEXT NOT NULL, code_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, consumed_at INTEGER,
        attempts INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS daily_participations (
        owner_id TEXT NOT NULL, daily_date TEXT NOT NULL, game_id TEXT NOT NULL,
        created_at INTEGER NOT NULL, PRIMARY KEY (owner_id, daily_date),
        FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS question_progress (
        owner_id TEXT NOT NULL, category TEXT NOT NULL, question_id TEXT NOT NULL,
        played_at INTEGER NOT NULL, PRIMARY KEY (owner_id, category, question_id)
      );
      CREATE TABLE IF NOT EXISTS game_access_tokens (
        game_id TEXT NOT NULL, token_hash TEXT NOT NULL, created_at INTEGER NOT NULL,
        PRIMARY KEY (game_id, token_hash), FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_account_sessions_token ON account_sessions(token_hash);
      CREATE INDEX IF NOT EXISTS idx_verification_phone_created ON verification_codes(phone_hash, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_question_progress_owner_category ON question_progress(owner_id, category);
      CREATE INDEX IF NOT EXISTS idx_daily_participations_game ON daily_participations(game_id);
      CREATE INDEX IF NOT EXISTS idx_guesses_game_sequence
        ON guesses(game_id, sequence);
      CREATE INDEX IF NOT EXISTS idx_guesses_game_score
        ON guesses(game_id, score_tenths DESC, sequence);
      CREATE INDEX IF NOT EXISTS idx_auth_failures_scope_created
        ON auth_failures(scope_key, created_at);
    `);

    const columns = this.db.prepare('PRAGMA table_info(guesses)').all() as Array<{ name: string }>;
    const gameColumns = this.db.prepare('PRAGMA table_info(games)').all() as Array<{ name: string }>;
    const userColumns = this.db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>;
    if (!userColumns.some((column) => column.name === 'username')) this.db.exec('ALTER TABLE users ADD COLUMN username TEXT');
    if (!userColumns.some((column) => column.name === 'password_hash')) this.db.exec('ALTER TABLE users ADD COLUMN password_hash TEXT');
    if (!userColumns.some((column) => column.name === 'recovery_code_hash')) this.db.exec('ALTER TABLE users ADD COLUMN recovery_code_hash TEXT');
    this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username)');
    if (!gameColumns.some((column) => column.name === 'mode')) this.db.exec("ALTER TABLE games ADD COLUMN mode TEXT NOT NULL DEFAULT 'random'");
    if (!gameColumns.some((column) => column.name === 'daily_date')) this.db.exec('ALTER TABLE games ADD COLUMN daily_date TEXT');
    if (!gameColumns.some((column) => column.name === 'owner_id')) this.db.exec('ALTER TABLE games ADD COLUMN owner_id TEXT');
    if (!gameColumns.some((column) => column.name === 'challenge_root_game_id')) this.db.exec('ALTER TABLE games ADD COLUMN challenge_root_game_id TEXT');
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_games_owner_ended ON games(owner_id, ended_at DESC);
      CREATE INDEX IF NOT EXISTS idx_games_daily_rank ON games(daily_date, started_at);
      CREATE INDEX IF NOT EXISTS idx_games_challenge_rank ON games(challenge_root_game_id, started_at);
    `);
    if (!columns.some((column) => column.name === 'score_milli_percent')) {
      this.db.exec('ALTER TABLE guesses ADD COLUMN score_milli_percent INTEGER NOT NULL DEFAULT 0');
    }
    if (!columns.some((column) => column.name === 'relation_hint')) {
      this.db.exec("ALTER TABLE guesses ADD COLUMN relation_hint TEXT NOT NULL DEFAULT ''");
    }
    const semanticColumns = this.db.prepare('PRAGMA table_info(semantic_scores)').all() as Array<{ name: string }>;
    if (!semanticColumns.some((column) => column.name === 'relation_hint')) {
      this.db.exec("ALTER TABLE semantic_scores ADD COLUMN relation_hint TEXT NOT NULL DEFAULT ''");
    }
    this.db.exec(`
      UPDATE guesses
      SET score_milli_percent = score_tenths * 100
      WHERE score_milli_percent = 0 AND score_tenths != 0;
      CREATE INDEX IF NOT EXISTS idx_guesses_game_score_milli
        ON guesses(game_id, score_milli_percent DESC, sequence);
      PRAGMA optimize;
    `);
    this.initialized = true;
  }

  close(): void {
    this.db.close();
  }

  async createGame(game: GameRecord): Promise<void> {
    await this.init();
    this.insertGame(game);
  }

  private insertGame(game: GameRecord): void {
    this.db.prepare(`
      INSERT INTO games (
        id, resume_token_hash, question_id, category, status, started_at, ended_at,
        hint_count, mode, daily_date, owner_id, challenge_root_game_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      game.id,
      game.resumeTokenHash,
      game.questionId,
      game.category,
      game.status,
      game.startedAt,
      game.endedAt,
      game.hintCount,
      game.mode ?? 'random',
      game.dailyDate ?? null,
      game.ownerId ?? null,
      game.challengeRootGameId ?? null,
    );
  }

  async createOrResumeDailyGame(game: GameRecord): Promise<GameRecord> {
    await this.init();
    if (!game.ownerId || !game.dailyDate) {
      await this.createGame(game);
      return game;
    }
    const ownerId = game.ownerId;
    const dailyDate = game.dailyDate;
    return this.transaction(() => {
      let existing = this.db.prepare(`SELECT g.* FROM daily_participations d
        JOIN games g ON g.id = d.game_id WHERE d.owner_id = ? AND d.daily_date = ?`)
        .get(ownerId, dailyDate) as GameRow | undefined;
      if (!existing) {
        existing = this.db.prepare(`SELECT * FROM games WHERE owner_id = ? AND daily_date = ?
          ORDER BY started_at ASC LIMIT 1`).get(ownerId, dailyDate) as GameRow | undefined;
      }
      if (existing) {
        this.db.prepare(`INSERT OR IGNORE INTO daily_participations
          (owner_id, daily_date, game_id, created_at) VALUES (?, ?, ?, ?)`)
          .run(ownerId, dailyDate, existing.id, existing.started_at);
        this.db.prepare(`INSERT OR IGNORE INTO game_access_tokens
          (game_id, token_hash, created_at) VALUES (?, ?, ?)`)
          .run(existing.id, game.resumeTokenHash, game.startedAt);
        return mapGame(existing);
      }
      this.insertGame(game);
      this.db.prepare(`INSERT INTO daily_participations
        (owner_id, daily_date, game_id, created_at) VALUES (?, ?, ?, ?)`)
        .run(ownerId, dailyDate, game.id, game.startedAt);
      return game;
    });
  }

  async hasGameAccessToken(gameId: string, tokenHash: string): Promise<boolean> {
    await this.init();
    return Boolean(this.db.prepare(`SELECT 1 found FROM game_access_tokens
      WHERE game_id = ? AND token_hash = ?`).get(gameId, tokenHash));
  }

  async getSeenQuestionIds(ownerId: string, category: string): Promise<string[]> {
    await this.init();
    return (this.db.prepare(`SELECT question_id FROM question_progress
      WHERE owner_id = ? AND category = ? ORDER BY played_at`).all(ownerId, category) as Array<{ question_id: string }>)
      .map((row) => row.question_id);
  }

  async recordQuestionSeen(ownerId: string, category: string, questionId: string, playedAt: number): Promise<void> {
    await this.init();
    this.db.prepare(`INSERT OR IGNORE INTO question_progress
      (owner_id, category, question_id, played_at) VALUES (?, ?, ?, ?)`)
      .run(ownerId, category, questionId, playedAt);
  }

  async resetQuestionProgress(ownerId: string, category: string): Promise<void> {
    await this.init();
    this.db.prepare('DELETE FROM question_progress WHERE owner_id = ? AND category = ?').run(ownerId, category);
  }

  async getQuestionProgressCounts(ownerId: string): Promise<Record<string, number>> {
    await this.init();
    const rows = this.db.prepare(`SELECT category, COUNT(*) count FROM question_progress
      WHERE owner_id = ? GROUP BY category`).all(ownerId) as Array<{ category: string; count: number }>;
    return Object.fromEntries(rows.map((row) => [row.category, row.count]));
  }

  async getGame(id: string): Promise<GameRecord | null> {
    await this.init();
    const row = this.db.prepare('SELECT * FROM games WHERE id = ?').get(id) as GameRow | undefined;
    return row ? mapGame(row) : null;
  }

  async getGuesses(gameId: string): Promise<GuessRecord[]> {
    await this.init();
    const rows = this.db
      .prepare('SELECT * FROM guesses WHERE game_id = ? ORDER BY sequence ASC')
      .all(gameId) as GuessRow[];
    return rows.map(mapGuess);
  }

  async hasGuess(gameId: string, normalizedGuess: string): Promise<boolean> {
    await this.init();
    return Boolean(
      this.db
        .prepare('SELECT 1 AS found FROM guesses WHERE game_id = ? AND normalized_guess = ?')
        .get(gameId, normalizedGuess),
    );
  }

  async claimGuess(
    gameId: string,
    normalizedGuess: string,
    claimToken: string,
    claimedAt: number,
    staleBefore: number,
  ): Promise<ClaimGuessResult> {
    await this.init();
    return this.transaction(() => {
      const game = this.getGameSync(gameId);
      if (!game) return 'missing';
      if (game.status !== 'active') return 'finished';
      if (this.hasGuessSync(gameId, normalizedGuess)) return 'duplicate';

      const existing = this.db
        .prepare('SELECT claimed_at FROM guess_claims WHERE game_id = ? AND normalized_guess = ?')
        .get(gameId, normalizedGuess) as { claimed_at: number } | undefined;
      if (existing && existing.claimed_at > staleBefore) return 'in-flight';

      this.db.prepare(`
        INSERT INTO guess_claims (game_id, normalized_guess, claim_token, claimed_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(game_id, normalized_guess) DO UPDATE SET
          claim_token = excluded.claim_token,
          claimed_at = excluded.claimed_at
      `).run(gameId, normalizedGuess, claimToken, claimedAt);
      return 'claimed';
    });
  }

  async releaseGuessClaim(
    gameId: string,
    normalizedGuess: string,
    claimToken: string,
  ): Promise<void> {
    await this.init();
    this.db.prepare(`
      DELETE FROM guess_claims
      WHERE game_id = ? AND normalized_guess = ? AND claim_token = ?
    `).run(gameId, normalizedGuess, claimToken);
  }

  async commitGuess(
    gameId: string,
    guess: Omit<GuessRecord, 'gameId' | 'sequence'>,
    wins: boolean,
    claimToken: string,
  ): Promise<CommitGuessResult | 'claim-lost'> {
    await this.init();
    return this.transaction(() => {
      const game = this.getGameSync(gameId);
      if (!game) return 'missing';
      if (game.status !== 'active') return 'finished';
      if (this.hasGuessSync(gameId, guess.normalizedGuess)) return 'duplicate';

      const ownedClaim = this.db.prepare(`
        SELECT 1 AS found FROM guess_claims
        WHERE game_id = ? AND normalized_guess = ? AND claim_token = ?
      `).get(gameId, guess.normalizedGuess, claimToken);
      if (!ownedClaim) return 'claim-lost';

      const sequenceRow = this.db
        .prepare('SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence FROM guesses WHERE game_id = ?')
        .get(gameId) as { next_sequence: number };
      this.db.prepare(`
        INSERT INTO guesses (
          game_id, normalized_guess, display_guess, score_tenths,
          score_milli_percent, temperature, relation_hint, sequence, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        gameId,
        guess.normalizedGuess,
        guess.displayGuess,
        Math.round(guess.scoreMilliPercent / 100),
        guess.scoreMilliPercent,
        guess.temperature,
        guess.relationHint,
        sequenceRow.next_sequence,
        guess.createdAt,
      );
      if (wins) {
        this.db.prepare(`
          UPDATE games SET status = 'won', ended_at = ?
          WHERE id = ? AND status = 'active'
        `).run(guess.createdAt, gameId);
      }
      this.deleteClaim(gameId, guess.normalizedGuess, claimToken);
      return 'created';
    });
  }

  async useHint(gameId: string): Promise<HintMutationResult> {
    await this.init();
    return this.transaction(() => {
      const result = this.db.prepare(`
        UPDATE games
        SET hint_count = hint_count + 1
        WHERE id = ? AND status = 'active' AND hint_count < 2
        RETURNING hint_count
      `).get(gameId) as { hint_count: number } | undefined;
      if (result) return result.hint_count as 1 | 2;
      const game = this.getGameSync(gameId);
      if (!game) return 'missing';
      return game.status === 'active' ? 'exhausted' : 'finished';
    });
  }

  async abandon(gameId: string, endedAt: number): Promise<FinishMutationResult> {
    await this.init();
    return this.transaction(() => {
      const result = this.db.prepare(`
        UPDATE games SET status = 'abandoned', ended_at = ?
        WHERE id = ? AND status = 'active'
        RETURNING id
      `).get(endedAt, gameId);
      if (result) return 'finished';
      return this.getGameSync(gameId) ? 'already-finished' : 'missing';
    });
  }

  async getSemanticScore(providerKey: string, questionId: string, normalizedGuess: string): Promise<SemanticScoreRecord | null> {
    await this.init();
    const row = this.db.prepare('SELECT score_milli_percent, relation_hint FROM semantic_scores WHERE provider_key = ? AND question_id = ? AND normalized_guess = ?').get(providerKey, questionId, normalizedGuess) as { score_milli_percent:number; relation_hint:string } | undefined;
    return row ? { scoreMilliPercent: row.score_milli_percent, relationHint: row.relation_hint || '' } : null;
  }
  async putSemanticScore(providerKey: string, questionId: string, normalizedGuess: string, score: SemanticScoreRecord, createdAt: number): Promise<void> {
    await this.init();
    this.db.prepare(`INSERT INTO semantic_scores (provider_key, question_id, normalized_guess, score_milli_percent, relation_hint, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(provider_key, question_id, normalized_guess) DO UPDATE SET score_milli_percent=excluded.score_milli_percent, relation_hint=excluded.relation_hint, created_at=excluded.created_at`).run(providerKey, questionId, normalizedGuess, score.scoreMilliPercent, score.relationHint, createdAt);
  }
  async recordAiUsage(record: AiUsageRecord): Promise<void> {
    await this.init();
    this.db.prepare('INSERT OR IGNORE INTO ai_usage VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(record.id, record.providerKey, record.questionId, record.normalizedGuess, record.promptTokens, record.cachedPromptTokens, record.completionTokens, record.latencyMs, record.estimatedCostMicrousd, record.createdAt);
  }
  async recordScoreFeedback(gameId: string, normalizedGuess: string, direction: 'too_high' | 'too_low', createdAt: number): Promise<void> {
    await this.init();
    this.db.prepare(`INSERT INTO score_feedback VALUES (?, ?, ?, ?) ON CONFLICT(game_id, normalized_guess) DO UPDATE SET direction=excluded.direction, created_at=excluded.created_at`).run(gameId, normalizedGuess, direction, createdAt);
  }
  async createAccountSession(session: AccountSessionRecord): Promise<void> {
    await this.init();
    this.db.prepare(`INSERT INTO account_sessions
      (id, token_hash, player_id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(session.id, session.tokenHash, session.playerId, session.userId, session.createdAt, session.expiresAt);
  }
  async getAccountSessionByTokenHash(tokenHash: string): Promise<AccountSessionRecord | null> {
    await this.init();
    const row = this.db.prepare('SELECT * FROM account_sessions WHERE token_hash = ?').get(tokenHash) as AccountSessionRow | undefined;
    return row ? mapAccountSession(row) : null;
  }
  async updateAccountSession(id: string, tokenHash: string, playerId: string, userId: string | null, expiresAt: number): Promise<void> {
    await this.init();
    this.db.prepare('UPDATE account_sessions SET token_hash = ?, player_id = ?, user_id = ?, expires_at = ? WHERE id = ?')
      .run(tokenHash, playerId, userId, expiresAt, id);
  }
  async deleteAccountSession(id: string): Promise<void> {
    await this.init();
    this.db.prepare('DELETE FROM account_sessions WHERE id = ?').run(id);
  }
  async deleteOtherAccountSessions(userId: string, exceptSessionId: string): Promise<void> {
    await this.init();
    this.db.prepare('DELETE FROM account_sessions WHERE user_id = ? AND id <> ?').run(userId, exceptSessionId);
  }
  async createVerificationCode(code: VerificationCodeRecord): Promise<void> {
    await this.init();
    this.db.prepare(`INSERT INTO verification_codes
      (id, phone_hash, code_hash, created_at, expires_at, consumed_at, attempts) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(code.id, code.phoneHash, code.codeHash, code.createdAt, code.expiresAt, code.consumedAt, code.attempts);
  }
  async getLatestVerificationCode(phoneHash: string): Promise<VerificationCodeRecord | null> {
    await this.init();
    const row = this.db.prepare('SELECT * FROM verification_codes WHERE phone_hash = ? ORDER BY created_at DESC LIMIT 1')
      .get(phoneHash) as VerificationCodeRow | undefined;
    return row ? mapVerificationCode(row) : null;
  }
  async countVerificationCodes(phoneHash: string, since: number): Promise<number> {
    await this.init();
    const row = this.db.prepare('SELECT COUNT(*) count FROM verification_codes WHERE phone_hash = ? AND created_at >= ?')
      .get(phoneHash, since) as { count: number };
    return row.count;
  }
  async incrementVerificationAttempts(id: string): Promise<void> {
    await this.init();
    this.db.prepare('UPDATE verification_codes SET attempts = attempts + 1 WHERE id = ?').run(id);
  }
  async consumeVerificationCode(id: string, consumedAt: number): Promise<boolean> {
    await this.init();
    const result = this.db.prepare('UPDATE verification_codes SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL').run(consumedAt, id);
    return result.changes > 0;
  }
  async getUserById(id: string): Promise<UserRecord | null> {
    await this.init();
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
    return row ? mapUser(row) : null;
  }
  async getUserByPhoneHash(phoneHash: string): Promise<UserRecord | null> {
    await this.init();
    const row = this.db.prepare('SELECT * FROM users WHERE phone_hash = ?').get(phoneHash) as UserRow | undefined;
    return row ? mapUser(row) : null;
  }
  async getUserByUsername(username: string): Promise<UserRecord | null> {
    await this.init();
    const row = this.db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined;
    return row ? mapUser(row) : null;
  }
  async createUser(user: UserRecord): Promise<void> {
    await this.init();
    this.db.prepare(`INSERT INTO users
      (id, phone_hash, phone_last4, nickname, username, password_hash, recovery_code_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(user.id, user.phoneHash, user.phoneLast4, user.nickname, user.username ?? null, user.passwordHash ?? null, user.recoveryCodeHash ?? null, user.createdAt, user.updatedAt);
  }
  async updateUserCredentials(id: string, passwordHash: string, recoveryCodeHash: string, updatedAt: number): Promise<void> {
    await this.init();
    this.db.prepare('UPDATE users SET password_hash = ?, recovery_code_hash = ?, updated_at = ? WHERE id = ?')
      .run(passwordHash, recoveryCodeHash, updatedAt, id);
  }
  async countAuthFailures(scopeKey: string, since: number): Promise<number> {
    await this.init();
    const row = this.db.prepare('SELECT COUNT(*) count FROM auth_failures WHERE scope_key = ? AND created_at >= ?')
      .get(scopeKey, since) as { count: number };
    return row.count;
  }
  async recordAuthFailure(record: AuthFailureRecord): Promise<void> {
    await this.init();
    this.transaction(() => {
      this.db.prepare('DELETE FROM auth_failures WHERE created_at < ?').run(record.createdAt - 24 * 60 * 60 * 1_000);
      this.db.prepare('INSERT INTO auth_failures (id, scope_key, created_at) VALUES (?, ?, ?)')
        .run(record.id, record.scopeKey, record.createdAt);
    });
  }
  async clearAuthFailures(scopeKey: string): Promise<void> {
    await this.init();
    this.db.prepare('DELETE FROM auth_failures WHERE scope_key = ?').run(scopeKey);
  }
  async updateUserNickname(id: string, nickname: string, updatedAt: number): Promise<void> {
    await this.init();
    this.db.prepare('UPDATE users SET nickname = ?, updated_at = ? WHERE id = ?').run(nickname, updatedAt, id);
  }
  async mergeGameOwner(fromPlayerId: string, toUserId: string): Promise<void> {
    await this.init();
    this.transaction(() => {
      this.db.prepare(`INSERT INTO daily_participations (owner_id, daily_date, game_id, created_at)
        SELECT ?, daily_date, game_id, created_at FROM daily_participations WHERE owner_id = ?
        ON CONFLICT(owner_id, daily_date) DO UPDATE SET
          game_id = CASE WHEN excluded.created_at < daily_participations.created_at THEN excluded.game_id ELSE daily_participations.game_id END,
          created_at = MIN(excluded.created_at, daily_participations.created_at)`)
        .run(toUserId, fromPlayerId);
      this.db.prepare('DELETE FROM daily_participations WHERE owner_id = ?').run(fromPlayerId);
      this.db.prepare(`INSERT OR IGNORE INTO question_progress (owner_id, category, question_id, played_at)
        SELECT ?, category, question_id, played_at FROM question_progress WHERE owner_id = ?`)
        .run(toUserId, fromPlayerId);
      this.db.prepare('DELETE FROM question_progress WHERE owner_id = ?').run(fromPlayerId);
      this.db.prepare('UPDATE games SET owner_id = ? WHERE owner_id = ?').run(toUserId, fromPlayerId);
    });
  }
  async listOwnedGameResults(ownerId: string, limit: number): Promise<OwnedGameResult[]> {
    await this.init();
    const rows = this.db.prepare(`${ACCOUNT_GAME_SELECT}
      WHERE g.owner_id = ? AND g.ended_at IS NOT NULL ORDER BY g.ended_at DESC LIMIT ?`)
      .all(ownerId, limit) as OwnedGameRow[];
    return rows.map(mapOwnedGame);
  }
  async listDailyGameResults(date: string): Promise<OwnedGameResult[]> {
    await this.init();
    const rows = this.db.prepare(`${ACCOUNT_GAME_SELECT}
      WHERE g.daily_date = ? AND g.ended_at IS NOT NULL AND u.id IS NOT NULL ORDER BY g.started_at ASC`)
      .all(date) as OwnedGameRow[];
    return rows.map(mapOwnedGame);
  }
  async listChallengeGameResults(rootGameId: string): Promise<OwnedGameResult[]> {
    await this.init();
    const rows = this.db.prepare(`${ACCOUNT_GAME_SELECT}
      WHERE (g.id = ? OR g.challenge_root_game_id = ?) AND g.ended_at IS NOT NULL AND u.id IS NOT NULL
      ORDER BY g.started_at ASC`).all(rootGameId, rootGameId) as OwnedGameRow[];
    return rows.map(mapOwnedGame);
  }
  async getAiStats(): Promise<AiStats> {
    await this.init();
    const usage = this.db.prepare('SELECT COUNT(*) requests, COALESCE(SUM(prompt_tokens),0) prompt_tokens, COALESCE(SUM(cached_prompt_tokens),0) cached_prompt_tokens, COALESCE(SUM(completion_tokens),0) completion_tokens, COALESCE(SUM(estimated_cost_microusd),0) cost FROM ai_usage').get() as { requests:number; prompt_tokens:number; cached_prompt_tokens:number; completion_tokens:number; cost:number };
    const cache = this.db.prepare('SELECT COUNT(*) count FROM semantic_scores').get() as { count:number };
    const feedback = this.db.prepare('SELECT COUNT(*) count FROM score_feedback').get() as { count:number };
    return { requests: usage.requests, promptTokens: usage.prompt_tokens, cachedPromptTokens: usage.cached_prompt_tokens, completionTokens: usage.completion_tokens, estimatedCostUsd: usage.cost / 1_000_000, cacheEntries: cache.count, feedbackCount: feedback.count };
  }

  private getGameSync(id: string): GameRecord | null {
    const row = this.db.prepare('SELECT * FROM games WHERE id = ?').get(id) as GameRow | undefined;
    return row ? mapGame(row) : null;
  }

  private hasGuessSync(gameId: string, normalizedGuess: string): boolean {
    return Boolean(
      this.db
        .prepare('SELECT 1 AS found FROM guesses WHERE game_id = ? AND normalized_guess = ?')
        .get(gameId, normalizedGuess),
    );
  }

  private deleteClaim(gameId: string, normalizedGuess: string, claimToken: string): void {
    this.db.prepare(`
      DELETE FROM guess_claims
      WHERE game_id = ? AND normalized_guess = ? AND claim_token = ?
    `).run(gameId, normalizedGuess, claimToken);
  }

  private transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}

function mapGame(row: GameRow): GameRecord {
  return {
    id: row.id,
    resumeTokenHash: row.resume_token_hash,
    questionId: row.question_id,
    category: row.category,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    hintCount: row.hint_count,
    mode: row.mode ?? 'random',
    dailyDate: row.daily_date ?? null,
    ownerId: row.owner_id ?? null,
    challengeRootGameId: row.challenge_root_game_id ?? null,
  };
}

function mapGuess(row: GuessRow): GuessRecord {
  return {
    gameId: row.game_id,
    normalizedGuess: row.normalized_guess,
    displayGuess: row.display_guess,
    scoreMilliPercent: row.score_milli_percent,
    temperature: row.temperature,
    relationHint: row.relation_hint || '',
    sequence: row.sequence,
    createdAt: row.created_at,
  };
}

function mapAccountSession(row: AccountSessionRow): AccountSessionRecord {
  return { id: row.id, tokenHash: row.token_hash, playerId: row.player_id, userId: row.user_id, createdAt: row.created_at, expiresAt: row.expires_at };
}

function mapVerificationCode(row: VerificationCodeRow): VerificationCodeRecord {
  return { id: row.id, phoneHash: row.phone_hash, codeHash: row.code_hash, createdAt: row.created_at, expiresAt: row.expires_at, consumedAt: row.consumed_at, attempts: row.attempts };
}

function mapUser(row: UserRow): UserRecord {
  return { id: row.id, phoneHash: row.phone_hash, phoneLast4: row.phone_last4, nickname: row.nickname,
    username: row.username, passwordHash: row.password_hash, recoveryCodeHash: row.recovery_code_hash,
    createdAt: row.created_at, updatedAt: row.updated_at };
}

function mapOwnedGame(row: OwnedGameRow): OwnedGameResult {
  return {
    gameId: row.game_id, ownerId: row.owner_id, userId: row.user_id, nickname: row.nickname,
    questionId: row.question_id, category: row.category, status: row.status, mode: row.mode,
    dailyDate: row.daily_date, challengeRootGameId: row.challenge_root_game_id,
    startedAt: row.started_at, endedAt: row.ended_at, hintCount: row.hint_count,
    guessCount: row.guess_count,
  };
}
