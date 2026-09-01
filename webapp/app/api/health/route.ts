import { getRuntimeGameService } from '@/lib/server/runtime';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    await getRuntimeGameService();
    return Response.json(
      { status: 'ok' },
      {
        headers: {
          'Cache-Control': 'no-store, max-age=0',
          'X-Content-Type-Options': 'nosniff',
        },
      },
    );
  } catch {
    return Response.json(
      { status: 'unavailable' },
      {
        status: 503,
        headers: {
          'Cache-Control': 'no-store, max-age=0',
          'X-Content-Type-Options': 'nosniff',
        },
      },
    );
  }
}
