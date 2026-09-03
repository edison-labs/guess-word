import type {
  ApiErrorCode,
  CreateGameResponse,
  GameCategory,
  PublicGame,
  PublicGuess,
  PublicHint,
  ScoringMode,
} from '../contracts';
import {
  capNonExactScore,
  scoreMilliPercentToPercent,
  scoreToTemperature,
  validateGuess,
} from '../game-rules';
import type { GameRecord, GameStore, GuessRecord } from './game-store';
import { getQuestionById, selectDailyQuestion, selectRandomQuestion, type Question } from './questions';
import { SemanticScorerError, type SemanticScorer } from './scoring';

export class GameError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly httpStatus: number,
    readonly retryable = false,
    readonly field?: 'guess',
  ) {
    super(message);
  }
}

type GameServiceOptions = {
  store: GameStore;
  scorer: SemanticScorer;
  now?: () => number;
  questionSelector?: (category: GameCategory) => Question;
  idGenerator?: () => string;
  tokenGenerator?: () => string;
  claimTokenGenerator?: () => string;
  scoringMode?: ScoringMode;
};

const GUESS_CLAIM_TTL_MS = 15_000;

export class GameService {
  private readonly now: () => number;
  private readonly questionSelector: (category: GameCategory) => Question;
  private readonly idGenerator: () => string;
  private readonly tokenGenerator: () => string;
  private readonly claimTokenGenerator: () => string;
  private readonly scoringMode: ScoringMode;

  constructor(private readonly options: GameServiceOptions) {
    this.now = options.now ?? (() => Date.now());
    this.questionSelector = options.questionSelector ?? ((category) => selectRandomQuestion(category));
    this.idGenerator = options.idGenerator ?? (() => crypto.randomUUID());
    this.tokenGenerator = options.tokenGenerator ?? randomToken;
    this.claimTokenGenerator = options.claimTokenGenerator ?? randomToken;
    this.scoringMode = options.scoringMode ?? 'test';
  }

  async createGame(category: GameCategory): Promise<CreateGameResponse> {
    const question = this.questionSelector(category);
    if (question.category !== category) {
      throw new GameError('INTERNAL_ERROR', '所选分类暂时没有可用题目。', 500);
    }
    return this.createGameForQuestion(question, 'random', null);
  }

  async createDailyGame(): Promise<CreateGameResponse> {
    const date = chinaDate(this.now());
    return this.createGameForQuestion(selectDailyQuestion(date), 'daily', date);
  }

  private async createGameForQuestion(question: Question, mode: 'random' | 'daily', dailyDate: string | null): Promise<CreateGameResponse> {
    const resumeToken = this.tokenGenerator();
    const game: GameRecord = {
      id: this.idGenerator(),
      resumeTokenHash: await hashToken(resumeToken),
      questionId: question.id,
      category: question.category,
      status: 'active',
      startedAt: this.now(),
      endedAt: null,
      hintCount: 0,
      mode,
      dailyDate,
    };
    await this.options.store.createGame(game);
    return { game: await this.toPublicGame(game, question), resumeToken };
  }

  async restoreGame(gameId: string, resumeToken: string): Promise<PublicGame> {
    const { game, question } = await this.authenticate(gameId, resumeToken);
    return this.toPublicGame(game, question);
  }

