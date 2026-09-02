import { calibrateSimilarity, capNonExactScore, cosineSimilarity } from '../game-rules';
import { deterministicVectorForText, type Question } from './questions';
import type { AiUsageRecord } from './game-store';

export interface SemanticScorer {
  readonly cacheNamespace?: string;
  scoreNonExact(normalizedGuess: string, question: Question): Promise<number>;
}

export class SemanticScorerError extends Error {
  constructor(
    message: string,
    readonly kind: 'configuration' | 'unavailable',
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'SemanticScorerError';
  }
}

export class DeterministicSemanticScorer implements SemanticScorer {
  readonly cacheNamespace = 'deterministic:v1';
  async scoreNonExact(normalizedGuess: string, question: Question): Promise<number> {
    const guessVector = deterministicVectorForText(normalizedGuess, question);
    return calibrateSimilarity(cosineSimilarity(guessVector, question.testVector));
  }
}

type CloudflareAiConfig = {
  accountId: string;
  apiToken: string;
  model: string;
  timeoutMs?: number;
};

export class CloudflareAiSemanticScorer implements SemanticScorer {
  readonly cacheNamespace: string;
  private readonly embeddingCache = new Map<string, readonly number[]>();
  private readonly resultCache = new Map<string, number>();

  constructor(private readonly config: CloudflareAiConfig) {
    this.cacheNamespace = `cloudflare:${config.model}:v1`;
  }

  async scoreNonExact(normalizedGuess: string, question: Question): Promise<number> {
    const resultKey = `${this.config.model}:v1:${question.id}:${normalizedGuess}`;
    const cached = this.resultCache.get(resultKey);
    if (cached !== undefined) return cached;

    const [guessVector, targetVector] = await this.embedMany([
      normalizedGuess,
      question.answer,
    ]);
    const score = capNonExactScore(
      calibrateSimilarity(cosineSimilarity(guessVector, targetVector)),
    );
    if (this.resultCache.size > 2_000) this.resultCache.clear();
    this.resultCache.set(resultKey, score);
    return score;
  }

  private async embedMany(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
    const uniqueTexts = [...new Set(texts)];
    const missingTexts = uniqueTexts.filter(
      (text) => !this.embeddingCache.has(`${this.config.model}:${text}`),
    );

    if (missingTexts.length > 0) {
      const vectors = await this.requestEmbeddings(missingTexts);
      if (this.embeddingCache.size + vectors.length > 2_000) this.embeddingCache.clear();
      missingTexts.forEach((text, index) => {
        this.embeddingCache.set(`${this.config.model}:${text}`, vectors[index]);
      });
    }

    return texts.map((text) => {
      const vector = this.embeddingCache.get(`${this.config.model}:${text}`);
      if (!vector) {
        throw new SemanticScorerError(
          'Embedding provider omitted a requested vector.',
          'unavailable',
          true,
        );
      }
      return vector;
    });
  }

