import { viewerController } from '@/lib/server/controllers';
import { runtimeErrorResponse } from '@/lib/server/runtime-error-response';
import { getRuntimeAccountService } from '@/lib/server/runtime';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  try { return viewerController(request, await getRuntimeAccountService()); }
  catch (error) { return runtimeErrorResponse(error); }
}
