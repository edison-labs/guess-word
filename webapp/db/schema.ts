import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const games = sqliteTable('games', {
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
});

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
