export interface SmsProvider {
  sendLoginCode(phone: string, code: string): Promise<void>;
}

export class SmsProviderError extends Error {
  constructor(
    message: string,
    readonly configuration = false,
  ) {
    super(message);
  }
}

export class FixedSmsProvider implements SmsProvider {
  readonly sent: Array<{ phone: string; code: string }> = [];

  async sendLoginCode(phone: string, code: string): Promise<void> {
    this.sent.push({ phone, code });
  }
}
