import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { GameMode, GameStatus, Temperature } from '../contracts';
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

/**
 * Single-ECS persistent store for the Alibaba Cloud deployment path.
 * SQLite WAL plus BEGIN IMMEDIATE keeps claims and result commits atomic even
 * when multiple requests arrive together. The database lives on a Docker
 * volume and is not included in the application image.
 */
export class NodeSqliteGameStore implements GameStore {
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
      CREATE INDEX IF NOT EXISTS idx_guesses_game_sequence
        ON guesses(game_id, sequence);
      CREATE INDEX IF NOT EXISTS idx_guesses_game_score
        ON guesses(game_id, score_tenths DESC, sequence);
      CREATE INDEX IF NOT EXISTS idx_guesses_game_score_milli
        ON guesses(game_id, score_milli_percent DESC, sequence);
    `);

    const columns = this.db.prepare('PRAGMA table_info(guesses)').all() as Array<{ name: string }>;
    const gameColumns = this.db.prepare('PRAGMA table_info(games)').all() as Array<{ name: string }>;
    if (!gameColumns.some((column) => column.name === 'mode')) this.db.exec("ALTER TABLE games ADD COLUMN mode TEXT NOT NULL DEFAULT 'random'");
    if (!gameColumns.some((column) => column.name === 'daily_date')) this.db.exec('ALTER TABLE games ADD COLUMN daily_date TEXT');
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
      PRAGMA optimize;
    `);
    this.initialized = true;
  }

  close(): void {
    this.db.close();
  }

  async createGame(game: GameRecord): Promise<void> {
    await this.init();
    this.db.prepare(`
      INSERT INTO games (
        id, resume_token_hash, question_id, category, status, started_at, ended_at, hint_count, mode, daily_date
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    );
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
        WHERE id = ? AND status = 'active' AND hint_count < 3
        RETURNING hint_count
      `).get(gameId) as { hint_count: number } | undefined;
      if (result) return result.hint_count as 1 | 2 | 3;
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
