export function runtimeErrorResponse(error: unknown): Response {
  const configurationError =
    error instanceof Error && error.message.startsWith('CONFIGURATION_ERROR:');
  return new Response(
    JSON.stringify({
      error: {
        code: configurationError ? 'CONFIGURATION_ERROR' : 'INTERNAL_ERROR',
        message: configurationError
          ? '游戏服务尚未正确配置。'
          : '游戏服务暂时不可用，请稍后重试。',
        retryable: !configurationError,
      },
    }),
    {
      status: 503,
      headers: {
        'Cache-Control': 'no-store, max-age=0',
        'Content-Type': 'application/json; charset=utf-8',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
      },
    },
  );
}
