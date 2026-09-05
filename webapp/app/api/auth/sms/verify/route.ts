import { verifyLoginCodeController } from '@/lib/server/controllers';
import { runtimeErrorResponse } from '@/lib/server/runtime-error-response';
import { getRuntimeAccountService } from '@/lib/server/runtime';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  try { return verifyLoginCodeController(request, await getRuntimeAccountService()); }
  catch (error) { return runtimeErrorResponse(error); }
}