  private async requestEmbeddings(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 8_000);
    try {
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(this.config.accountId)}/ai/run/${this.config.model}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.config.apiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ text: texts }),
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        const configurationFailure = [400, 401, 403, 404].includes(response.status);
        throw new SemanticScorerError(
          configurationFailure
            ? 'Embedding provider rejected its server-side configuration.'
            : 'Embedding provider is temporarily unavailable.',
          configurationFailure ? 'configuration' : 'unavailable',
          !configurationFailure,
        );
      }

      let body: {
        success?: boolean;
        result?: { data?: unknown };
      };
      try {
        body = (await response.json()) as typeof body;
      } catch {
        throw new SemanticScorerError(
          'Embedding provider returned invalid JSON.',
          'unavailable',
          true,
        );
      }

      if (body.success === false) {
        throw new SemanticScorerError(
          'Embedding provider reported an unsuccessful result.',
          'unavailable',
          true,
        );
      }
      const data = body.result?.data;
      if (!Array.isArray(data) || data.length !== texts.length) {
        throw new SemanticScorerError(
          'Embedding provider returned an unexpected vector count.',
          'unavailable',
          true,
        );
      }
      const vectors = data as unknown[];
      const dimensions = Array.isArray(vectors[0]) ? vectors[0].length : 0;
      if (
        dimensions === 0 ||
        vectors.some(
          (vector) =>
            !Array.isArray(vector) ||
            vector.length !== dimensions ||
            vector.some((value) => typeof value !== 'number' || !Number.isFinite(value)),
        )
      ) {
        throw new SemanticScorerError(
          'Embedding provider returned an invalid vector.',
          'unavailable',
          true,
        );
      }
      return vectors as number[][];
    } catch (error) {
      if (error instanceof SemanticScorerError) throw error;
      if (controller.signal.aborted) {
        throw new SemanticScorerError(
          'Embedding provider timed out.',
          'unavailable',
          true,
        );
      }
      throw new SemanticScorerError(
        'Embedding provider request failed.',
        'unavailable',
        true,
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

type DeepSeekJudgeConfig = {
  apiKey: string;
  model: string;
  timeoutMs?: number;
  onUsage?: (record: AiUsageRecord) => Promise<void>;
};

const DEEPSEEK_SCORING_PROMPT = `你是中文猜词游戏的关联度评审。比较“猜测词”与“目标词”，只输出 JSON：{"meaning":数字,"context":数字,"specificity":数字}。
三个数字都必须在 0 到 100，并各自保留三位小数，例如 37.284：meaning 衡量词义、类别和概念接近度，宽泛上位类应低于直接类别；context 衡量典型场景、属性、功能和固定搭配的关联；specificity 衡量猜测词能否从众多候选中独特地指向目标。
无明显关系应接近 0；不要仅因常识共现就把 meaning 判高；必须区分宽泛类别、直接类别和典型场景。使用完整区间，不要习惯性返回整十或以 .000 结尾。小数必须来自你的语义判断，不能使用随机数。不要输出总分、解释、Markdown 或其他字段。相同输入应给出相同分数。`;

export class DeepSeekJudgeSemanticScorer implements SemanticScorer {
  readonly cacheNamespace: string;
  private readonly resultCache = new Map<string, number>();

  constructor(private readonly config: DeepSeekJudgeConfig) {
    this.cacheNamespace = `deepseek:${config.model}:v4`;
  }

  async scoreNonExact(normalizedGuess: string, question: Question): Promise<number> {
    const resultKey = `${this.config.model}:v4:${question.id}:${normalizedGuess}`;
    const cached = this.resultCache.get(resultKey);
    if (cached !== undefined) return cached;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 12_000);
    const startedAt = Date.now();
    try {
      const response = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [
            { role: 'system', content: DEEPSEEK_SCORING_PROMPT },
            {
              role: 'user',
              content: JSON.stringify({ target: question.answer, guess: normalizedGuess }),
            },
          ],
          response_format: { type: 'json_object' },
          thinking: { type: 'disabled' },
          temperature: 0,
          max_tokens: 96,
          stream: false,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const configurationFailure = [400, 401, 403, 404].includes(response.status);
        throw new SemanticScorerError(
          configurationFailure
            ? 'DeepSeek rejected its server-side configuration.'
            : 'DeepSeek is temporarily unavailable.',
          configurationFailure ? 'configuration' : 'unavailable',
          !configurationFailure,
        );
      }

      let body: {
        choices?: Array<{ message?: { content?: unknown } }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          prompt_cache_hit_tokens?: number;
          prompt_cache_miss_tokens?: number;
        };
      };
      try {
        body = (await response.json()) as typeof body;
      } catch {
        throw new SemanticScorerError('DeepSeek returned invalid JSON.', 'unavailable', true);
      }

      const content = body.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || content.length > 256) {
        throw new SemanticScorerError(
          'DeepSeek returned an invalid scoring response.',
          'unavailable',
          true,
        );
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch {
        throw new SemanticScorerError(
          'DeepSeek returned an invalid scoring response.',
          'unavailable',
          true,
        );
      }
      const dimensions = parsed as {
        meaning?: unknown;
        context?: unknown;
        specificity?: unknown;
      } | null;
      const values = dimensions
        ? [dimensions.meaning, dimensions.context, dimensions.specificity]
        : [];
      if (values.length !== 3 || values.some(
        (value) =>
          typeof value !== 'number' ||
          !Number.isFinite(value) ||
          value < 0 ||
          value > 100,
      )) {
        throw new SemanticScorerError(
          'DeepSeek returned an invalid score.',
          'unavailable',
          true,
        );
      }

      const [meaning, context, specificity] = values as number[];
      // Fixed weights turn three independent AI judgments into a stable
      // integer representing thousandths of one percentage point.
      const score = capNonExactScore(
        Math.round((meaning * 0.35 + context * 0.4 + specificity * 0.25) * 1000),
      );
      const usage = body.usage;
      if (usage && this.config.onUsage) {
        const cached = safeTokenCount(usage.prompt_cache_hit_tokens);
        const prompt = safeTokenCount(usage.prompt_tokens);
        const miss = Math.max(0, safeTokenCount(usage.prompt_cache_miss_tokens) || prompt - cached);
        const completion = safeTokenCount(usage.completion_tokens);
        await this.config.onUsage({
          id: crypto.randomUUID(),
          providerKey: this.cacheNamespace,
          questionId: question.id,
          normalizedGuess,
          promptTokens: prompt,
          cachedPromptTokens: cached,
          completionTokens: completion,
          latencyMs: Math.max(0, Date.now() - startedAt),
          // DeepSeek V4 Flash: $0.14/M cache-miss input,
          // $0.0028/M cache-hit input and $0.28/M output.
          estimatedCostMicrousd: Math.round(miss * 0.14 + cached * 0.0028 + completion * 0.28),
          createdAt: Date.now(),
        }).catch(() => undefined);
      }
      if (this.resultCache.size > 2_000) this.resultCache.clear();
      this.resultCache.set(resultKey, score);
      return score;
    } catch (error) {
      if (error instanceof SemanticScorerError) throw error;
      if (controller.signal.aborted) {
        throw new SemanticScorerError('DeepSeek timed out.', 'unavailable', true);
      }
      throw new SemanticScorerError('DeepSeek request failed.', 'unavailable', true);
    } finally {
      clearTimeout(timeout);
    }
  }
}

