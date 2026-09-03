import type { GameMode, GameStatus, Temperature } from '../contracts';

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

export class D1GameStore implements GameStore {
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
    ]);
    const columns = await this.db
      .prepare('PRAGMA table_info(guesses)')
      .all<{ name: string }>();
    const gameColumns = await this.db.prepare('PRAGMA table_info(games)').all<{ name: string }>();
    if (!gameColumns.results.some((column) => column.name === 'mode')) {
      await this.db.prepare("ALTER TABLE games ADD COLUMN mode TEXT NOT NULL DEFAULT 'random'").run();
    }
    if (!gameColumns.results.some((column) => column.name === 'daily_date')) {
      await this.db.prepare('ALTER TABLE games ADD COLUMN daily_date TEXT').run();
    }
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
          id, resume_token_hash, question_id, category, status, started_at, ended_at, hint_count, mode, daily_date
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      )
      .run();
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

  async getAiStats(): Promise<AiStats> {
    await this.init();
    const usage = await this.db.prepare('SELECT COUNT(*) requests, COALESCE(SUM(prompt_tokens),0) prompt_tokens, COALESCE(SUM(cached_prompt_tokens),0) cached_prompt_tokens, COALESCE(SUM(completion_tokens),0) completion_tokens, COALESCE(SUM(estimated_cost_microusd),0) cost FROM ai_usage').first<{ requests:number; prompt_tokens:number; cached_prompt_tokens:number; completion_tokens:number; cost:number }>();
    const cache = await this.db.prepare('SELECT COUNT(*) count FROM semantic_scores').first<{ count:number }>();
    const feedback = await this.db.prepare('SELECT COUNT(*) count FROM score_feedback').first<{ count:number }>();
    return { requests: usage?.requests ?? 0, promptTokens: usage?.prompt_tokens ?? 0, cachedPromptTokens: usage?.cached_prompt_tokens ?? 0, completionTokens: usage?.completion_tokens ?? 0, estimatedCostUsd: (usage?.cost ?? 0) / 1_000_000, cacheEntries: cache?.count ?? 0, feedbackCount: feedback?.count ?? 0 };
  }
}

export class MemoryGameStore implements GameStore {
  private readonly games = new Map<string, GameRecord>();
  private readonly guesses = new Map<string, GuessRecord[]>();
  private readonly guessClaims = new Map<string, { token: string; claimedAt: number }>();
  private readonly semanticScores = new Map<string, SemanticScoreRecord>();
  private readonly aiUsage: AiUsageRecord[] = [];
  private readonly feedback = new Map<string, 'too_high' | 'too_low'>();

  async createGame(game: GameRecord): Promise<void> {
    if (this.games.has(game.id)) throw new Error('Duplicate game id.');
    this.games.set(game.id, { ...game });
    this.guesses.set(game.id, []);
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
}

function guessClaimKey(gameId: string, normalizedGuess: string): string {
  return `${gameId}\u0000${normalizedGuess}`;
}