  async submitGuess(gameId: string, resumeToken: string, rawGuess: unknown): Promise<PublicGame> {
    const validated = validateGuess(rawGuess);
    if (!validated.ok) {
      throw new GameError('VALIDATION_ERROR', validated.message, 400, false, 'guess');
    }
    const { game, question } = await this.authenticate(gameId, resumeToken);
    if (game.status !== 'active') {
      throw new GameError('GAME_FINISHED', '这局已经结束，请开始新的一局。', 409);
    }
    const claimedAt = this.now();
    const claimToken = this.claimTokenGenerator();
    const claim = await this.options.store.claimGuess(
      gameId,
      validated.value,
      claimToken,
      claimedAt,
      claimedAt - GUESS_CLAIM_TTL_MS,
    );
    if (claim === 'duplicate' || claim === 'in-flight') {
      throw new GameError('DUPLICATE_GUESS', '这个词已经猜过了。', 409, false, 'guess');
    }
    if (claim === 'finished') {
      throw new GameError('GAME_FINISHED', '这局已经结束，请开始新的一局。', 409);
    }
    if (claim === 'missing') throw notFoundError();

    let releaseClaim = true;
    try {
      const exact = validated.value === question.answer.normalize('NFKC').trim();
      let scoreMilliPercent = 100_000;
      if (!exact) {
        try {
          const namespace = this.options.scorer.cacheNamespace;
          const cached = namespace
            ? await this.options.store.getSemanticScore(namespace, question.id, validated.value)
            : null;
          if (cached === null) {
            scoreMilliPercent = capNonExactScore(
              await this.options.scorer.scoreNonExact(validated.value, question),
            );
            if (namespace) {
              await this.options.store.putSemanticScore(namespace, question.id, validated.value, scoreMilliPercent, this.now());
            }
          } else {
            scoreMilliPercent = cached;
          }
        } catch (error) {
          const isConfigurationError =
            (error instanceof SemanticScorerError && error.kind === 'configuration') ||
            (error instanceof Error && error.message.startsWith('CONFIGURATION_ERROR:'));
          const retryable =
            error instanceof SemanticScorerError ? error.retryable : !isConfigurationError;
          throw new GameError(
            isConfigurationError ? 'CONFIGURATION_ERROR' : 'SCORER_UNAVAILABLE',
            isConfigurationError
              ? 'AI 语义评分配置不可用，请检查服务端配置。'
              : 'AI 暂时无法计算关系分，请稍后重试。',
            503,
            retryable,
            'guess',
          );
        }
      }

      const mutation = await this.options.store.commitGuess(
        gameId,
        {
          normalizedGuess: validated.value,
          displayGuess: validated.value,
          scoreMilliPercent,
          temperature: scoreToTemperature(scoreMilliPercent),
          createdAt: this.now(),
        },
        exact,
        claimToken,
      );
      releaseClaim = false;
      if (mutation === 'duplicate' || mutation === 'claim-lost') {
        throw new GameError('DUPLICATE_GUESS', '这个词已经猜过了。', 409, false, 'guess');
      }
      if (mutation === 'finished') {
        throw new GameError('GAME_FINISHED', '这局已经结束，请开始新的一局。', 409);
      }
      if (mutation === 'missing') throw notFoundError();
      const updated = await this.options.store.getGame(gameId);
      if (!updated) throw notFoundError();
      return this.toPublicGame(updated, question);
    } finally {
      if (releaseClaim) {
        await this.options.store
          .releaseGuessClaim(gameId, validated.value, claimToken)
          .catch(() => undefined);
      }
    }
  }

  async useHint(gameId: string, resumeToken: string): Promise<PublicGame> {
    await this.authenticate(gameId, resumeToken);
    const mutation = await this.options.store.useHint(gameId);
    if (mutation === 'exhausted') {
      throw new GameError('HINTS_EXHAUSTED', '本局的三条提示已经全部使用。', 409);
    }
    if (mutation === 'finished') {
      throw new GameError('GAME_FINISHED', '这局已经结束，不能再获取提示。', 409);
    }
    if (mutation === 'missing') throw notFoundError();
    return this.restoreGame(gameId, resumeToken);
  }

  async abandon(gameId: string, resumeToken: string): Promise<PublicGame> {
    const { question } = await this.authenticate(gameId, resumeToken);
    const mutation = await this.options.store.abandon(gameId, this.now());
    if (mutation === 'already-finished') {
      throw new GameError('GAME_FINISHED', '这局已经结束。', 409);
    }
    if (mutation === 'missing') throw notFoundError();
    const updated = await this.options.store.getGame(gameId);
    if (!updated) throw notFoundError();
    return this.toPublicGame(updated, question);
  }

