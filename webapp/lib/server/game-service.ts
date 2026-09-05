import { ANSWER_LENGTH_UNLOCK_GUESSES, MAX_HINT_COUNT } from '../contracts';
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
import { getActiveQuestionCount, getQuestionById, selectDailyQuestion, selectRandomQuestion, type Question } from './questions';
import {
  fallbackRelationHint,
  SemanticScorerError,
  type SemanticScore,
  type SemanticScorer,
} from './scoring';

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
  questionSelector?: (category: GameCategory, excludedQuestionIds: ReadonlySet<string>) => Question;
  idGenerator?: () => string;
  tokenGenerator?: () => string;
  claimTokenGenerator?: () => string;
  scoringMode?: ScoringMode;
};

const GUESS_CLAIM_TTL_MS = 15_000;

export class GameService {
  private readonly now: () => number;
  private readonly questionSelector: (category: GameCategory, excludedQuestionIds: ReadonlySet<string>) => Question;
  private readonly idGenerator: () => string;
  private readonly tokenGenerator: () => string;
  private readonly claimTokenGenerator: () => string;
  private readonly scoringMode: ScoringMode;

  constructor(private readonly options: GameServiceOptions) {
    this.now = options.now ?? (() => Date.now());
    this.questionSelector =
      options.questionSelector ??
      ((category, excludedQuestionIds) =>
        selectRandomQuestion(category, undefined, excludedQuestionIds));
    this.idGenerator = options.idGenerator ?? (() => crypto.randomUUID());
    this.tokenGenerator = options.tokenGenerator ?? randomToken;
    this.claimTokenGenerator = options.claimTokenGenerator ?? randomToken;
    this.scoringMode = options.scoringMode ?? 'test';
  }

  async createGame(
    category: GameCategory,
    excludeGameIds: readonly string[] = [],
    ownerId: string | null = null,
  ): Promise<CreateGameResponse> {
    let seenQuestionIds: string[] = [];
    if (ownerId) {
      seenQuestionIds = await this.options.store.getSeenQuestionIds(ownerId, category);
      if (seenQuestionIds.length >= getActiveQuestionCount(category)) {
        await this.options.store.resetQuestionProgress(ownerId, category);
        seenQuestionIds = [];
      }
    }
    const excludedGames = await Promise.all(
      excludeGameIds.slice(0, 12).map((gameId) => this.options.store.getGame(gameId)),
    );
    const excludedQuestionIds = new Set(
      excludedGames
        .filter(
          (game): game is GameRecord =>
            game !== null && game.category === category && game.status !== 'active',
        )
        .map((game) => game.questionId),
    );
    for (const questionId of seenQuestionIds) excludedQuestionIds.add(questionId);
    let question = this.questionSelector(category, excludedQuestionIds);
    if (seenQuestionIds.includes(question.id)) {
      question = this.questionSelector(category, new Set(seenQuestionIds));
    }
    if (question.category !== category) {
      throw new GameError('INTERNAL_ERROR', '所选分类暂时没有可用题目。', 500);
    }
    const created = await this.createGameForQuestion(question, 'random', null, ownerId, null);
    if (ownerId) await this.options.store.recordQuestionSeen(ownerId, category, question.id, this.now());
    return created;
  }

  async createDailyGame(ownerId: string | null = null): Promise<CreateGameResponse> {
    const date = chinaDate(this.now());
    return this.createGameForQuestion(selectDailyQuestion(date), 'daily', date, ownerId, null);
  }

  async createChallengeGame(
    sourceGameId: string,
    ownerId: string | null = null,
  ): Promise<CreateGameResponse> {
    if (!isUuid(sourceGameId)) {
      throw new GameError('GAME_NOT_FOUND', '这道分享题不存在或已失效。', 404);
    }
    const sourceGame = await this.options.store.getGame(sourceGameId);
    if (!sourceGame) {
      throw new GameError('GAME_NOT_FOUND', '这道分享题不存在或已失效。', 404);
    }
    const question = getQuestionById(sourceGame.questionId);
    if (!question) {
      throw new GameError('GAME_NOT_FOUND', '这道分享题不存在或已失效。', 404);
    }
    return this.createGameForQuestion(
      question,
      'random',
      null,
      ownerId,
      sourceGame.challengeRootGameId ?? sourceGame.id,
    );
  }

