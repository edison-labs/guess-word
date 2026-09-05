import { isAbsolute, resolve } from 'node:path';
import { AccountService } from './account-service';
import { createAliyunSmsProvider } from './aliyun-sms';
import { GameService } from './game-service';
import { NodeSqliteGameStore } from './node-sqlite-game-store';
import { selectRandomQuestion } from './questions';
import { createSemanticScorer, type ScorerEnvironment } from './scoring';

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
      runtimeServices = null;
      throw error;
    });
  }
  return runtimeServices;
}

export function getRuntimeAdminToken(): string | undefined { return process.env.ADMIN_API_TOKEN; }

async function createRuntimeServices(): Promise<RuntimeServices> {
  if (process.env.RUNTIME_PLATFORM !== 'aliyun') {
    throw new Error('CONFIGURATION_ERROR: Alibaba Cloud runtime is not enabled.');
  }
  if (process.env.APP_ENV !== 'production') {
    throw new Error('CONFIGURATION_ERROR: Alibaba Cloud runtime requires APP_ENV=production.');
  }

  const databaseSetting = process.env.DATABASE_PATH || '/data/guess-word.sqlite';
  const databasePath = isAbsolute(databaseSetting)
    ? databaseSetting
    : resolve(process.cwd(), databaseSetting);
  const store = new NodeSqliteGameStore(databasePath);
  await store.init();
  const scorer = createSemanticScorer(readScorerEnvironment(), (record) => store.recordAiUsage(record));

  if (process.env.TEST_QUESTION_ID) {
    throw new Error('CONFIGURATION_ERROR: TEST_QUESTION_ID is forbidden in production.');
  }

  const game = new GameService({
    store,
    scorer,
    scoringMode: 'semantic',
    questionSelector: (category, excludedQuestionIds) =>
      selectRandomQuestion(category, undefined, excludedQuestionIds),
  });
  const account = new AccountService({
    store,
    sms: createAliyunSmsProvider(process.env),
    secret: process.env.AUTH_SECRET ?? '',
  });
  return { game, account };
}

function readScorerEnvironment(): ScorerEnvironment {
  return {
    APP_ENV: process.env.APP_ENV,
    SEMANTIC_PROVIDER: process.env.SEMANTIC_PROVIDER,
    CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID,
    CLOUDFLARE_AI_API_TOKEN: process.env.CLOUDFLARE_AI_API_TOKEN,
    CLOUDFLARE_AI_MODEL: process.env.CLOUDFLARE_AI_MODEL,
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
    DEEPSEEK_MODEL: process.env.DEEPSEEK_MODEL,
  };
}
