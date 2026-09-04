import { createChallengeGameController } from '@/lib/server/controllers';
import { runtimeErrorResponse } from '@/lib/server/runtime-error-response';
import { getRuntimeGameService } from '@/lib/server/runtime';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  try {
    return createChallengeGameController(request, await getRuntimeGameService());
  } catch (error) {
    return runtimeErrorResponse(error);
  }
}