  async submitScoreFeedback(gameId: string, resumeToken: string, rawGuess: unknown, direction: unknown): Promise<void> {
    const validated = validateGuess(rawGuess);
    if (!validated.ok || (direction !== 'too_high' && direction !== 'too_low')) {
      throw new GameError('VALIDATION_ERROR', '请选择“评分偏高”或“评分偏低”。', 400);
    }
    await this.authenticate(gameId, resumeToken);
    if (!(await this.options.store.hasGuess(gameId, validated.value))) {
      throw new GameError('VALIDATION_ERROR', '只能反馈本局已经猜过的词。', 400);
    }
    await this.options.store.recordScoreFeedback(gameId, validated.value, direction, this.now());
  }

  getAiStats() { return this.options.store.getAiStats(); }

  private async authenticate(
    gameId: string,
    resumeToken: string,
  ): Promise<{ game: GameRecord; question: Question }> {
    if (!isUuid(gameId) || !resumeToken) throw notFoundError();
    const game = await this.options.store.getGame(gameId);
    if (!game || (await hashToken(resumeToken)) !== game.resumeTokenHash) {
      throw notFoundError();
    }
    const question = getQuestionById(game.questionId);
    if (!question) throw new GameError('INTERNAL_ERROR', '本局题目暂时不可用。', 500);
    return { game, question };
  }

  private async toPublicGame(game: GameRecord, question: Question): Promise<PublicGame> {
    const guesses = await this.options.store.getGuesses(game.id);
    const publicGuesses = guesses.map(toPublicGuess);
    const bestGuess = guesses
      .filter((item) => item.scoreMilliPercent < 100_000)
      .sort(
        (a, b) =>
          b.scoreMilliPercent - a.scoreMilliPercent || a.sequence - b.sequence,
      )[0];
    const revealedHints = buildHints(question).slice(0, game.hintCount);
    const endedAt = game.endedAt ?? undefined;
    return {
      gameId: game.id,
      status: game.status,
      scoringMode: this.scoringMode,
      mode: game.mode ?? 'random',
      ...(game.dailyDate ? { dailyDate: game.dailyDate } : {}),
      category: question.category,
      answerLength: question.length,
      startedAt: new Date(game.startedAt).toISOString(),
      ...(endedAt === undefined
        ? {}
        : {
            endedAt: new Date(endedAt).toISOString(),
            durationSeconds: Math.max(0, Math.floor((endedAt - game.startedAt) / 1000)),
            answer: question.answer,
          }),
      guessCount: publicGuesses.length,
      hintCount: game.hintCount,
      revealedHints,
      guesses: publicGuesses,
      bestGuess: bestGuess ? toPublicGuess(bestGuess) : null,
    };
  }
}

function chinaDate(timestamp: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(timestamp));
}

function toPublicGuess(record: GuessRecord): PublicGuess {
  return {
    sequence: record.sequence,
    guess: record.displayGuess,
    score: scoreMilliPercentToPercent(record.scoreMilliPercent),
    // Derive the public label from the score so restored games immediately
    // receive the latest, clearer wording even if an older label was stored.
    temperature: scoreToTemperature(record.scoreMilliPercent),
    submittedAt: new Date(record.createdAt).toISOString(),
  };
}

function buildHints(question: Question): PublicHint[] {
  return [
    { level: 1, label: '更具体的范围', value: question.subcategory },
    { level: 2, label: '高关联参考词', value: question.hotHint },
    { level: 3, label: '开头字', value: Array.from(question.answer)[0] },
  ];
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

export async function hashToken(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function notFoundError(): GameError {
  return new GameError('GAME_NOT_FOUND', '找不到这局游戏，请开始新的一局。', 404);
}
