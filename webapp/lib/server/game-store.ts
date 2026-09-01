import type { GameStatus, Temperature } from '../contracts';

export type GameRecord = {
  id: string;
  resumeTokenHash: string;
  questionId: string;
  category: string;
  status: GameStatus;
  startedAt: number;
  endedAt: number | null;
  hintCount: number;
};

export type GuessRecord = {
  gameId: string;
  normalizedGuess: string;
  displayGuess: string;
  scoreMilliPercent: number;
  temperature: Temperature;
  sequence: number;
  createdAt: number;
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
};

type GuessRow = {
  game_id: string;
  normalized_guess: string;
  display_guess: string;
  score_tenths: number;
  score_milli_percent: number;
  temperature: Temperature;
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
  };
}

function mapGuess(row: GuessRow): GuessRecord {
  return {
    gameId: row.game_id,
    normalizedGuess: row.normalized_guess,
    displayGuess: row.display_guess,
    scoreMilliPercent: row.score_milli_percent,
    temperature: row.temperature,
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
    ]);
    const columns = await this.db
      .prepare('PRAGMA table_info(guesses)')
      .all<{ name: string }>();
    if (!columns.results.some((column) => column.name === 'score_milli_percent')) {
      await this.db
        .prepare('ALTER TABLE guesses ADD COLUMN score_milli_percent INTEGER NOT NULL DEFAULT 0')
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
          id, resume_token_hash, question_id, category, status, started_at, ended_at, hint_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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
          score_milli_percent, temperature, sequence, created_at
        )
        SELECT ?, ?, ?, ?, ?, ?,
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
        WHERE id = ? AND status = 'active' AND hint_count < 3
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
}

export class MemoryGameStore implements GameStore {
  private readonly games = new Map<string, GameRecord>();
  private readonly guesses = new Map<string, GuessRecord[]>();
  private readonly guessClaims = new Map<string, { token: string; claimedAt: number }>();

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
    if (game.hintCount >= 3) return 'exhausted';
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
}

function guessClaimKey(gameId: string, normalizedGuess: string): string {
  return `${gameId}\u0000${normalizedGuess}`;
}
