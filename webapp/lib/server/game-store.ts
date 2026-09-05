import type { GameMode, GameStatus, Temperature } from '../contracts';
import type {
  AccountSessionRecord,
  AccountStore,
  AuthFailureRecord,
  OwnedGameResult,
  UserRecord,
  VerificationCodeRecord,
} from './account-store';

export type GameRecord = {
  id: string;
  resumeTokenHash: string;
  questionId: string;
  category: string;
  status: GameStatus;
  startedAt: number;
  endedAt: number | null;
  hintCount: number;
  mode?: GameMode;
  dailyDate?: string | null;
  ownerId?: string | null;
  challengeRootGameId?: string | null;
};

export type GuessRecord = {
  gameId: string;
  normalizedGuess: string;
  displayGuess: string;
  scoreMilliPercent: number;
  temperature: Temperature;
  relationHint: string;
  sequence: number;
  createdAt: number;
};

export type SemanticScoreRecord = {
  scoreMilliPercent: number;
  relationHint: string;
};

export type CommitGuessResult = 'created' | 'duplicate' | 'finished' | 'missing';
export type ClaimGuessResult =
  | 'claimed'
  | 'duplicate'
  | 'in-flight'
  | 'finished'
  | 'missing';
export type HintMutationResult = number | 'exhausted' | 'finished' | 'missing';
export type FinishMutationResult = 'finished' | 'already-finished' | 'missing';

export type AiUsageRecord = {
  id: string;
  providerKey: string;
  questionId: string;
  normalizedGuess: string;
  promptTokens: number;
  cachedPromptTokens: number;
  completionTokens: number;
  latencyMs: number;
  estimatedCostMicrousd: number;
  createdAt: number;
};

export type AiStats = {
  requests: number;
  promptTokens: number;
  cachedPromptTokens: number;
  completionTokens: number;
  estimatedCostUsd: number;
  cacheEntries: number;
  feedbackCount: number;
};

export interface GameStore {
  createGame(game: GameRecord): Promise<void>;
  createOrResumeDailyGame(game: GameRecord): Promise<GameRecord>;
  hasGameAccessToken(gameId: string, tokenHash: string): Promise<boolean>;
  getSeenQuestionIds(ownerId: string, category: string): Promise<string[]>;
  recordQuestionSeen(ownerId: string, category: string, questionId: string, playedAt: number): Promise<void>;
  resetQuestionProgress(ownerId: string, category: string): Promise<void>;
  getQuestionProgressCounts(ownerId: string): Promise<Record<string, number>>;
  getGame(id: string): Promise<GameRecord | null>;
  getGuesses(gameId: string): Promise<GuessRecord[]>;
  hasGuess(gameId: string, normalizedGuess: string): Promise<boolean>;
  claimGuess(
    gameId: string,
    normalizedGuess: string,
    claimToken: string,
    claimedAt: number,
    staleBefore: number,
  ): Promise<ClaimGuessResult>;
  releaseGuessClaim(
    gameId: string,
    normalizedGuess: string,
    claimToken: string,
  ): Promise<void>;
  commitGuess(
    gameId: string,
    guess: Omit<GuessRecord, 'gameId' | 'sequence'>,
    wins: boolean,
    claimToken: string,
  ): Promise<CommitGuessResult | 'claim-lost'>;
  useHint(gameId: string): Promise<HintMutationResult>;
  abandon(gameId: string, endedAt: number): Promise<FinishMutationResult>;
  getSemanticScore(providerKey: string, questionId: string, normalizedGuess: string): Promise<SemanticScoreRecord | null>;
  putSemanticScore(providerKey: string, questionId: string, normalizedGuess: string, score: SemanticScoreRecord, createdAt: number): Promise<void>;
  recordAiUsage(record: AiUsageRecord): Promise<void>;
  recordScoreFeedback(gameId: string, normalizedGuess: string, direction: 'too_high' | 'too_low', createdAt: number): Promise<void>;
  getAiStats(): Promise<AiStats>;
}

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
  score_tenths: number;
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

export class D1GameStore implements GameStore, AccountStore {
  private initialized: Promise<void> | null = null;

  constructor(private readonly db: D1Database) {}

  async init(): Promise<void> {
    if (!this.initialized) {
      this.initialized = this.createSchema();
    }
    await this.initialized;
  }