export type ScorerEnvironment = {
  APP_ENV?: string;
  SEMANTIC_PROVIDER?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_AI_API_TOKEN?: string;
  CLOUDFLARE_AI_MODEL?: string;
  DEEPSEEK_API_KEY?: string;
  DEEPSEEK_MODEL?: string;
};

export function createSemanticScorer(
  config: ScorerEnvironment,
  onUsage?: (record: AiUsageRecord) => Promise<void>,
): SemanticScorer {
  if (config.SEMANTIC_PROVIDER === 'deterministic') {
    if (config.APP_ENV === 'production') {
      throw new Error('CONFIGURATION_ERROR: deterministic scoring is forbidden in production.');
    }
    if (config.APP_ENV !== 'development' && config.APP_ENV !== 'test') {
      throw new Error('CONFIGURATION_ERROR: deterministic scoring requires APP_ENV=development or test.');
    }
    return new DeterministicSemanticScorer();
  }

  if (config.SEMANTIC_PROVIDER === 'cloudflare-ai') {
    if (!config.CLOUDFLARE_ACCOUNT_ID || !config.CLOUDFLARE_AI_API_TOKEN) {
      throw new Error('CONFIGURATION_ERROR: Cloudflare AI credentials are missing.');
    }
    return new CloudflareAiSemanticScorer({
      accountId: config.CLOUDFLARE_ACCOUNT_ID,
      apiToken: config.CLOUDFLARE_AI_API_TOKEN,
      model: config.CLOUDFLARE_AI_MODEL || '@cf/baai/bge-m3',
    });
  }

  if (config.SEMANTIC_PROVIDER === 'deepseek-judge') {
    if (!config.DEEPSEEK_API_KEY) {
      throw new Error('CONFIGURATION_ERROR: DeepSeek API key is missing.');
    }
    return new DeepSeekJudgeSemanticScorer({
      apiKey: config.DEEPSEEK_API_KEY,
      model: config.DEEPSEEK_MODEL || 'deepseek-v4-flash',
      onUsage,
    });
  }

  throw new Error('CONFIGURATION_ERROR: SEMANTIC_PROVIDER must be configured explicitly.');
}

function safeTokenCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}
