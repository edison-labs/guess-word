import { isAbsolute, resolve } from 'node:path';
import { GameService } from './game-service';
import { NodeSqliteGameStore } from './node-sqlite-game-store';
import { selectRandomQuestion } from './questions';
import { createSemanticScorer, type ScorerEnvironment } from './scoring';

let runtimeService: Promise<GameService> | null = null;

export async function getRuntimeGameService(): Promise<GameService> {
  if (!runtimeService) {
    runtimeService = createRuntimeGameService().catch((error: unknown) => {
      runtimeService = null;
      throw error;
    });
  }
  return runtimeService;
}

export function getRuntimeAdminToken(): string | undefined { return process.env.ADMIN_API_TOKEN; }

async function createRuntimeGameService(): Promise<GameService> {
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

  return new GameService({
    store,
    scorer,
    scoringMode: 'semantic',
    questionSelector: (category) => selectRandomQuestion(category),
  });
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
