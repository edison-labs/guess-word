import { createGameController } from '@/lib/server/controllers';
import { runtimeErrorResponse } from '@/lib/server/runtime-error-response';
import { getRuntimeServices } from '@/lib/server/runtime';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  try {
    const services = await getRuntimeServices();
    return createGameController(request, services.game, services.account);
  } catch (error) {
    return runtimeErrorResponse(error);
  }
}