  private async createGameForQuestion(
    question: Question,
    mode: 'random' | 'daily',
    dailyDate: string | null,
    ownerId: string | null,
    challengeRootGameId: string | null,
  ): Promise<CreateGameResponse> {
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
      ownerId,
      challengeRootGameId,
    };
    const stored = mode === 'daily'
      ? await this.options.store.createOrResumeDailyGame(game)
      : (await this.options.store.createGame(game), game);
    const storedQuestion = stored.questionId === question.id ? question : getQuestionById(stored.questionId);
    if (!storedQuestion) throw new GameError('GAME_NOT_FOUND', '这道题已经下线。', 404);
    return { game: await this.toPublicGame(stored, storedQuestion), resumeToken };
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
      let relationHint = '和目标词完全一致';
      if (!exact) {
        try {
          const namespace = this.options.scorer.cacheNamespace;
          const cached = namespace
            ? await this.options.store.getSemanticScore(namespace, question.id, validated.value)
            : null;
          if (cached === null) {
            const scored = normalizeSemanticScore(
              await this.options.scorer.scoreNonExact(validated.value, question),
            );
            scoreMilliPercent = scored.scoreMilliPercent;
            relationHint = scored.relationHint;
            if (namespace) {
              await this.options.store.putSemanticScore(namespace, question.id, validated.value, scored, this.now());
            }
          } else {
            scoreMilliPercent = cached.scoreMilliPercent;
            relationHint = cached.relationHint || fallbackRelationHint(scoreMilliPercent);
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
          relationHint,
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
      throw new GameError('HINTS_EXHAUSTED', '本局的两条提示已经全部使用。', 409);
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
    const tokenHash = await hashToken(resumeToken);
    if (!game || (tokenHash !== game.resumeTokenHash && !(await this.options.store.hasGameAccessToken(gameId, tokenHash)))) {
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
    const publicHintCount = Math.min(game.hintCount, MAX_HINT_COUNT);
    const revealedHints = buildHints(question).slice(0, publicHintCount);
    const endedAt = game.endedAt ?? undefined;
    return {
      gameId: game.id,
      status: game.status,
      scoringMode: this.scoringMode,
      mode: game.mode ?? 'random',
      ...(game.dailyDate ? { dailyDate: game.dailyDate } : {}),
      category: question.category,
      ...(game.status === 'active' && publicGuesses.length >= ANSWER_LENGTH_UNLOCK_GUESSES
        ? { answerLength: question.length }
        : {}),
      startedAt: new Date(game.startedAt).toISOString(),
      ...(endedAt === undefined
        ? {}
        : {
            endedAt: new Date(endedAt).toISOString(),
            durationSeconds: Math.max(0, Math.floor((endedAt - game.startedAt) / 1000)),
            answer: question.answer,
          }),
      guessCount: publicGuesses.length,
      hintCount: publicHintCount,
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
    relationHint: record.relationHint || fallbackRelationHint(record.scoreMilliPercent),
    submittedAt: new Date(record.createdAt).toISOString(),
  };
}

function normalizeSemanticScore(value: number | SemanticScore): SemanticScore {
  if (typeof value === 'number') {
    const scoreMilliPercent = capNonExactScore(value);
    return {
      scoreMilliPercent,
      relationHint: fallbackRelationHint(scoreMilliPercent),
    };
  }
  const scoreMilliPercent = capNonExactScore(value.scoreMilliPercent);
  return {
    scoreMilliPercent,
    relationHint: value.relationHint.trim() || fallbackRelationHint(scoreMilliPercent),
  };
}

function buildHints(question: Question): PublicHint[] {
  return [
    { level: 1, label: '思考方向', value: broadHintForCategory(question.category) },
    { level: 2, label: '缩小范围', value: fineHintForQuestion(question) },
  ];
}

function broadHintForCategory(category: Question['category']): string {
  return {
    '动物': '先从生活环境、活动方式和外形特征考虑',
    '食物': '先从食用场景、口感和制作方式考虑',
    '职业': '先从工作场景、服务对象和常用工具考虑',
    '自然现象': '先从出现环境、形成条件和视觉表现考虑',
    '抽象概念': '先从人的感受、选择和行为状态考虑',
    '日常物品': '先从使用场景、核心功能和操作方式考虑',
    '历史人物': '先从所处时代、人物身份和活动领域考虑',
    '体育圈': '先从运动项目、赛场角色和代表经历考虑',
  }[category];
}

function fineHintForQuestion(question: Question): string {
  const detail = question.subcategory;
  switch (question.category) {
    case '动物':
      if (/寒冷|北极|南极|冰/.test(detail)) return '再从寒冷环境的适应方式和活动区域缩小';
      if (/海洋|水中|水生|河/.test(detail)) return '再从水域环境和行动方式缩小';
      if (/夜间|夜行|发光/.test(detail)) return '再从活动时段和感知方式缩小';
      if (/草原|沙漠|干旱|高原|澳洲|南美/.test(detail)) return '再从地理环境和移动方式缩小';
      return '再从所属动物大类、食性和身体结构缩小';
    case '食物':
      if (/饮品|冲泡|发酵|奶|水/.test(detail)) return '再从饮用温度、原料和口味缩小';
      if (/甜|零食|糕点|烘焙|庆祝/.test(detail)) return '再从甜咸口味和常见食用场合缩小';
      if (/主食|稻米|面食|谷物/.test(detail)) return '再从主要原料和饮食中的位置缩小';
      if (/传统|端午|中秋|年夜/.test(detail)) return '再从节日场景和制作形式缩小';
      return '再从原料来源、烹饪方式和食用时机缩小';
    case '职业':
      if (/医疗|疾病|护理|口腔|诊断/.test(detail)) return '再从健康服务的对象和工作地点缩小';
      if (/法律|法庭|案件|公共秩序/.test(detail)) return '再从规则执行方式和服务对象缩小';
      if (/学校|知识|研究|自然规律/.test(detail)) return '再从知识生产或传递的场景缩小';
      if (/艺术|绘画|影像|新闻|报道/.test(detail)) return '再从内容创作方式和成果形态缩小';
      return '再从主要工作地点和每日任务缩小';
    case '自然现象':
      if (/天体|夜空|高纬|太阳|月球|天文|光/.test(detail)) return '再从天空中的出现条件和光影变化缩小';
      if (/风|云|雨|对流|气/.test(detail)) return '再从大气条件、强度和持续时间缩小';
      if (/雪|冰|低温|凝华/.test(detail)) return '再从温度条件和物质形态变化缩小';
      if (/海|河|水/.test(detail)) return '再从水体运动方式和规模缩小';
      return '再从地表或地下的形成过程和速度缩小';
    case '抽象概念':
      if (/情感|感受|期待|惋惜|满足|陪伴/.test(detail)) return '再从情绪的触发原因和持续方式缩小';
      if (/品质|态度|价值|公正|诚恳|职责/.test(detail)) return '再从个人品质与对他人的影响缩小';
      if (/理解|思路|想法|未知|能力/.test(detail)) return '再从思考过程和它带来的行动缩小';
      return '再从它对人的行为和选择产生的影响缩小';
    case '日常物品':
      if (/电器|设备|计算机|电源|电量|照明/.test(detail)) return '再从供能方式、操作位置和输出效果缩小';
      if (/厨房|食物|饮用|餐具|容器/.test(detail)) return '再从家庭使用区域和接触的物品缩小';
      if (/个人|牙齿|头发|耳朵|佩戴|睡眠/.test(detail)) return '再从与身体的互动方式和使用时段缩小';
      if (/旅行|携带|背负|装载|学生/.test(detail)) return '再从携带方式、收纳对象和出现场景缩小';
      return '再从它处理的对象、手部动作和使用结果缩小';
    case '历史人物':
      if (/思想|教育|儒家|心学/.test(detail)) return '再从思想传播、教育影响和学派缩小';
      if (/文学|诗人|书画|作家|史学/.test(detail)) return '再从文化成就、作品类型和时代缩小';
      if (/皇帝|政治|军事|名将|建立者|帝国/.test(detail)) return '再从政权、军事或国家治理方面缩小';
      return '再从主要成就的领域和历史影响缩小';
    case '体育圈':
      if (/球|篮球|足球|羽毛球|乒乓/.test(detail)) return '再从球类项目的器械、场地和赛场角色缩小';
      if (/游泳|跳水|水上/.test(detail)) return '再从水上项目的动作特点和比赛方式缩小';
      if (/跑|跨栏|田径|马拉松/.test(detail)) return '再从速度、耐力和赛道特点缩小';
      return '再从力量、技巧或身体协调方式缩小';
  }
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
