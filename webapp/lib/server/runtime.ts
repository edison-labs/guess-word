import { env } from 'cloudflare:workers';
import { D1GameStore } from './game-store';
import { GameService } from './game-service';
import { getQuestionById, selectRandomQuestion } from './questions';
import { createSemanticScorer } from './scoring';

let runtimeService: Promise<GameService> | null = null;

export async function getRuntimeGameService(): Promise<GameService> {
  if (!runtimeService) {
    runtimeService = createRuntimeGameService().catch((error: unknown) => {
      // A transient D1/runtime failure must not poison this isolate forever.
      runtimeService = null;
      throw error;
    });
  }
  return runtimeService;
}

export function getRuntimeAdminToken(): string | undefined {
  return (env as unknown as { ADMIN_API_TOKEN?: string }).ADMIN_API_TOKEN;
}

async function createRuntimeGameService(): Promise<GameService> {
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
  return new GameService({
    store,
    scorer,
    scoringMode: env.SEMANTIC_PROVIDER === 'deterministic' ? 'test' : 'semantic',
    questionSelector: (category) =>
      fixedQuestion?.category === category ? fixedQuestion : selectRandomQuestion(category),
  });
}
