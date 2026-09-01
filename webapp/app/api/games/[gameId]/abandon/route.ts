import { abandonGameController } from '@/lib/server/controllers';
import { runtimeErrorResponse } from '@/lib/server/runtime-error-response';
import { getRuntimeGameService } from '@/lib/server/runtime';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  context: { params: Promise<{ gameId: string }> },
): Promise<Response> {
  const { gameId } = await context.params;
  try {
    return abandonGameController(request, await getRuntimeGameService(), gameId);
  } catch (error) {
    return runtimeErrorResponse(error);
  }
}
