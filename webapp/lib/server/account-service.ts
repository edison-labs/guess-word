import type {
  AccountDashboardResponse,
  AccountGameSummary,
  AccountUser,
  LeaderboardEntry,
  LeaderboardResponse,
  QuestionProgressResponse,
  ViewerResponse,
} from '../contracts';
import { GameError } from './game-service';
import type { AccountSessionRecord, AccountStore, OwnedGameResult, UserRecord } from './account-store';
import type { GameStore } from './game-store';
import { GAME_CATEGORIES } from '../contracts';
import { getActiveQuestionCount, getQuestionById } from './questions';
import { SmsProviderError, type SmsProvider } from './sms';

const COOKIE_NAME = 'guessword_auth';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const CODE_TTL_MS = 5 * 60 * 1_000;
const CODE_COOLDOWN_MS = 60 * 1_000;
const MAX_CODES_PER_HOUR = 5;
const MAX_CODE_ATTEMPTS = 5;

type AccountServiceOptions = {
  store: AccountStore & GameStore;
  sms: SmsProvider;
  secret: string;
  now?: () => number;
  idGenerator?: () => string;
  tokenGenerator?: () => string;
  codeGenerator?: () => string;
};

export type ViewerContext = {
  session: AccountSessionRecord;
  user: UserRecord | null;
  setCookie?: string;
};

export class AccountService {
  private readonly now: () => number;
  private readonly idGenerator: () => string;
  private readonly tokenGenerator: () => string;
  private readonly codeGenerator: () => string;

  constructor(private readonly options: AccountServiceOptions) {
    if (options.secret.length < 32) {
      throw new Error('CONFIGURATION_ERROR: AUTH_SECRET must contain at least 32 characters.');
    }
    this.now = options.now ?? (() => Date.now());
    this.idGenerator = options.idGenerator ?? (() => crypto.randomUUID());
    this.tokenGenerator = options.tokenGenerator ?? randomToken;
    this.codeGenerator = options.codeGenerator ?? randomCode;
  }

  async ensureViewer(request: Request): Promise<ViewerContext> {
    const existing = await this.findViewer(request);
    return existing ?? this.createGuestViewer(request);
  }

  private async findViewer(request: Request): Promise<ViewerContext | null> {
    const token = readCookie(request.headers.get('cookie'), COOKIE_NAME);
    if (token) {
      const session = await this.options.store.getAccountSessionByTokenHash(await digest(token));
      if (session && session.expiresAt > this.now()) {
        const user = session.userId ? await this.options.store.getUserById(session.userId) : null;
        return { session, user };
      }
      if (session) await this.options.store.deleteAccountSession(session.id);
    }
    return null;
  }

  toViewerResponse(context: ViewerContext): ViewerResponse {
    return {
      authenticated: Boolean(context.user),
      user: context.user ? toAccountUser(context.user) : null,
    };
  }

  async requestLoginCode(rawPhone: unknown): Promise<{ cooldownSeconds: number }> {
    const phone = normalizePhone(rawPhone);
    const phoneHash = await this.protectedHash(`phone:${phone}`);
    const latest = await this.options.store.getLatestVerificationCode(phoneHash);
    const now = this.now();
    if (latest && now - latest.createdAt < CODE_COOLDOWN_MS) {
      throw new GameError('RATE_LIMITED', '验证码发送得太频繁，请一分钟后再试。', 429, true);
    }
    if ((await this.options.store.countVerificationCodes(phoneHash, now - 60 * 60 * 1_000)) >= MAX_CODES_PER_HOUR) {
      throw new GameError('RATE_LIMITED', '这个手机号一小时内尝试得太频繁，请稍后再试。', 429, true);
    }
    const code = this.codeGenerator();
    if (!/^\d{6}$/.test(code)) throw new Error('Verification code generator returned an invalid code.');
    try {
      await this.options.sms.sendLoginCode(phone, code);
    } catch (error) {
      const configuration = error instanceof SmsProviderError && error.configuration;
      throw new GameError(
        configuration ? 'CONFIGURATION_ERROR' : 'SMS_UNAVAILABLE',
        configuration ? '短信登录尚未完成服务端配置。' : '验证码暂时发送失败，请稍后重试。',
        503,
        !configuration,
      );
    }
    await this.options.store.createVerificationCode({
      id: this.idGenerator(),
      phoneHash,
      codeHash: await this.protectedHash(`code:${phoneHash}:${code}`),
      createdAt: now,
      expiresAt: now + CODE_TTL_MS,
      consumedAt: null,
      attempts: 0,
    });
    return { cooldownSeconds: CODE_COOLDOWN_MS / 1_000 };
  }

