import { describe, expect, it } from 'vitest';
import { runtimeErrorResponse } from '../../lib/server/runtime-error-response';

describe('runtime error response', () => {
  it('marks explicit configuration failures as non-retryable', async () => {
    const response = runtimeErrorResponse(
      new Error('CONFIGURATION_ERROR: D1 binding is unavailable.'),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: {
        code: 'CONFIGURATION_ERROR',
        message: '游戏服务尚未正确配置。',
        retryable: false,
      },
    });
  });

  it('keeps transient initialization failures retryable without leaking details', async () => {
    const response = runtimeErrorResponse(new Error('upstream database timeout: secret detail'));

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: '游戏服务暂时不可用，请稍后重试。',
        retryable: true,
      },
    });
    expect(JSON.stringify(body)).not.toContain('secret detail');
  });
});
