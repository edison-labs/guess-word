import Dysmsapi, { SendSmsRequest } from '@alicloud/dysmsapi20170525';
import { $OpenApiUtil } from '@alicloud/openapi-core';
import { SmsProviderError, type SmsProvider } from './sms';

export type AliyunSmsConfig = {
  accessKeyId: string;
  accessKeySecret: string;
  signName: string;
  templateCode: string;
};

type SmsClient = {
  sendSms(request: SendSmsRequest): Promise<{ body?: { code?: string } }>;
};

export class AliyunSmsProvider implements SmsProvider {
  private readonly client: SmsClient;

  constructor(private readonly config: AliyunSmsConfig, client?: SmsClient) {
    this.client = client ?? new Dysmsapi(
      new $OpenApiUtil.Config({
        accessKeyId: config.accessKeyId,
        accessKeySecret: config.accessKeySecret,
        endpoint: 'dysmsapi.aliyuncs.com',
        regionId: 'cn-hangzhou',
      }),
    );
  }

  async sendLoginCode(phone: string, code: string): Promise<void> {
    try {
      const response = await this.client.sendSms(
        new SendSmsRequest({
          phoneNumbers: phone,
          signName: this.config.signName,
          templateCode: this.config.templateCode,
          templateParam: JSON.stringify({ code }),
        }),
      );
      if (response.body?.code !== 'OK') {
        throw new SmsProviderError(`Aliyun SMS rejected the request: ${response.body?.code ?? 'UNKNOWN'}`);
      }
    } catch (error) {
      if (error instanceof SmsProviderError) throw error;
      throw new SmsProviderError('Aliyun SMS request failed.');
    }
  }
}

export function createAliyunSmsProvider(environment: Readonly<Record<string, string | undefined>>): SmsProvider {
  const accessKeyId = environment.ALIBABA_CLOUD_ACCESS_KEY_ID;
  const accessKeySecret = environment.ALIBABA_CLOUD_ACCESS_KEY_SECRET;
  const signName = environment.ALIYUN_SMS_SIGN_NAME;
  const templateCode = environment.ALIYUN_SMS_TEMPLATE_CODE;
  if (!accessKeyId || !accessKeySecret || !signName || !templateCode) {
    return {
      async sendLoginCode() {
        throw new SmsProviderError('Alibaba Cloud SMS is not configured.', true);
      },
    };
  }
  return new AliyunSmsProvider({ accessKeyId, accessKeySecret, signName, templateCode });
}
