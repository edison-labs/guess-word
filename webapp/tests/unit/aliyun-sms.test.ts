import { describe, expect, it } from 'vitest';
import type { SendSmsRequest } from '@alicloud/dysmsapi20170525';
import { AliyunSmsProvider, createAliyunSmsProvider } from '../../lib/server/aliyun-sms';
import { SmsProviderError } from '../../lib/server/sms';

const config = {
  accessKeyId: 'test-access-key-id',
  accessKeySecret: 'test-access-key-secret',
  signName: '猜词测试',
  templateCode: 'SMS_123456789',
};

describe('Alibaba Cloud SMS provider', () => {
  it('maps a login code to the approved SMS template parameters', async () => {
    let request: SendSmsRequest | undefined;
    const provider = new AliyunSmsProvider(config, {
      async sendSms(value) {
        request = value;
        return { body: { code: 'OK' } };
      },
    });

    await provider.sendLoginCode('13800138000', '123456');
    expect(request).toMatchObject({
      phoneNumbers: '13800138000',
      signName: '猜词测试',
      templateCode: 'SMS_123456789',
      templateParam: '{"code":"123456"}',
    });
  });

  it('turns provider rejection into a safe service error', async () => {
    const provider = new AliyunSmsProvider(config, {
      async sendSms() { return { body: { code: 'isv.BUSINESS_LIMIT_CONTROL' } }; },
    });
    await expect(provider.sendLoginCode('13800138000', '123456')).rejects.toBeInstanceOf(SmsProviderError);
  });

  it('reports missing production settings as a configuration error', async () => {
    const provider = createAliyunSmsProvider({});
    await expect(provider.sendLoginCode('13800138000', '123456')).rejects.toMatchObject({ configuration: true });
  });
});