  private async createSchema(): Promise<void> {
    await this.db.batch([
      this.db.prepare(`
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
        )
      `),
      this.db.prepare(`
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
        )
      `),
      this.db.prepare(`
        CREATE TABLE IF NOT EXISTS guess_claims (
          game_id TEXT NOT NULL,
          normalized_guess TEXT NOT NULL,
          claim_token TEXT NOT NULL,
          claimed_at INTEGER NOT NULL,
          PRIMARY KEY (game_id, normalized_guess),
          FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
        )
      `),
      this.db.prepare('CREATE INDEX IF NOT EXISTS idx_guesses_game_sequence ON guesses(game_id, sequence)'),
      this.db.prepare('CREATE INDEX IF NOT EXISTS idx_guesses_game_score ON guesses(game_id, score_tenths DESC, sequence)'),
      this.db.prepare(`CREATE TABLE IF NOT EXISTS semantic_scores (
        provider_key TEXT NOT NULL, question_id TEXT NOT NULL, normalized_guess TEXT NOT NULL,
        score_milli_percent INTEGER NOT NULL, relation_hint TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL,
        PRIMARY KEY (provider_key, question_id, normalized_guess)
      )`),
      this.db.prepare(`CREATE TABLE IF NOT EXISTS ai_usage (
        id TEXT PRIMARY KEY NOT NULL, provider_key TEXT NOT NULL, question_id TEXT NOT NULL,
        normalized_guess TEXT NOT NULL, prompt_tokens INTEGER NOT NULL,
        cached_prompt_tokens INTEGER NOT NULL, completion_tokens INTEGER NOT NULL,
        latency_ms INTEGER NOT NULL, estimated_cost_microusd INTEGER NOT NULL, created_at INTEGER NOT NULL
      )`),
      this.db.prepare(`CREATE TABLE IF NOT EXISTS score_feedback (
        game_id TEXT NOT NULL, normalized_guess TEXT NOT NULL,
        direction TEXT NOT NULL CHECK (direction IN ('too_high','too_low')), created_at INTEGER NOT NULL,
        PRIMARY KEY (game_id, normalized_guess),
        FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
      )`),
      this.db.prepare(`CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY NOT NULL, phone_hash TEXT NOT NULL UNIQUE, phone_last4 TEXT NOT NULL,
        nickname TEXT NOT NULL, username TEXT, password_hash TEXT, recovery_code_hash TEXT,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      )`),
      this.db.prepare(`CREATE TABLE IF NOT EXISTS auth_failures (
        id TEXT PRIMARY KEY NOT NULL, scope_key TEXT NOT NULL, created_at INTEGER NOT NULL
      )`),
      this.db.prepare(`CREATE TABLE IF NOT EXISTS account_sessions (
        id TEXT PRIMARY KEY NOT NULL, token_hash TEXT NOT NULL UNIQUE, player_id TEXT NOT NULL,
        user_id TEXT, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
      )`),
      this.db.prepare(`CREATE TABLE IF NOT EXISTS verification_codes (
        id TEXT PRIMARY KEY NOT NULL, phone_hash TEXT NOT NULL, code_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, consumed_at INTEGER,
        attempts INTEGER NOT NULL DEFAULT 0
      )`),
      this.db.prepare(`CREATE TABLE IF NOT EXISTS daily_participations (
        owner_id TEXT NOT NULL, daily_date TEXT NOT NULL, game_id TEXT NOT NULL,
        created_at INTEGER NOT NULL, PRIMARY KEY (owner_id, daily_date),
        FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
      )`),
      this.db.prepare(`CREATE TABLE IF NOT EXISTS question_progress (
        owner_id TEXT NOT NULL, category TEXT NOT NULL, question_id TEXT NOT NULL,
        played_at INTEGER NOT NULL, PRIMARY KEY (owner_id, category, question_id)
      )`),
      this.db.prepare(`CREATE TABLE IF NOT EXISTS game_access_tokens (
        game_id TEXT NOT NULL, token_hash TEXT NOT NULL, created_at INTEGER NOT NULL,
        PRIMARY KEY (game_id, token_hash), FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
      )`),
      this.db.prepare('CREATE INDEX IF NOT EXISTS idx_account_sessions_token ON account_sessions(token_hash)'),
      this.db.prepare('CREATE INDEX IF NOT EXISTS idx_verification_phone_created ON verification_codes(phone_hash, created_at DESC)'),
      this.db.prepare('CREATE INDEX IF NOT EXISTS idx_daily_participations_game ON daily_participations(game_id)'),
      this.db.prepare('CREATE INDEX IF NOT EXISTS idx_question_progress_owner_category ON question_progress(owner_id, category)'),
      this.db.prepare('CREATE INDEX IF NOT EXISTS idx_auth_failures_scope_created ON auth_failures(scope_key, created_at)'),
    ]);
    const columns = await this.db
      .prepare('PRAGMA table_info(guesses)')
      .all<{ name: string }>();
    const gameColumns = await this.db.prepare('PRAGMA table_info(games)').all<{ name: string }>();
    const userColumns = await this.db.prepare('PRAGMA table_info(users)').all<{ name: string }>();
    if (!userColumns.results.some((column) => column.name === 'username')) await this.db.prepare('ALTER TABLE users ADD COLUMN username TEXT').run();
    if (!userColumns.results.some((column) => column.name === 'password_hash')) await this.db.prepare('ALTER TABLE users ADD COLUMN password_hash TEXT').run();
    if (!userColumns.results.some((column) => column.name === 'recovery_code_hash')) await this.db.prepare('ALTER TABLE users ADD COLUMN recovery_code_hash TEXT').run();
    await this.db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username)').run();
    if (!gameColumns.results.some((column) => column.name === 'mode')) {
      await this.db.prepare("ALTER TABLE games ADD COLUMN mode TEXT NOT NULL DEFAULT 'random'").run();
    }
    if (!gameColumns.results.some((column) => column.name === 'daily_date')) {
      await this.db.prepare('ALTER TABLE games ADD COLUMN daily_date TEXT').run();
    }
    if (!gameColumns.results.some((column) => column.name === 'owner_id')) {
      await this.db.prepare('ALTER TABLE games ADD COLUMN owner_id TEXT').run();
    }
    if (!gameColumns.results.some((column) => column.name === 'challenge_root_game_id')) {
      await this.db.prepare('ALTER TABLE games ADD COLUMN challenge_root_game_id TEXT').run();
    }
    await this.db.batch([
      this.db.prepare('CREATE INDEX IF NOT EXISTS idx_games_owner_ended ON games(owner_id, ended_at DESC)'),
      this.db.prepare('CREATE INDEX IF NOT EXISTS idx_games_daily_rank ON games(daily_date, started_at)'),
      this.db.prepare('CREATE INDEX IF NOT EXISTS idx_games_challenge_rank ON games(challenge_root_game_id, started_at)'),
    ]);
    if (!columns.results.some((column) => column.name === 'score_milli_percent')) {
      await this.db
        .prepare('ALTER TABLE guesses ADD COLUMN score_milli_percent INTEGER NOT NULL DEFAULT 0')
        .run();
    }
    if (!columns.results.some((column) => column.name === 'relation_hint')) {
      await this.db
        .prepare("ALTER TABLE guesses ADD COLUMN relation_hint TEXT NOT NULL DEFAULT ''")
        .run();
    }
    const semanticColumns = await this.db
      .prepare('PRAGMA table_info(semantic_scores)')
      .all<{ name: string }>();
    if (!semanticColumns.results.some((column) => column.name === 'relation_hint')) {
      await this.db
        .prepare("ALTER TABLE semantic_scores ADD COLUMN relation_hint TEXT NOT NULL DEFAULT ''")
        .run();
    }
    await this.db
      .prepare(`
        UPDATE guesses
        SET score_milli_percent = score_tenths * 100
        WHERE score_milli_percent = 0 AND score_tenths != 0
      `)
      .run();
    await this.db
      .prepare(`
        CREATE INDEX IF NOT EXISTS idx_guesses_game_score_milli
        ON guesses(game_id, score_milli_percent DESC, sequence)
      `)
      .run();
    await this.db.prepare('PRAGMA optimize').run();
  }

  async createGame(game: GameRecord): Promise<void> {
    await this.init();
    await this.db
      .prepare(`
        INSERT INTO games (
          id, resume_token_hash, question_id, category, status, started_at, ended_at,
          hint_count, mode, daily_date, owner_id, challenge_root_game_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
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
      )
      .run();
  }

  async createOrResumeDailyGame(game: GameRecord): Promise<GameRecord> {
    await this.init();
    if (!game.ownerId || !game.dailyDate) {
      await this.createGame(game);
      return game;
    }
    const insertGame = this.db.prepare(`INSERT INTO games (
      id, resume_token_hash, question_id, category, status, started_at, ended_at,
      hint_count, mode, daily_date, owner_id, challenge_root_game_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(game.id, game.resumeTokenHash, game.questionId, game.category, game.status,
        game.startedAt, game.endedAt, game.hintCount, game.mode ?? 'daily', game.dailyDate,
        game.ownerId, game.challengeRootGameId ?? null);
    await this.db.batch([
      this.db.prepare(`INSERT OR IGNORE INTO daily_participations (owner_id, daily_date, game_id, created_at)
        SELECT ?, ?, id, started_at FROM games WHERE owner_id = ? AND daily_date = ?
        ORDER BY started_at ASC LIMIT 1`).bind(game.ownerId, game.dailyDate, game.ownerId, game.dailyDate),
      insertGame,
      this.db.prepare(`INSERT OR IGNORE INTO daily_participations
        (owner_id, daily_date, game_id, created_at) VALUES (?, ?, ?, ?)`)
        .bind(game.ownerId, game.dailyDate, game.id, game.startedAt),
      this.db.prepare(`DELETE FROM games WHERE id = ? AND NOT EXISTS
        (SELECT 1 FROM daily_participations WHERE game_id = ?)`)
        .bind(game.id, game.id),
      this.db.prepare(`INSERT OR IGNORE INTO game_access_tokens (game_id, token_hash, created_at)
        SELECT game_id, ?, ? FROM daily_participations WHERE owner_id = ? AND daily_date = ?`)
        .bind(game.resumeTokenHash, game.startedAt, game.ownerId, game.dailyDate),
    ]);
    const row = await this.db.prepare(`SELECT g.* FROM daily_participations d JOIN games g ON g.id = d.game_id
      WHERE d.owner_id = ? AND d.daily_date = ?`).bind(game.ownerId, game.dailyDate).first<GameRow>();
    if (!row) throw new Error('Daily participation was not created.');
    return mapGame(row);
  }

  async hasGameAccessToken(gameId: string, tokenHash: string): Promise<boolean> {
    await this.init();
    return Boolean(await this.db.prepare(`SELECT 1 found FROM game_access_tokens
      WHERE game_id = ? AND token_hash = ?`).bind(gameId, tokenHash).first<{ found: number }>());
  }

  async getSeenQuestionIds(ownerId: string, category: string): Promise<string[]> {
    await this.init();
    const rows = await this.db.prepare(`SELECT question_id FROM question_progress
      WHERE owner_id = ? AND category = ? ORDER BY played_at`).bind(ownerId, category).all<{ question_id: string }>();
    return rows.results.map((row) => row.question_id);
  }

  async recordQuestionSeen(ownerId: string, category: string, questionId: string, playedAt: number): Promise<void> {
    await this.init();
    await this.db.prepare(`INSERT OR IGNORE INTO question_progress
      (owner_id, category, question_id, played_at) VALUES (?, ?, ?, ?)`)
      .bind(ownerId, category, questionId, playedAt).run();
  }

  async resetQuestionProgress(ownerId: string, category: string): Promise<void> {
    await this.init();
    await this.db.prepare('DELETE FROM question_progress WHERE owner_id = ? AND category = ?').bind(ownerId, category).run();
  }

  async getQuestionProgressCounts(ownerId: string): Promise<Record<string, number>> {
    await this.init();
    const rows = await this.db.prepare(`SELECT category, COUNT(*) count FROM question_progress
      WHERE owner_id = ? GROUP BY category`).bind(ownerId).all<{ category: string; count: number }>();
    return Object.fromEntries(rows.results.map((row) => [row.category, row.count]));
  }

  async getGame(id: string): Promise<GameRecord | null> {
    await this.init();
    const row = await this.db
      .prepare('SELECT * FROM games WHERE id = ?')
      .bind(id)
      .first<GameRow>();
    return row ? mapGame(row) : null;
  }

  async getGuesses(gameId: string): Promise<GuessRecord[]> {
    await this.init();
    const result = await this.db
      .prepare('SELECT * FROM guesses WHERE game_id = ? ORDER BY sequence ASC')
      .bind(gameId)
      .all<GuessRow>();
    return result.results.map(mapGuess);
  }

  async hasGuess(gameId: string, normalizedGuess: string): Promise<boolean> {
    await this.init();
    const row = await this.db
      .prepare('SELECT 1 AS found FROM guesses WHERE game_id = ? AND normalized_guess = ?')
      .bind(gameId, normalizedGuess)
      .first<{ found: number }>();
    return Boolean(row);
  }

  async claimGuess(
    gameId: string,
    normalizedGuess: string,
    claimToken: string,
    claimedAt: number,
    staleBefore: number,
  ): Promise<ClaimGuessResult> {
    await this.init();
    const claimed = await this.db
      .prepare(`
        INSERT INTO guess_claims (game_id, normalized_guess, claim_token, claimed_at)
        SELECT ?, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM games WHERE id = ? AND status = 'active')
          AND NOT EXISTS (
            SELECT 1 FROM guesses WHERE game_id = ? AND normalized_guess = ?
          )
        ON CONFLICT(game_id, normalized_guess) DO UPDATE SET
          claim_token = excluded.claim_token,
          claimed_at = excluded.claimed_at
        WHERE guess_claims.claimed_at <= ?
        RETURNING game_id
      `)
      .bind(
        gameId,
        normalizedGuess,
        claimToken,
        claimedAt,
        gameId,
        gameId,
        normalizedGuess,
        staleBefore,
      )
      .first<{ game_id: string }>();
    if (claimed) return 'claimed';
    if (await this.hasGuess(gameId, normalizedGuess)) return 'duplicate';
    const game = await this.getGame(gameId);
    if (!game) return 'missing';
    if (game.status !== 'active') return 'finished';
    return 'in-flight';
  }

  async releaseGuessClaim(
    gameId: string,
    normalizedGuess: string,
    claimToken: string,
  ): Promise<void> {
    await this.init();
    await this.db
      .prepare(`
        DELETE FROM guess_claims
        WHERE game_id = ? AND normalized_guess = ? AND claim_token = ?
      `)
      .bind(gameId, normalizedGuess, claimToken)
      .run();
  }

  async commitGuess(
    gameId: string,
    guess: Omit<GuessRecord, 'gameId' | 'sequence'>,
    wins: boolean,
    claimToken: string,
  ): Promise<CommitGuessResult | 'claim-lost'> {
    await this.init();
    const insert = this.db
      .prepare(`
        INSERT INTO guesses (
          game_id, normalized_guess, display_guess, score_tenths,
          score_milli_percent, temperature, relation_hint, sequence, created_at
        )
        SELECT ?, ?, ?, ?, ?, ?, ?,
          COALESCE((SELECT MAX(sequence) FROM guesses WHERE game_id = ?), 0) + 1,
          ?
        WHERE EXISTS (SELECT 1 FROM games WHERE id = ? AND status = 'active')
          AND EXISTS (
            SELECT 1 FROM guess_claims
            WHERE game_id = ? AND normalized_guess = ? AND claim_token = ?
          )
        ON CONFLICT(game_id, normalized_guess) DO NOTHING
        RETURNING game_id
      `)
      .bind(
        gameId,
        guess.normalizedGuess,
        guess.displayGuess,
        Math.round(guess.scoreMilliPercent / 100),
        guess.scoreMilliPercent,
        guess.temperature,
        guess.relationHint,
        gameId,
        guess.createdAt,
        gameId,
        gameId,
        guess.normalizedGuess,
        claimToken,
      );

    const statements: D1PreparedStatement[] = [insert];
    if (wins) {
      statements.push(
        this.db
          .prepare(`
            UPDATE games
            SET status = 'won', ended_at = ?
            WHERE id = ? AND status = 'active'
              AND EXISTS (
                SELECT 1 FROM guesses
                WHERE game_id = ? AND normalized_guess = ? AND score_milli_percent = 100000
              )
            RETURNING id
          `)
          .bind(guess.createdAt, gameId, gameId, guess.normalizedGuess),
      );
    }
    statements.push(
      this.db
        .prepare(`
          DELETE FROM guess_claims
          WHERE game_id = ? AND normalized_guess = ? AND claim_token = ?
        `)
        .bind(gameId, guess.normalizedGuess, claimToken),
    );
    const results = await this.db.batch(statements);
    if ((results[0].results?.length ?? 0) > 0) return 'created';
    if (await this.hasGuess(gameId, guess.normalizedGuess)) return 'duplicate';
    const game = await this.getGame(gameId);
    if (!game) return 'missing';
    if (game.status !== 'active') return 'finished';
    return 'claim-lost';
  }

  async useHint(gameId: string): Promise<HintMutationResult> {
    await this.init();
    const result = await this.db
      .prepare(`
        UPDATE games
        SET hint_count = hint_count + 1
        WHERE id = ? AND status = 'active' AND hint_count < 2
        RETURNING hint_count
      `)
      .bind(gameId)
      .first<{ hint_count: number }>();
    if (result) return result.hint_count;
    const game = await this.getGame(gameId);
    if (!game) return 'missing';
    if (game.status !== 'active') return 'finished';
    return 'exhausted';
  }

  async abandon(gameId: string, endedAt: number): Promise<FinishMutationResult> {
    await this.init();
    const result = await this.db
      .prepare(`
        UPDATE games
        SET status = 'abandoned', ended_at = ?
        WHERE id = ? AND status = 'active'
        RETURNING id
      `)
      .bind(endedAt, gameId)
      .first<{ id: string }>();
    if (result) return 'finished';
    const game = await this.getGame(gameId);
    return game ? 'already-finished' : 'missing';
  }

  async getSemanticScore(providerKey: string, questionId: string, normalizedGuess: string): Promise<SemanticScoreRecord | null> {
    await this.init();
    const row = await this.db.prepare('SELECT score_milli_percent, relation_hint FROM semantic_scores WHERE provider_key = ? AND question_id = ? AND normalized_guess = ?').bind(providerKey, questionId, normalizedGuess).first<{ score_milli_percent: number; relation_hint: string }>();
    return row ? { scoreMilliPercent: row.score_milli_percent, relationHint: row.relation_hint || '' } : null;
  }

  async putSemanticScore(providerKey: string, questionId: string, normalizedGuess: string, score: SemanticScoreRecord, createdAt: number): Promise<void> {
    await this.init();
    await this.db.prepare(`INSERT INTO semantic_scores (provider_key, question_id, normalized_guess, score_milli_percent, relation_hint, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(provider_key, question_id, normalized_guess) DO UPDATE SET score_milli_percent = excluded.score_milli_percent, relation_hint = excluded.relation_hint, created_at = excluded.created_at`).bind(providerKey, questionId, normalizedGuess, score.scoreMilliPercent, score.relationHint, createdAt).run();
  }

  async recordAiUsage(record: AiUsageRecord): Promise<void> {
    await this.init();
    await this.db.prepare('INSERT OR IGNORE INTO ai_usage VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(record.id, record.providerKey, record.questionId, record.normalizedGuess, record.promptTokens, record.cachedPromptTokens, record.completionTokens, record.latencyMs, record.estimatedCostMicrousd, record.createdAt).run();
  }

  async recordScoreFeedback(gameId: string, normalizedGuess: string, direction: 'too_high' | 'too_low', createdAt: number): Promise<void> {
    await this.init();
    await this.db.prepare(`INSERT INTO score_feedback VALUES (?, ?, ?, ?) ON CONFLICT(game_id, normalized_guess) DO UPDATE SET direction = excluded.direction, created_at = excluded.created_at`).bind(gameId, normalizedGuess, direction, createdAt).run();
  }

  async createAccountSession(session: AccountSessionRecord): Promise<void> {
    await this.init();
    await this.db.prepare(`INSERT INTO account_sessions
      (id, token_hash, player_id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(session.id, session.tokenHash, session.playerId, session.userId, session.createdAt, session.expiresAt).run();
  }

  async getAccountSessionByTokenHash(tokenHash: string): Promise<AccountSessionRecord | null> {
    await this.init();
    const row = await this.db.prepare('SELECT * FROM account_sessions WHERE token_hash = ?').bind(tokenHash).first<AccountSessionRow>();
    return row ? mapAccountSession(row) : null;
  }

  async updateAccountSession(id: string, tokenHash: string, playerId: string, userId: string | null, expiresAt: number): Promise<void> {
    await this.init();
    await this.db.prepare('UPDATE account_sessions SET token_hash = ?, player_id = ?, user_id = ?, expires_at = ? WHERE id = ?')
      .bind(tokenHash, playerId, userId, expiresAt, id).run();
  }

  async deleteAccountSession(id: string): Promise<void> {
    await this.init();
    await this.db.prepare('DELETE FROM account_sessions WHERE id = ?').bind(id).run();
  }

  async deleteOtherAccountSessions(userId: string, exceptSessionId: string): Promise<void> {
    await this.init();
    await this.db.prepare('DELETE FROM account_sessions WHERE user_id = ? AND id <> ?').bind(userId, exceptSessionId).run();
  }

  async createVerificationCode(code: VerificationCodeRecord): Promise<void> {
    await this.init();
    await this.db.prepare(`INSERT INTO verification_codes
      (id, phone_hash, code_hash, created_at, expires_at, consumed_at, attempts) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(code.id, code.phoneHash, code.codeHash, code.createdAt, code.expiresAt, code.consumedAt, code.attempts).run();
  }

  async getLatestVerificationCode(phoneHash: string): Promise<VerificationCodeRecord | null> {
    await this.init();
    const row = await this.db.prepare('SELECT * FROM verification_codes WHERE phone_hash = ? ORDER BY created_at DESC LIMIT 1')
      .bind(phoneHash).first<VerificationCodeRow>();
    return row ? mapVerificationCode(row) : null;
  }

  async countVerificationCodes(phoneHash: string, since: number): Promise<number> {
    await this.init();
    const row = await this.db.prepare('SELECT COUNT(*) count FROM verification_codes WHERE phone_hash = ? AND created_at >= ?')
      .bind(phoneHash, since).first<{ count: number }>();
    return row?.count ?? 0;
  }

  async incrementVerificationAttempts(id: string): Promise<void> {
    await this.init();
    await this.db.prepare('UPDATE verification_codes SET attempts = attempts + 1 WHERE id = ?').bind(id).run();
  }

  async consumeVerificationCode(id: string, consumedAt: number): Promise<boolean> {
    await this.init();
    const row = await this.db.prepare('UPDATE verification_codes SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL RETURNING id')
      .bind(consumedAt, id).first<{ id: string }>();
    return Boolean(row);
  }

  async getUserById(id: string): Promise<UserRecord | null> {
    await this.init();
    const row = await this.db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>();
    return row ? mapUser(row) : null;
  }

  async getUserByPhoneHash(phoneHash: string): Promise<UserRecord | null> {
    await this.init();
    const row = await this.db.prepare('SELECT * FROM users WHERE phone_hash = ?').bind(phoneHash).first<UserRow>();
    return row ? mapUser(row) : null;
  }

  async getUserByUsername(username: string): Promise<UserRecord | null> {
    await this.init();
    const row = await this.db.prepare('SELECT * FROM users WHERE username = ?').bind(username).first<UserRow>();
    return row ? mapUser(row) : null;
  }

  async createUser(user: UserRecord): Promise<void> {
    await this.init();
    await this.db.prepare(`INSERT INTO users
      (id, phone_hash, phone_last4, nickname, username, password_hash, recovery_code_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(user.id, user.phoneHash, user.phoneLast4, user.nickname, user.username ?? null, user.passwordHash ?? null, user.recoveryCodeHash ?? null, user.createdAt, user.updatedAt).run();
  }

  async updateUserCredentials(id: string, passwordHash: string, recoveryCodeHash: string, updatedAt: number): Promise<void> {
    await this.init();
    await this.db.prepare('UPDATE users SET password_hash = ?, recovery_code_hash = ?, updated_at = ? WHERE id = ?')
      .bind(passwordHash, recoveryCodeHash, updatedAt, id).run();
  }

  async countAuthFailures(scopeKey: string, since: number): Promise<number> {
    await this.init();
    const row = await this.db.prepare('SELECT COUNT(*) count FROM auth_failures WHERE scope_key = ? AND created_at >= ?')
      .bind(scopeKey, since).first<{ count: number }>();
    return row?.count ?? 0;
  }

  async recordAuthFailure(record: AuthFailureRecord): Promise<void> {
    await this.init();
    await this.db.batch([
      this.db.prepare('DELETE FROM auth_failures WHERE created_at < ?').bind(record.createdAt - 24 * 60 * 60 * 1_000),
      this.db.prepare('INSERT INTO auth_failures (id, scope_key, created_at) VALUES (?, ?, ?)').bind(record.id, record.scopeKey, record.createdAt),
    ]);
  }

  async clearAuthFailures(scopeKey: string): Promise<void> {
    await this.init();
    await this.db.prepare('DELETE FROM auth_failures WHERE scope_key = ?').bind(scopeKey).run();
  }

  async updateUserNickname(id: string, nickname: string, updatedAt: number): Promise<void> {
    await this.init();
    await this.db.prepare('UPDATE users SET nickname = ?, updated_at = ? WHERE id = ?').bind(nickname, updatedAt, id).run();
  }

  async mergeGameOwner(fromPlayerId: string, toUserId: string): Promise<void> {
    await this.init();
    await this.db.batch([
      this.db.prepare(`INSERT INTO daily_participations (owner_id, daily_date, game_id, created_at)
        SELECT ?, daily_date, game_id, created_at FROM daily_participations WHERE owner_id = ?
        ON CONFLICT(owner_id, daily_date) DO UPDATE SET
          game_id = CASE WHEN excluded.created_at < daily_participations.created_at THEN excluded.game_id ELSE daily_participations.game_id END,
          created_at = MIN(excluded.created_at, daily_participations.created_at)`).bind(toUserId, fromPlayerId),
      this.db.prepare('DELETE FROM daily_participations WHERE owner_id = ?').bind(fromPlayerId),
      this.db.prepare(`INSERT OR IGNORE INTO question_progress (owner_id, category, question_id, played_at)
        SELECT ?, category, question_id, played_at FROM question_progress WHERE owner_id = ?`).bind(toUserId, fromPlayerId),
      this.db.prepare('DELETE FROM question_progress WHERE owner_id = ?').bind(fromPlayerId),
      this.db.prepare('UPDATE games SET owner_id = ? WHERE owner_id = ?').bind(toUserId, fromPlayerId),
    ]);
  }

  async listOwnedGameResults(ownerId: string, limit: number): Promise<OwnedGameResult[]> {
    await this.init();
    const result = await this.db.prepare(`${ACCOUNT_GAME_SELECT}
      WHERE g.owner_id = ? AND g.ended_at IS NOT NULL ORDER BY g.ended_at DESC LIMIT ?`)
      .bind(ownerId, limit).all<OwnedGameRow>();
    return result.results.map(mapOwnedGame);
  }

  async listDailyGameResults(date: string): Promise<OwnedGameResult[]> {
    await this.init();
    const result = await this.db.prepare(`${ACCOUNT_GAME_SELECT}
      WHERE g.daily_date = ? AND g.ended_at IS NOT NULL AND u.id IS NOT NULL ORDER BY g.started_at ASC`)
      .bind(date).all<OwnedGameRow>();
    return result.results.map(mapOwnedGame);
  }

  async listChallengeGameResults(rootGameId: string): Promise<OwnedGameResult[]> {
    await this.init();
    const result = await this.db.prepare(`${ACCOUNT_GAME_SELECT}
      WHERE (g.id = ? OR g.challenge_root_game_id = ?) AND g.ended_at IS NOT NULL AND u.id IS NOT NULL
      ORDER BY g.started_at ASC`).bind(rootGameId, rootGameId).all<OwnedGameRow>();
    return result.results.map(mapOwnedGame);
  }

  async getAiStats(): Promise<AiStats> {
    await this.init();
    const usage = await this.db.prepare('SELECT COUNT(*) requests, COALESCE(SUM(prompt_tokens),0) prompt_tokens, COALESCE(SUM(cached_prompt_tokens),0) cached_prompt_tokens, COALESCE(SUM(completion_tokens),0) completion_tokens, COALESCE(SUM(estimated_cost_microusd),0) cost FROM ai_usage').first<{ requests:number; prompt_tokens:number; cached_prompt_tokens:number; completion_tokens:number; cost:number }>();
    const cache = await this.db.prepare('SELECT COUNT(*) count FROM semantic_scores').first<{ count:number }>();
    const feedback = await this.db.prepare('SELECT COUNT(*) count FROM score_feedback').first<{ count:number }>();
    return { requests: usage?.requests ?? 0, promptTokens: usage?.prompt_tokens ?? 0, cachedPromptTokens: usage?.cached_prompt_tokens ?? 0, completionTokens: usage?.completion_tokens ?? 0, estimatedCostUsd: (usage?.cost ?? 0) / 1_000_000, cacheEntries: cache?.count ?? 0, feedbackCount: feedback?.count ?? 0 };
  }
}

export class MemoryGameStore implements GameStore, AccountStore {
  private readonly games = new Map<string, GameRecord>();
  private readonly guesses = new Map<string, GuessRecord[]>();
  private readonly guessClaims = new Map<string, { token: string; claimedAt: number }>();
  private readonly semanticScores = new Map<string, SemanticScoreRecord>();
  private readonly aiUsage: AiUsageRecord[] = [];
  private readonly feedback = new Map<string, 'too_high' | 'too_low'>();
  private readonly accountSessions = new Map<string, AccountSessionRecord>();
  private readonly verificationCodes: VerificationCodeRecord[] = [];
  private readonly users = new Map<string, UserRecord>();
  private readonly authFailures: AuthFailureRecord[] = [];
  private readonly dailyParticipations = new Map<string, string>();
  private readonly questionProgress = new Map<string, Map<string, number>>();
  private readonly gameAccessTokens = new Map<string, Set<string>>();

  async createGame(game: GameRecord): Promise<void> {
    if (this.games.has(game.id)) throw new Error('Duplicate game id.');
    this.games.set(game.id, { ...game });
    this.guesses.set(game.id, []);
  }

  async createOrResumeDailyGame(game: GameRecord): Promise<GameRecord> {
    if (!game.ownerId || !game.dailyDate) {
      await this.createGame(game);
      return game;
    }
    const key = `${game.ownerId}\u0000${game.dailyDate}`;
    let existingId = this.dailyParticipations.get(key);
    if (!existingId) {
      const legacy = [...this.games.values()]
        .filter((item) => item.ownerId === game.ownerId && item.dailyDate === game.dailyDate)
        .sort((a, b) => a.startedAt - b.startedAt)[0];
      existingId = legacy?.id;
    }
    if (existingId) {
      const existing = this.games.get(existingId);
      if (existing) {
        const tokens = this.gameAccessTokens.get(existing.id) ?? new Set<string>();
        tokens.add(game.resumeTokenHash);
        this.gameAccessTokens.set(existing.id, tokens);
        this.dailyParticipations.set(key, existing.id);
        return { ...existing };
      }
    }
    await this.createGame(game);
    this.dailyParticipations.set(key, game.id);
    return game;
  }

  async hasGameAccessToken(gameId: string, tokenHash: string): Promise<boolean> {
    return this.gameAccessTokens.get(gameId)?.has(tokenHash) ?? false;
  }

  async getSeenQuestionIds(ownerId: string, category: string): Promise<string[]> {
    return [...(this.questionProgress.get(`${ownerId}\u0000${category}`)?.keys() ?? [])];
  }

  async recordQuestionSeen(ownerId: string, category: string, questionId: string, playedAt: number): Promise<void> {
    const key = `${ownerId}\u0000${category}`;
    const progress = this.questionProgress.get(key) ?? new Map<string, number>();
    if (!progress.has(questionId)) progress.set(questionId, playedAt);
    this.questionProgress.set(key, progress);
  }

  async resetQuestionProgress(ownerId: string, category: string): Promise<void> {
    this.questionProgress.delete(`${ownerId}\u0000${category}`);
  }

  async getQuestionProgressCounts(ownerId: string): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const [key, progress] of this.questionProgress) {
      const [candidateOwner, category] = key.split('\u0000');
      if (candidateOwner === ownerId) counts[category] = progress.size;
    }
    return counts;
  }

  async getGame(id: string): Promise<GameRecord | null> {
    const game = this.games.get(id);
    return game ? { ...game } : null;
  }

  async getGuesses(gameId: string): Promise<GuessRecord[]> {
    return (this.guesses.get(gameId) ?? []).map((item) => ({ ...item }));
  }

  async hasGuess(gameId: string, normalizedGuess: string): Promise<boolean> {
    return (this.guesses.get(gameId) ?? []).some(
      (item) => item.normalizedGuess === normalizedGuess,
    );
  }

  async claimGuess(
    gameId: string,
    normalizedGuess: string,
    claimToken: string,
    claimedAt: number,
    staleBefore: number,
  ): Promise<ClaimGuessResult> {
    const game = this.games.get(gameId);
    if (!game) return 'missing';
    if (game.status !== 'active') return 'finished';
    if (await this.hasGuess(gameId, normalizedGuess)) return 'duplicate';
    const key = guessClaimKey(gameId, normalizedGuess);
    const current = this.guessClaims.get(key);
    if (current && current.claimedAt > staleBefore) return 'in-flight';
    this.guessClaims.set(key, { token: claimToken, claimedAt });
    return 'claimed';
  }

  async releaseGuessClaim(
    gameId: string,
    normalizedGuess: string,
    claimToken: string,
  ): Promise<void> {
    const key = guessClaimKey(gameId, normalizedGuess);
    if (this.guessClaims.get(key)?.token === claimToken) this.guessClaims.delete(key);
  }

  async commitGuess(
    gameId: string,
    guess: Omit<GuessRecord, 'gameId' | 'sequence'>,
    wins: boolean,
    claimToken: string,
  ): Promise<CommitGuessResult | 'claim-lost'> {
    const claimKey = guessClaimKey(gameId, guess.normalizedGuess);
    if (this.guessClaims.get(claimKey)?.token !== claimToken) return 'claim-lost';
    const game = this.games.get(gameId);
    if (!game) {
      this.guessClaims.delete(claimKey);
      return 'missing';
    }
    if (game.status !== 'active') {
      this.guessClaims.delete(claimKey);
      return 'finished';
    }
    const records = this.guesses.get(gameId) ?? [];
    if (records.some((item) => item.normalizedGuess === guess.normalizedGuess)) {
      this.guessClaims.delete(claimKey);
      return 'duplicate';
    }
    records.push({ ...guess, gameId, sequence: records.length + 1 });
    this.guesses.set(gameId, records);
    this.guessClaims.delete(claimKey);
    if (wins) {
      game.status = 'won';
      game.endedAt = guess.createdAt;
    }
    return 'created';
  }

  async useHint(gameId: string): Promise<HintMutationResult> {
    const game = this.games.get(gameId);
    if (!game) return 'missing';
    if (game.status !== 'active') return 'finished';
    if (game.hintCount >= 2) return 'exhausted';
    game.hintCount += 1;
    return game.hintCount;
  }

  async abandon(gameId: string, endedAt: number): Promise<FinishMutationResult> {
    const game = this.games.get(gameId);
    if (!game) return 'missing';
    if (game.status !== 'active') return 'already-finished';
    game.status = 'abandoned';
    game.endedAt = endedAt;
    return 'finished';
  }

  async getSemanticScore(providerKey: string, questionId: string, normalizedGuess: string): Promise<SemanticScoreRecord | null> {
    const score = this.semanticScores.get(`${providerKey}\u0000${questionId}\u0000${normalizedGuess}`);
    return score ? { ...score } : null;
  }
  async putSemanticScore(providerKey: string, questionId: string, normalizedGuess: string, score: SemanticScoreRecord): Promise<void> {
    this.semanticScores.set(`${providerKey}\u0000${questionId}\u0000${normalizedGuess}`, { ...score });
  }
  async recordAiUsage(record: AiUsageRecord): Promise<void> { this.aiUsage.push({ ...record }); }
  async recordScoreFeedback(gameId: string, normalizedGuess: string, direction: 'too_high' | 'too_low'): Promise<void> { this.feedback.set(`${gameId}\u0000${normalizedGuess}`, direction); }
  async createAccountSession(session: AccountSessionRecord): Promise<void> { this.accountSessions.set(session.id, { ...session }); }
  async getAccountSessionByTokenHash(tokenHash: string): Promise<AccountSessionRecord | null> {
    const session = [...this.accountSessions.values()].find((item) => item.tokenHash === tokenHash);
    return session ? { ...session } : null;
  }
  async updateAccountSession(id: string, tokenHash: string, playerId: string, userId: string | null, expiresAt: number): Promise<void> {
    const session = this.accountSessions.get(id);
    if (session) this.accountSessions.set(id, { ...session, tokenHash, playerId, userId, expiresAt });
  }
  async deleteAccountSession(id: string): Promise<void> { this.accountSessions.delete(id); }
  async deleteOtherAccountSessions(userId: string, exceptSessionId: string): Promise<void> {
    for (const [id, session] of this.accountSessions) if (session.userId === userId && id !== exceptSessionId) this.accountSessions.delete(id);
  }
  async createVerificationCode(code: VerificationCodeRecord): Promise<void> { this.verificationCodes.push({ ...code }); }
  async getLatestVerificationCode(phoneHash: string): Promise<VerificationCodeRecord | null> {
    const record = this.verificationCodes.filter((item) => item.phoneHash === phoneHash).sort((a, b) => b.createdAt - a.createdAt)[0];
    return record ? { ...record } : null;
  }
  async countVerificationCodes(phoneHash: string, since: number): Promise<number> {
    return this.verificationCodes.filter((item) => item.phoneHash === phoneHash && item.createdAt >= since).length;
  }
  async incrementVerificationAttempts(id: string): Promise<void> {
    const record = this.verificationCodes.find((item) => item.id === id);
    if (record) record.attempts += 1;
  }
  async consumeVerificationCode(id: string, consumedAt: number): Promise<boolean> {
    const record = this.verificationCodes.find((item) => item.id === id);
    if (!record || record.consumedAt !== null) return false;
    record.consumedAt = consumedAt;
    return true;
  }
  async getUserById(id: string): Promise<UserRecord | null> {
    const user = this.users.get(id);
    return user ? { ...user } : null;
  }
  async getUserByPhoneHash(phoneHash: string): Promise<UserRecord | null> {
    const user = [...this.users.values()].find((item) => item.phoneHash === phoneHash);
    return user ? { ...user } : null;
  }
  async getUserByUsername(username: string): Promise<UserRecord | null> {
    const user = [...this.users.values()].find((item) => item.username === username);
    return user ? { ...user } : null;
  }
  async createUser(user: UserRecord): Promise<void> { this.users.set(user.id, { ...user }); }
  async updateUserCredentials(id: string, passwordHash: string, recoveryCodeHash: string, updatedAt: number): Promise<void> {
    const user = this.users.get(id);
    if (user) this.users.set(id, { ...user, passwordHash, recoveryCodeHash, updatedAt });
  }
  async countAuthFailures(scopeKey: string, since: number): Promise<number> {
    return this.authFailures.filter((item) => item.scopeKey === scopeKey && item.createdAt >= since).length;
  }
  async recordAuthFailure(record: AuthFailureRecord): Promise<void> {
    const cutoff = record.createdAt - 24 * 60 * 60 * 1_000;
    for (let index = this.authFailures.length - 1; index >= 0; index -= 1) if (this.authFailures[index].createdAt < cutoff) this.authFailures.splice(index, 1);
    this.authFailures.push({ ...record });
  }
  async clearAuthFailures(scopeKey: string): Promise<void> {
    for (let index = this.authFailures.length - 1; index >= 0; index -= 1) {
      if (this.authFailures[index].scopeKey === scopeKey) this.authFailures.splice(index, 1);
    }
  }
  async updateUserNickname(id: string, nickname: string, updatedAt: number): Promise<void> {
    const user = this.users.get(id);
    if (user) this.users.set(id, { ...user, nickname, updatedAt });
  }
  async mergeGameOwner(fromPlayerId: string, toUserId: string): Promise<void> {
    for (const [key, gameId] of [...this.dailyParticipations]) {
      const [ownerId, date] = key.split('\u0000');
      if (ownerId !== fromPlayerId) continue;
      const targetKey = `${toUserId}\u0000${date}`;
      const currentId = this.dailyParticipations.get(targetKey);
      const current = currentId ? this.games.get(currentId) : undefined;
      const incoming = this.games.get(gameId);
      if (!current || (incoming && incoming.startedAt < current.startedAt)) this.dailyParticipations.set(targetKey, gameId);
      this.dailyParticipations.delete(key);
    }
    for (const [key, progress] of [...this.questionProgress]) {
      const [ownerId, category] = key.split('\u0000');
      if (ownerId !== fromPlayerId) continue;
      const targetKey = `${toUserId}\u0000${category}`;
      const target = this.questionProgress.get(targetKey) ?? new Map<string, number>();
      for (const [questionId, playedAt] of progress) if (!target.has(questionId)) target.set(questionId, playedAt);
      this.questionProgress.set(targetKey, target);
      this.questionProgress.delete(key);
    }
    for (const game of this.games.values()) if (game.ownerId === fromPlayerId) game.ownerId = toUserId;
  }
  async listOwnedGameResults(ownerId: string, limit: number): Promise<OwnedGameResult[]> {
    return this.memoryResults((game) => game.ownerId === ownerId).slice(0, limit);
  }
  async listDailyGameResults(date: string): Promise<OwnedGameResult[]> {
    return this.memoryResults((game) => game.dailyDate === date && Boolean(game.ownerId && this.users.has(game.ownerId)));
  }
  async listChallengeGameResults(rootGameId: string): Promise<OwnedGameResult[]> {
    return this.memoryResults((game) =>
      (game.id === rootGameId || game.challengeRootGameId === rootGameId) && Boolean(game.ownerId && this.users.has(game.ownerId)),
    );
  }
  async getAiStats(): Promise<AiStats> {
    return {
      requests: this.aiUsage.length,
      promptTokens: this.aiUsage.reduce((sum, item) => sum + item.promptTokens, 0),
      cachedPromptTokens: this.aiUsage.reduce((sum, item) => sum + item.cachedPromptTokens, 0),
      completionTokens: this.aiUsage.reduce((sum, item) => sum + item.completionTokens, 0),
      estimatedCostUsd: this.aiUsage.reduce((sum, item) => sum + item.estimatedCostMicrousd, 0) / 1_000_000,
      cacheEntries: this.semanticScores.size,
      feedbackCount: this.feedback.size,
    };
  }

  private memoryResults(predicate: (game: GameRecord) => boolean): OwnedGameResult[] {
    return [...this.games.values()]
      .filter((game) => predicate(game) && game.endedAt !== null && Boolean(game.ownerId))
      .map((game) => {
        const user = game.ownerId ? this.users.get(game.ownerId) : undefined;
        return {
          gameId: game.id,
          ownerId: game.ownerId!,
          userId: user?.id ?? null,
          nickname: user?.nickname ?? null,
          questionId: game.questionId,
          category: game.category,
          status: game.status,
          mode: game.mode ?? 'random',
          dailyDate: game.dailyDate ?? null,
          challengeRootGameId: game.challengeRootGameId ?? null,
          startedAt: game.startedAt,
          endedAt: game.endedAt!,
          hintCount: game.hintCount,
          guessCount: (this.guesses.get(game.id) ?? []).length,
        };
      })
      .sort((a, b) => b.endedAt - a.endedAt);
  }
}

function guessClaimKey(gameId: string, normalizedGuess: string): string {
  return `${gameId}\u0000${normalizedGuess}`;
}
