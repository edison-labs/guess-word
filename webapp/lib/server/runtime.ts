import { env } from 'cloudflare:workers';
import { AccountService } from './account-service';
import { D1GameStore } from './game-store';
import { GameService } from './game-service';
import { getQuestionById, selectRandomQuestion } from './questions';
import { createSemanticScorer } from './scoring';
import { FixedSmsProvider, SmsProviderError } from './sms';

type RuntimeServices = { game: GameService; account: AccountService };
let runtimeServices: Promise<RuntimeServices> | null = null;

export async function getRuntimeGameService(): Promise<GameService> {
  return (await getRuntimeServices()).game;
}

export async function getRuntimeAccountService(): Promise<AccountService> {
  return (await getRuntimeServices()).account;
}

export async function getRuntimeServices(): Promise<RuntimeServices> {
  if (!runtimeServices) {
    runtimeServices = createRuntimeServices().catch((error: unknown) => {
      // A transient D1/runtime failure must not poison this isolate forever.
      runtimeServices = null;
      throw error;
    });
  }
  return runtimeServices;
}

export function getRuntimeAdminToken(): string | undefined {
  return (env as unknown as { ADMIN_API_TOKEN?: string }).ADMIN_API_TOKEN;
}

async function createRuntimeServices(): Promise<RuntimeServices> {
  if (!env.DB) throw new Error('CONFIGURATION_ERROR: D1 binding DB is unavailable.');
  const store = new D1GameStore(env.DB);
  await store.init();
  const scorer = createSemanticScorer(env, (record) => store.recordAiUsage(record));
  const fixedQuestion =
    env.APP_ENV !== 'production' && env.TEST_QUESTION_ID
      ? getQuestionById(env.TEST_QUESTION_ID)
      : undefined;
  if (env.TEST_QUESTION_ID && env.APP_ENV !== 'production' && !fixedQuestion) {
    throw new Error('CONFIGURATION_ERROR: TEST_QUESTION_ID is unknown.');
  }
  const game = new GameService({
    store,
    scorer,
    scoringMode: env.SEMANTIC_PROVIDER === 'deterministic' ? 'test' : 'semantic',
    questionSelector: (category, excludedQuestionIds) =>
      fixedQuestion?.category === category
        ? fixedQuestion
        : selectRandomQuestion(category, undefined, excludedQuestionIds),
  });
  const environment = env as unknown as Record<string, string | undefined>;
  const testSms = new FixedSmsProvider();
  const account = new AccountService({
    store,
    sms: environment.APP_ENV === 'production'
      ? { async sendLoginCode() { throw new SmsProviderError('SMS is not configured.', true); } }
      : testSms,
    secret: environment.AUTH_SECRET ?? (environment.APP_ENV === 'production' ? '' : 'test-auth-secret-at-least-32-characters'),
    ...(environment.APP_ENV === 'production' ? {} : { codeGenerator: () => environment.TEST_SMS_CODE ?? '123456' }),
  });
  return { game, account };
}