  async verifyLoginCode(
    request: Request,
    rawPhone: unknown,
    rawCode: unknown,
  ): Promise<ViewerContext> {
    const context = await this.ensureViewer(request);
    const phone = normalizePhone(rawPhone);
    if (typeof rawCode !== 'string' || !/^\d{6}$/.test(rawCode)) {
      throw new GameError('INVALID_REQUEST', '请输入 6 位短信验证码。', 400);
    }
    const phoneHash = await this.protectedHash(`phone:${phone}`);
    const record = await this.options.store.getLatestVerificationCode(phoneHash);
    const now = this.now();
    if (!record || record.consumedAt !== null || record.expiresAt <= now || record.attempts >= MAX_CODE_ATTEMPTS) {
      throw new GameError('INVALID_REQUEST', '验证码无效或已过期，请重新获取。', 400);
    }
    const expected = await this.protectedHash(`code:${phoneHash}:${rawCode}`);
    if (expected !== record.codeHash) {
      await this.options.store.incrementVerificationAttempts(record.id);
      throw new GameError('INVALID_REQUEST', '验证码不正确。', 400);
    }
    if (!(await this.options.store.consumeVerificationCode(record.id, now))) {
      throw new GameError('INVALID_REQUEST', '验证码已使用，请重新获取。', 400);
    }
    let user = await this.options.store.getUserByPhoneHash(phoneHash);
    if (!user) {
      user = {
        id: this.idGenerator(),
        phoneHash,
        phoneLast4: phone.slice(-4),
        nickname: `玩家${phone.slice(-4)}`,
        createdAt: now,
        updatedAt: now,
      };
      try {
        await this.options.store.createUser(user);
      } catch (error) {
        const concurrentUser = await this.options.store.getUserByPhoneHash(phoneHash);
        if (!concurrentUser) throw error;
        user = concurrentUser;
      }
    }
    // Only a guest's games may be claimed. Logging into another account from an
    // authenticated session must never transfer the first account's history.
    if (!context.user) {
      await this.options.store.mergeGameOwner(context.session.playerId, user.id);
    }
    const token = this.tokenGenerator();
    const session: AccountSessionRecord = {
      ...context.session,
      tokenHash: await digest(token),
      playerId: user.id,
      userId: user.id,
      expiresAt: now + SESSION_TTL_MS,
    };
    await this.options.store.updateAccountSession(
      session.id,
      session.tokenHash,
      session.playerId,
      session.userId,
      session.expiresAt,
    );
    return { session, user, setCookie: sessionCookie(request, token) };
  }

  async logout(request: Request): Promise<ViewerContext> {
    const current = await this.ensureViewer(request);
    await this.options.store.deleteAccountSession(current.session.id);
    return this.createGuestViewer(request);
  }

  async updateNickname(request: Request, rawNickname: unknown): Promise<ViewerContext> {
    const context = await this.requireUser(request);
    const nickname = normalizeNickname(rawNickname);
    await this.options.store.updateUserNickname(context.user.id, nickname, this.now());
    return { ...context, user: { ...context.user, nickname, updatedAt: this.now() } };
  }

