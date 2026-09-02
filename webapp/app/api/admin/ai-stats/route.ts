import { aiStatsController } from '@/lib/server/controllers';
import { runtimeErrorResponse } from '@/lib/server/runtime-error-response';
import { getRuntimeAdminToken, getRuntimeGameService } from '@/lib/server/runtime';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  try {
    return aiStatsController(request, await getRuntimeGameService(), getRuntimeAdminToken());
  } catch (error) {
    return runtimeErrorResponse(error);
  }
}
