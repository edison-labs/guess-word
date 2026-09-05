import { questionProgressController } from '@/lib/server/controllers';
import { getRuntimeAccountService } from '@/lib/server/runtime';
import { runtimeErrorResponse } from '@/lib/server/runtime-error-response';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  try { return questionProgressController(request, await getRuntimeAccountService()); }
  catch (error) { return runtimeErrorResponse(error); }
}