  async getDashboard(request: Request): Promise<AccountDashboardResponse> {
    const context = await this.requireUser(request);
    const results = await this.options.store.listOwnedGameResults(context.user.id, 1_000);
    const recent = results.slice(0, 20).map(toGameSummary);
    const wins = results.filter((game) => game.status === 'won');
    const bestGuessCount = wins.length > 0 ? Math.min(...wins.map((game) => game.guessCount)) : null;
    return {
      user: toAccountUser(context.user),
      stats: {
        completedGames: results.length,
        wonGames: wins.length,
        bestGuessCount,
        dailyStreak: calculateDailyStreak(results, this.now()),
      },
      recentGames: recent,
    };
  }

  async getDailyLeaderboard(request: Request, date?: string): Promise<LeaderboardResponse> {
    const context = await this.findViewer(request);
    const targetDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : chinaDate(this.now());
    const games = firstAttemptPerUser(await this.options.store.listDailyGameResults(targetDate));
    const ranked = rankGames(games.filter((game) => game.status === 'won'), context?.user?.id ?? null);
    return {
      kind: 'daily',
      title: `${targetDate} 每日挑战榜`,
      entries: ranked.slice(0, 100),
      participantCount: ranked.length,
      currentUserEntry: ranked.find((entry) => entry.isCurrentUser) ?? null,
    };
  }

  async getChallengeLeaderboard(request: Request, gameId: string): Promise<LeaderboardResponse> {
    const context = await this.findViewer(request);
    const game = await this.options.store.getGame(gameId);
    if (!game) throw new GameError('GAME_NOT_FOUND', '找不到这道好友挑战。', 404);
    const root = game.challengeRootGameId ?? game.id;
    const games = firstAttemptPerUser(await this.options.store.listChallengeGameResults(root));
    const ranked = rankGames(games.filter((item) => item.status === 'won'), context?.user?.id ?? null);
    return {
      kind: 'challenge',
      title: '好友同题榜',
      entries: ranked.slice(0, 100),
      participantCount: ranked.length,
      currentUserEntry: ranked.find((entry) => entry.isCurrentUser) ?? null,
    };
  }

  async getQuestionProgress(playerId: string): Promise<QuestionProgressResponse> {
    const counts = await this.options.store.getQuestionProgressCounts(playerId);
    return {
      categories: Object.fromEntries(GAME_CATEGORIES.map((category) => [category, {
        seen: Math.min(counts[category] ?? 0, getActiveQuestionCount(category)),
        total: getActiveQuestionCount(category),
      }])) as QuestionProgressResponse['categories'],
    };
  }

  private async requireUser(request: Request): Promise<ViewerContext & { user: UserRecord }> {
    const context = await this.ensureViewer(request);
    if (!context.user) throw new GameError('AUTH_REQUIRED', '登录后才能查看账号战绩。', 401);
    return { ...context, user: context.user };
  }

  private async createGuestViewer(request: Request): Promise<ViewerContext> {
    const token = this.tokenGenerator();
    const now = this.now();
    const session: AccountSessionRecord = {
      id: this.idGenerator(),
      tokenHash: await digest(token),
      playerId: this.idGenerator(),
      userId: null,
      createdAt: now,
      expiresAt: now + SESSION_TTL_MS,
    };
    await this.options.store.createAccountSession(session);
    return { session, user: null, setCookie: sessionCookie(request, token) };
  }

  private protectedHash(value: string): Promise<string> {
    return digest(`${this.options.secret}:${value}`);
  }
}

function normalizePhone(value: unknown): string {
  if (typeof value !== 'string') throw new GameError('INVALID_REQUEST', '请输入有效的中国大陆手机号。', 400);
  const normalized = value.replace(/[\s-]/g, '').replace(/^(?:\+?86|0086)/, '');
  if (!/^1[3-9]\d{9}$/.test(normalized)) {
    throw new GameError('INVALID_REQUEST', '请输入有效的中国大陆手机号。', 400);
  }
  return normalized;
}

