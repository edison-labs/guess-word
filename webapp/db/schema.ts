import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const games = sqliteTable(
  'games',
  {
    id: text('id').primaryKey().notNull(),
    resumeTokenHash: text('resume_token_hash').notNull(),
    questionId: text('question_id').notNull(),
    category: text('category').notNull(),
    status: text('status', { enum: ['active', 'won', 'abandoned'] }).notNull(),
    startedAt: integer('started_at').notNull(),
    endedAt: integer('ended_at'),
    hintCount: integer('hint_count').notNull().default(0),
    mode: text('mode', { enum: ['random', 'daily'] }).notNull().default('random'),
    dailyDate: text('daily_date'),
    ownerId: text('owner_id'),
    challengeRootGameId: text('challenge_root_game_id'),
  },
  (table) => [
    index('idx_games_owner_ended').on(table.ownerId, table.endedAt),
    index('idx_games_daily_rank').on(table.dailyDate, table.startedAt),
    index('idx_games_challenge_rank').on(table.challengeRootGameId, table.startedAt),
  ],
);

export const dailyParticipations = sqliteTable(
  'daily_participations',
  {
    ownerId: text('owner_id').notNull(),
    dailyDate: text('daily_date').notNull(),
    gameId: text('game_id').notNull().references(() => games.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.dailyDate] }),
    index('idx_daily_participations_game').on(table.gameId),
  ],
);

export const gameAccessTokens = sqliteTable(
  'game_access_tokens',
  {
    gameId: text('game_id').notNull().references(() => games.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.gameId, table.tokenHash] })],
);

export const questionProgress = sqliteTable(
  'question_progress',
  {
    ownerId: text('owner_id').notNull(),
    category: text('category').notNull(),
    questionId: text('question_id').notNull(),
    playedAt: integer('played_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.category, table.questionId] }),
    index('idx_question_progress_owner_category').on(table.ownerId, table.category),
  ],
);

export const users = sqliteTable('users', {
  id: text('id').primaryKey().notNull(),
  phoneHash: text('phone_hash').notNull().unique(),
  phoneLast4: text('phone_last4').notNull(),
  nickname: text('nickname').notNull(),
  username: text('username'),
  passwordHash: text('password_hash'),
  recoveryCodeHash: text('recovery_code_hash'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (table) => [uniqueIndex('idx_users_username').on(table.username)]);

export const authFailures = sqliteTable(
  'auth_failures',
  {
    id: text('id').primaryKey().notNull(),
    scopeKey: text('scope_key').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [index('idx_auth_failures_scope_created').on(table.scopeKey, table.createdAt)],
);

export const accountSessions = sqliteTable(
  'account_sessions',
  {
    id: text('id').primaryKey().notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    playerId: text('player_id').notNull(),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (table) => [index('idx_account_sessions_token').on(table.tokenHash)],
);

export const verificationCodes = sqliteTable(
  'verification_codes',
  {
    id: text('id').primaryKey().notNull(),
    phoneHash: text('phone_hash').notNull(),
    codeHash: text('code_hash').notNull(),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
    consumedAt: integer('consumed_at'),
    attempts: integer('attempts').notNull().default(0),
  },
  (table) => [index('idx_verification_phone_created').on(table.phoneHash, table.createdAt)],
);

export const guesses = sqliteTable(
  'guesses',
  {
    gameId: text('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    normalizedGuess: text('normalized_guess').notNull(),
    displayGuess: text('display_guess').notNull(),
    // Kept for backward-compatible migration of existing local databases.
    scoreTenths: integer('score_tenths').notNull(),
    scoreMilliPercent: integer('score_milli_percent').notNull().default(0),
    temperature: text('temperature').notNull(),
    relationHint: text('relation_hint').notNull().default(''),
    sequence: integer('sequence').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.gameId, table.normalizedGuess] }),
    uniqueIndex('idx_guesses_game_sequence_unique').on(table.gameId, table.sequence),
    index('idx_guesses_game_sequence').on(table.gameId, table.sequence),
    index('idx_guesses_game_score').on(table.gameId, table.scoreTenths, table.sequence),
    index('idx_guesses_game_score_milli').on(
      table.gameId,
      table.scoreMilliPercent,
      table.sequence,
    ),
  ],
);

export const guessClaims = sqliteTable(
  'guess_claims',
  {
    gameId: text('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    normalizedGuess: text('normalized_guess').notNull(),
    claimToken: text('claim_token').notNull(),
    claimedAt: integer('claimed_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.gameId, table.normalizedGuess] })],
);

export const semanticScores = sqliteTable('semantic_scores', {
  providerKey: text('provider_key').notNull(),
  questionId: text('question_id').notNull(),
  normalizedGuess: text('normalized_guess').notNull(),
  scoreMilliPercent: integer('score_milli_percent').notNull(),
  relationHint: text('relation_hint').notNull().default(''),
  createdAt: integer('created_at').notNull(),
}, (table) => [primaryKey({ columns: [table.providerKey, table.questionId, table.normalizedGuess] })]);

export const aiUsage = sqliteTable('ai_usage', {
  id: text('id').primaryKey().notNull(), providerKey: text('provider_key').notNull(),
  questionId: text('question_id').notNull(), normalizedGuess: text('normalized_guess').notNull(),
  promptTokens: integer('prompt_tokens').notNull(), cachedPromptTokens: integer('cached_prompt_tokens').notNull(),
  completionTokens: integer('completion_tokens').notNull(), latencyMs: integer('latency_ms').notNull(),
  estimatedCostMicrousd: integer('estimated_cost_microusd').notNull(), createdAt: integer('created_at').notNull(),
});

export const scoreFeedback = sqliteTable('score_feedback', {
  gameId: text('game_id').notNull().references(() => games.id, { onDelete: 'cascade' }),
  normalizedGuess: text('normalized_guess').notNull(), direction: text('direction', { enum: ['too_high', 'too_low'] }).notNull(),
  createdAt: integer('created_at').notNull(),
}, (table) => [primaryKey({ columns: [table.gameId, table.normalizedGuess] })]);
