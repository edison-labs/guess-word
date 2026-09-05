import { isGameCategory, type ApiErrorBody, type GameResponse } from '../contracts';
import type { AccountService } from './account-service';
import { GameError, type GameService } from './game-service';

const rateWindows = new Map<string, number[]>();
const smsRateWindows = new Map<string, number[]>();
const WINDOW_MS = 10_000;
const MAX_GUESSES_PER_WINDOW = 15;
const SMS_WINDOW_MS = 60 * 60 * 1_000;
const MAX_SMS_PER_CLIENT_WINDOW = 10;
const MAX_SMS_GLOBAL_WINDOW = 200;

const SECURITY_HEADERS = {
  'Cache-Control': 'no-store, max-age=0',
  'Content-Type': 'application/json; charset=utf-8',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
};

export async function createGameController(
  request: Request,
  service: GameService,
  accounts?: AccountService,
): Promise<Response> {
  try {
    assertSameOrigin(request);
    const body = await parseJsonObject(request);
    assertOnlyKeys(body, ['category', 'excludeGameIds']);
    if (!isGameCategory(body.category)) {
      throw invalidRequest('请选择有效的题目分类。');
    }
    const excludeGameIds = parseExcludeGameIds(body.excludeGameIds);
    const viewer = accounts ? await accounts.ensureViewer(request) : null;
    return withCookie(
      json(await service.createGame(body.category, excludeGameIds, viewer?.session.playerId), 201),
      viewer?.setCookie,
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function createDailyGameController(request: Request, service: GameService, accounts?: AccountService): Promise<Response> {
  try {
    assertSameOrigin(request);
    const body = await parseJsonObject(request);
    assertOnlyKeys(body, []);
    const viewer = accounts ? await accounts.ensureViewer(request) : null;
    return withCookie(json(await service.createDailyGame(viewer?.session.playerId), 201), viewer?.setCookie);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function createChallengeGameController(
  request: Request,
  service: GameService,
  accounts?: AccountService,
): Promise<Response> {
  try {
    assertSameOrigin(request);
    const body = await parseJsonObject(request);
    assertOnlyKeys(body, ['sourceGameId']);
    if (typeof body.sourceGameId !== 'string') {
      throw invalidRequest('分享题目编号无效。');
    }
    const viewer = accounts ? await accounts.ensureViewer(request) : null;
    return withCookie(
      json(await service.createChallengeGame(body.sourceGameId, viewer?.session.playerId), 201),
      viewer?.setCookie,
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function restoreGameController(
  request: Request,
  service: GameService,
  gameId: string,
): Promise<Response> {
  try {
    const game = await service.restoreGame(gameId, bearerToken(request));
    return json<GameResponse>({ game });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function submitGuessController(
  request: Request,
  service: GameService,
  gameId: string,
): Promise<Response> {
  try {
    assertSameOrigin(request);
    enforceRateLimit(gameId);
    const body = await parseJsonObject(request);
    assertOnlyKeys(body, ['guess']);
    const game = await service.submitGuess(gameId, bearerToken(request), body.guess);
    return json<GameResponse>({ game });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function requestHintController(
  request: Request,
  service: GameService,
  gameId: string,
): Promise<Response> {
  try {
    assertSameOrigin(request);
    const game = await service.useHint(gameId, bearerToken(request));
    return json<GameResponse>({ game });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function abandonGameController(
  request: Request,
  service: GameService,
  gameId: string,
): Promise<Response> {
  try {
    assertSameOrigin(request);
    const game = await service.abandon(gameId, bearerToken(request));
    return json<GameResponse>({ game });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function scoreFeedbackController(request: Request, service: GameService, gameId: string): Promise<Response> {
  try {
    assertSameOrigin(request);
    const body = await parseJsonObject(request);
    assertOnlyKeys(body, ['guess', 'direction']);
    await service.submitScoreFeedback(gameId, bearerToken(request), body.guess, body.direction);
    return json({ accepted: true });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function aiStatsController(request: Request, service: GameService, adminToken?: string): Promise<Response> {
  if (!adminToken || request.headers.get('authorization') !== `Bearer ${adminToken}`) {
    return json<ApiErrorBody>({ error: { code: 'GAME_NOT_FOUND', message: '接口不存在。', retryable: false } }, 404);
  }
  return json({ stats: await service.getAiStats() });
}

export async function viewerController(request: Request, accounts: AccountService): Promise<Response> {
  try {
    const context = await accounts.ensureViewer(request);
    return withCookie(json(accounts.toViewerResponse(context)), context.setCookie);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function questionProgressController(request: Request, accounts: AccountService): Promise<Response> {
  try {
    const context = await accounts.ensureViewer(request);
    return withCookie(json(await accounts.getQuestionProgress(context.session.playerId)), context.setCookie);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function requestLoginCodeController(request: Request, accounts: AccountService): Promise<Response> {
  try {
    assertSameOrigin(request);
    enforceSmsRateLimit(request);
    const body = await parseJsonObject(request);
    assertOnlyKeys(body, ['phone']);
    const context = await accounts.ensureViewer(request);
    return withCookie(json(await accounts.requestLoginCode(body.phone)), context.setCookie);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function verifyLoginCodeController(request: Request, accounts: AccountService): Promise<Response> {
  try {
    assertSameOrigin(request);
    const body = await parseJsonObject(request);
    assertOnlyKeys(body, ['phone', 'code']);
    const context = await accounts.verifyLoginCode(request, body.phone, body.code);
    return withCookie(json(accounts.toViewerResponse(context)), context.setCookie);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function logoutController(request: Request, accounts: AccountService): Promise<Response> {
  try {
    assertSameOrigin(request);
    const body = await parseJsonObject(request);
    assertOnlyKeys(body, []);
    const context = await accounts.logout(request);
    return withCookie(json(accounts.toViewerResponse(context)), context.setCookie);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function accountDashboardController(request: Request, accounts: AccountService): Promise<Response> {
  try {
    return json(await accounts.getDashboard(request));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function updateProfileController(request: Request, accounts: AccountService): Promise<Response> {
  try {
    assertSameOrigin(request);
    const body = await parseJsonObject(request);
    assertOnlyKeys(body, ['nickname']);
    const context = await accounts.updateNickname(request, body.nickname);
    return json(accounts.toViewerResponse(context));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function dailyLeaderboardController(request: Request, accounts: AccountService): Promise<Response> {
  try {
    const date = new URL(request.url).searchParams.get('date') ?? undefined;
    return json(await accounts.getDailyLeaderboard(request, date));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function challengeLeaderboardController(request: Request, accounts: AccountService): Promise<Response> {
  try {
    const gameId = new URL(request.url).searchParams.get('gameId');
    if (!gameId) throw invalidRequest('缺少好友挑战编号。');
    return json(await accounts.getChallengeLeaderboard(request, gameId));
  } catch (error) {
    return errorResponse(error);
  }
}

function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: SECURITY_HEADERS });
}

function withCookie(response: Response, cookie?: string): Response {
  if (cookie) response.headers.append('Set-Cookie', cookie);
  return response;
}

function errorResponse(error: unknown): Response {
  if (error instanceof GameError) {
    return json<ApiErrorBody>(
      {
        error: {
          code: error.code,
          message: error.message,
          retryable: error.retryable,
          ...(error.field ? { field: error.field } : {}),
        },
      },
      error.httpStatus,
    );
  }
  return json<ApiErrorBody>(
    {
      error: {
        code: 'INTERNAL_ERROR',
        message: '服务暂时不可用，请稍后重试。',
        retryable: true,
      },
    },
    500,
  );
}

async function parseJsonObject(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    throw invalidRequest('请求格式无效。');
  }
  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > 2_048) {
    throw invalidRequest('请求内容过大。');
  }
  const text = await request.text();
  if (text.length > 2_048) throw invalidRequest('请求内容过大。');
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw invalidRequest('请求格式无效。');
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof GameError) throw error;
    throw invalidRequest('请求格式无效。');
  }
}

function assertOnlyKeys(body: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(body).some((key) => !allowed.includes(key))) {
    throw invalidRequest('请求包含不支持的字段。');
  }
}

function parseExcludeGameIds(value: unknown): string[] {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.length > 12 ||
    value.some(
      (gameId) =>
        typeof gameId !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(gameId),
    )
  ) {
    throw invalidRequest('最近题目记录格式无效。');
  }
  return [...new Set(value)];
}

function assertSameOrigin(request: Request): void {
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite) {
    if (fetchSite !== 'same-origin') {
      throw invalidRequest('不允许跨站提交。');
    }
    return;
  }

  const origin = request.headers.get('origin');
  if (!origin) return;

  const requestUrl = new URL(request.url);
  const allowedOrigins = new Set([requestUrl.origin]);
  const forwardedHost = firstForwardedValue(request.headers.get('x-forwarded-host'));
  const host = forwardedHost ?? request.headers.get('host');
  const forwardedProtocol = firstForwardedValue(request.headers.get('x-forwarded-proto'));
  const protocol = forwardedProtocol ?? requestUrl.protocol.slice(0, -1);

  if (host && (protocol === 'http' || protocol === 'https')) {
    try {
      allowedOrigins.add(new URL(`${protocol}://${host}`).origin);
    } catch {
      // An invalid forwarding/host header must not weaken the origin check.
    }
  }

  if (!allowedOrigins.has(origin)) {
    throw invalidRequest('不允许跨站提交。');
  }
}

function firstForwardedValue(value: string | null): string | undefined {
  return value?.split(',', 1)[0]?.trim() || undefined;
}

function bearerToken(request: Request): string {
  const authorization = request.headers.get('authorization') ?? '';
  const match = /^Bearer ([A-Za-z0-9_-]{20,})$/.exec(authorization);
  if (!match) {
    throw new GameError('GAME_NOT_FOUND', '找不到这局游戏，请开始新的一局。', 404);
  }
  return match[1];
}

function enforceRateLimit(key: string): void {
  const now = Date.now();
  const current = (rateWindows.get(key) ?? []).filter((timestamp) => now - timestamp < WINDOW_MS);
  if (current.length >= MAX_GUESSES_PER_WINDOW) {
    throw new GameError('RATE_LIMITED', '提交得太快了，请稍等几秒再试。', 429, true, 'guess');
  }
  current.push(now);
  rateWindows.set(key, current);
  if (rateWindows.size > 2_000) rateWindows.clear();
}

function enforceSmsRateLimit(request: Request): void {
  const forwarded = firstForwardedValue(request.headers.get('x-forwarded-for'));
  const clientKey = forwarded && /^[0-9a-f:.]{3,45}$/i.test(forwarded) ? `client:${forwarded}` : null;
  const now = Date.now();
  const global = pruneRateWindow(smsRateWindows.get('global') ?? [], now, SMS_WINDOW_MS);
  const client = clientKey
    ? pruneRateWindow(smsRateWindows.get(clientKey) ?? [], now, SMS_WINDOW_MS)
    : [];
  if (global.length >= MAX_SMS_GLOBAL_WINDOW || (clientKey && client.length >= MAX_SMS_PER_CLIENT_WINDOW)) {
    throw new GameError('RATE_LIMITED', '验证码请求过于频繁，请稍后再试。', 429, true);
  }
  global.push(now);
  smsRateWindows.set('global', global);
  if (clientKey) {
    client.push(now);
    smsRateWindows.set(clientKey, client);
  }
  if (smsRateWindows.size > 2_000) smsRateWindows.clear();
}

function pruneRateWindow(values: number[], now: number, windowMs: number): number[] {
  return values.filter((timestamp) => now - timestamp < windowMs);
}

function invalidRequest(message: string): GameError {
  return new GameError('INVALID_REQUEST', message, 400);
}

export function resetRateLimitsForTests(): void {
  rateWindows.clear();
  smsRateWindows.clear();
}