function normalizeNickname(value: unknown): string {
  if (typeof value !== 'string') throw new GameError('INVALID_REQUEST', '昵称格式无效。', 400);
  const nickname = value.normalize('NFKC').trim();
  if (!/^[\p{Script=Han}A-Za-z0-9_]{2,12}$/u.test(nickname)) {
    throw new GameError('INVALID_REQUEST', '昵称需为 2～12 个中文、字母、数字或下划线。', 400);
  }
  return nickname;
}

function toAccountUser(user: UserRecord): AccountUser {
  return {
    id: user.id,
    nickname: user.nickname,
    maskedPhone: `****${user.phoneLast4}`,
    createdAt: new Date(user.createdAt).toISOString(),
  };
}

function toGameSummary(game: OwnedGameResult): AccountGameSummary {
  const question = getQuestionById(game.questionId);
  return {
    gameId: game.gameId,
    category: game.category as AccountGameSummary['category'],
    mode: game.mode,
    ...(game.dailyDate ? { dailyDate: game.dailyDate } : {}),
    status: game.status === 'won' ? 'won' : 'abandoned',
    answer: question?.answer ?? '题目已下线',
    guessCount: game.guessCount,
    hintCount: game.hintCount,
    durationSeconds: Math.max(0, Math.floor((game.endedAt - game.startedAt) / 1_000)),
    endedAt: new Date(game.endedAt).toISOString(),
  };
}

function firstAttemptPerUser(games: OwnedGameResult[]): OwnedGameResult[] {
  const earliest = new Map<string, OwnedGameResult>();
  for (const game of [...games].sort((a, b) => a.startedAt - b.startedAt)) {
    if (game.userId && !earliest.has(game.userId)) earliest.set(game.userId, game);
  }
  return [...earliest.values()];
}

function rankGames(games: OwnedGameResult[], currentUserId: string | null): LeaderboardEntry[] {
  return games
    .sort(
      (a, b) =>
        a.guessCount - b.guessCount ||
        a.hintCount - b.hintCount ||
        (a.endedAt - a.startedAt) - (b.endedAt - b.startedAt) ||
        a.endedAt - b.endedAt,
    )
    .map((game, index) => ({
      rank: index + 1,
      nickname: game.nickname ?? '玩家',
      guessCount: game.guessCount,
      hintCount: game.hintCount,
      durationSeconds: Math.max(0, Math.floor((game.endedAt - game.startedAt) / 1_000)),
      completedAt: new Date(game.endedAt).toISOString(),
      isCurrentUser: game.userId === currentUserId,
    }));
}

function calculateDailyStreak(results: OwnedGameResult[], now: number): number {
  const dates = new Set(
    results
      .filter((game) => game.mode === 'daily' && game.status === 'won' && game.dailyDate)
      .map((game) => game.dailyDate!),
  );
  let cursor = chinaDate(now);
  if (!dates.has(cursor)) cursor = chinaDate(now - 24 * 60 * 60 * 1_000);
  let streak = 0;
  while (dates.has(cursor)) {
    streak += 1;
    cursor = chinaDate(Date.parse(`${cursor}T00:00:00+08:00`) - 24 * 60 * 60 * 1_000);
  }
  return streak;
}

function chinaDate(timestamp: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(timestamp));
}

function readCookie(header: string | null, name: string): string | null {
  const item = header?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : null;
}

function sessionCookie(request: Request, token: string): string {
  const forwarded = request.headers.get('x-forwarded-proto')?.split(',', 1)[0]?.trim();
  const secure = (forwarded ?? new URL(request.url).protocol.slice(0, -1)) === 'https';
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1_000}${secure ? '; Secure' : ''}`;
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return encodeBase64Url(bytes);
}

function randomCode(): string {
  return String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0');
}

async function digest(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  return encodeBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
