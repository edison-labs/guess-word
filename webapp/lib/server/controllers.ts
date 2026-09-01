import { isGameCategory, type ApiErrorBody, type GameResponse } from '../contracts';
import { GameError, type GameService } from './game-service';

const rateWindows = new Map<string, number[]>();
const WINDOW_MS = 10_000;
const MAX_GUESSES_PER_WINDOW = 15;

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
): Promise<Response> {
  try {
    assertSameOrigin(request);
    const body = await parseJsonObject(request);
    assertOnlyKeys(body, ['category']);
    if (!isGameCategory(body.category)) {
      throw invalidRequest('请选择有效的题目分类。');
    }
    return json(await service.createGame(body.category), 201);
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

function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: SECURITY_HEADERS });
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

function assertSameOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) {
    throw invalidRequest('不允许跨站提交。');
  }
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

function invalidRequest(message: string): GameError {
  return new GameError('INVALID_REQUEST', message, 400);
}

export function resetRateLimitsForTests(): void {
  rateWindows.clear();
}
