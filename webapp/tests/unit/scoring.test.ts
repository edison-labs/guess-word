import { afterEach, describe, expect, it, vi } from 'vitest';
import { getQuestionById } from '../../lib/server/questions';
import {
  createSemanticScorer,
  CloudflareAiSemanticScorer,
  DeepSeekJudgeSemanticScorer,
  DeterministicSemanticScorer,
  SemanticScorerError,
} from '../../lib/server/scoring';

afterEach(() => vi.unstubAllGlobals());

describe('deterministic scoring adapter', () => {
  it('is stable and provides a known low-to-high semantic path', async () => {
    const question = getQuestionById('animal_penguin')!;
    const scorer = new DeterministicSemanticScorer();
    const low = await scorer.scoreNonExact('银行', question);
    const medium = await scorer.scoreNonExact('动物', question);
    const high = await scorer.scoreNonExact('鸟类', question);
    const near = await scorer.scoreNonExact('南极', question);
    expect(low).toBeLessThan(medium);
    expect(medium).toBeLessThan(high);
    expect(high).toBeLessThan(near);
    expect(await scorer.scoreNonExact('南极', question)).toBe(near);
    expect(near).toBeLessThanOrEqual(99_900);
  });

  it('gives unknown Chinese words stable but non-uniform cold scores', async () => {
    const question = getQuestionById('animal_penguin')!;
    const scorer = new DeterministicSemanticScorer();
    const words = ['桌子', '电脑', '手机', '月亮', '衣服', '森林'];
    const scores = await Promise.all(words.map((word) => scorer.scoreNonExact(word, question)));

    expect(new Set(scores).size).toBeGreaterThanOrEqual(4);
    expect(scores.every((score) => score < 20_000)).toBe(true);
    expect(await scorer.scoreNonExact('电脑', question)).toBe(scores[1]);
    expect(await scorer.scoreNonExact('寒冷', question)).toBeGreaterThan(Math.max(...scores));
    expect(await scorer.scoreNonExact('鸟', question)).toBeGreaterThan(Math.max(...scores));
  });

  it('requires an explicit non-production environment', () => {
    expect(() => createSemanticScorer({ APP_ENV: 'development', SEMANTIC_PROVIDER: 'deterministic' })).not.toThrow();
    expect(() => createSemanticScorer({ APP_ENV: 'production', SEMANTIC_PROVIDER: 'deterministic' })).toThrow('forbidden');
    expect(() => createSemanticScorer({ APP_ENV: 'production' })).toThrow('SEMANTIC_PROVIDER');
  });

  it('requires real-provider credentials', () => {
    expect(() => createSemanticScorer({ APP_ENV: 'production', SEMANTIC_PROVIDER: 'cloudflare-ai' })).toThrow('credentials');
    expect(() => createSemanticScorer({ APP_ENV: 'production', SEMANTIC_PROVIDER: 'deepseek-judge' })).toThrow('API key');
    expect(() => createSemanticScorer({
      APP_ENV: 'production',
      SEMANTIC_PROVIDER: 'deepseek-judge',
      DEEPSEEK_API_KEY: 'server-secret',
    })).not.toThrow();
  });

  it('calls the configured Cloudflare endpoint and caches embeddings and results', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body)) as { text: string[] };
      const vectors = payload.text.map((text) => (text === '海豹' ? [0.8, 0.2] : [1, 0]));
      return Response.json({ success: true, result: { data: vectors } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const scorer = new CloudflareAiSemanticScorer({
      accountId: 'account/id',
      apiToken: 'server-secret',
      model: '@cf/baai/bge-m3',
    });
    const question = getQuestionById('animal_penguin')!;

    const first = await scorer.scoreNonExact('海豹', question);
    const second = await scorer.scoreNonExact('海豹', question);

    expect(first).toBe(second);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('/accounts/account%2Fid/ai/run/@cf/baai/bge-m3');
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
      Authorization: 'Bearer server-secret',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      text: ['海豹', '企鹅'],
    });

    await scorer.scoreNonExact('动物', question);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({ text: ['动物'] });
  });

  it('classifies provider authentication separately from retryable failures', async () => {
    const question = getQuestionById('animal_penguin')!;
    vi.stubGlobal('fetch', vi.fn(async () => new Response('limited', { status: 429 })));
    const limited = new CloudflareAiSemanticScorer({
      accountId: 'account',
      apiToken: 'secret',
      model: 'model',
    });
    await expect(limited.scoreNonExact('海豹', question)).rejects.toMatchObject({
      kind: 'unavailable',
      retryable: true,
    });

    vi.stubGlobal('fetch', vi.fn(async () => new Response('denied', { status: 401 })));
    const denied = new CloudflareAiSemanticScorer({
      accountId: 'account',
      apiToken: 'bad-secret',
      model: 'model',
    });
    await expect(denied.scoreNonExact('海豹', question)).rejects.toMatchObject({
      kind: 'configuration',
      retryable: false,
    });
  });

  it('rejects invalid provider payloads without exposing their contents', async () => {
    const question = getQuestionById('animal_penguin')!;

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ success: true, result: { data: [[], []] } })),
    );
    const invalid = new CloudflareAiSemanticScorer({
      accountId: 'account',
      apiToken: 'secret',
      model: 'model',
    });
    await expect(invalid.scoreNonExact('海豹', question)).rejects.toBeInstanceOf(
      SemanticScorerError,
    );

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ success: false, errors: [{ message: 'private' }] })),
    );
    const unsuccessful = new CloudflareAiSemanticScorer({
      accountId: 'account',
      apiToken: 'secret',
      model: 'model',
    });
    await expect(unsuccessful.scoreNonExact('海豹', question)).rejects.toThrow(
      'unsuccessful result',
    );
  });

  it('aborts slow provider requests as retryable failures', async () => {
    const question = getQuestionById('animal_penguin')!;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (_input: string | URL | Request, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(new DOMException('aborted', 'AbortError'));
            });
          }),
      ),
    );
    const scorer = new CloudflareAiSemanticScorer({
      accountId: 'account',
      apiToken: 'secret',
      model: 'model',
      timeoutMs: 5,
    });

    await expect(scorer.scoreNonExact('海豹', question)).rejects.toMatchObject({
      kind: 'unavailable',
      retryable: true,
      message: 'Embedding provider timed out.',
    });
  });

  it('calls DeepSeek as a non-thinking JSON judge and caches the precise score', async () => {
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        void input;
        void init;
        return Response.json({
          choices: [{
            message: {
              content: JSON.stringify({
                relationship: 75.123,
                similarity: 80.456,
                direction: 65.789,
                hint: '同为寒冷地区动物，但生物类别不同',
              }),
            },
          }],
        });
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    const scorer = new DeepSeekJudgeSemanticScorer({
      apiKey: 'deepseek-server-secret',
      model: 'deepseek-v4-flash',
    });
    expect(scorer.cacheNamespace).toBe('deepseek:deepseek-v4-flash:v6');
    const question = getQuestionById('animal_penguin')!;

    expect(await scorer.scoreNonExact('海豹', question)).toEqual({
      scoreMilliPercent: 75_123,
      relationHint: '同为寒冷地区动物，但生物类别不同',
    });
    expect(await scorer.scoreNonExact('海豹', question)).toEqual({
      scoreMilliPercent: 75_123,
      relationHint: '同为寒冷地区动物，但生物类别不同',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.deepseek.com/chat/completions');
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
      Authorization: 'Bearer deepseek-server-secret',
      'Content-Type': 'application/json',
    });
    const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
      model: string;
      messages: Array<{ role: string; content: string }>;
      response_format: { type: string };
      thinking: { type: string };
      temperature: number;
    };
    expect(request).toMatchObject({
      model: 'deepseek-v4-flash',
      response_format: { type: 'json_object' },
      thinking: { type: 'disabled' },
      temperature: 0,
    });
    expect(request.messages[0].content).toContain('同一具体身份或子类 35～60');
    expect(request.messages[0].content).toContain('同为中国古代皇帝');
    expect(JSON.parse(request.messages[1].content)).toEqual({
      target: '企鹅',
      targetCategory: '动物',
      targetDescription: '生活在寒冷地区的鸟类',
      guess: '海豹',
    });
  });

  it('classifies DeepSeek auth and temporary failures without exposing responses', async () => {
    const question = getQuestionById('animal_penguin')!;
    vi.stubGlobal('fetch', vi.fn(async () => new Response('denied private detail', { status: 401 })));
    const denied = new DeepSeekJudgeSemanticScorer({
      apiKey: 'bad-secret',
      model: 'deepseek-v4-flash',
    });
    await expect(denied.scoreNonExact('海豹', question)).rejects.toMatchObject({
      kind: 'configuration',
      retryable: false,
    });

    vi.stubGlobal('fetch', vi.fn(async () => new Response('limited private detail', { status: 429 })));
    const limited = new DeepSeekJudgeSemanticScorer({
      apiKey: 'secret',
      model: 'deepseek-v4-flash',
    });
    await expect(limited.scoreNonExact('海豹', question)).rejects.toMatchObject({
      kind: 'unavailable',
      retryable: true,
    });
  });

  it('replaces a relation hint that leaks the target word', async () => {
    const question = getQuestionById('animal_penguin')!;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({
        choices: [{
          message: {
            content: JSON.stringify({
              relationship: 35.127,
              similarity: 42.318,
              direction: 38.941,
              hint: '目标是企鹅，与海豹都生活在寒冷地区',
            }),
          },
        }],
      })),
    );
    const scorer = new DeepSeekJudgeSemanticScorer({
      apiKey: 'secret',
      model: 'deepseek-v4-flash',
    });

    const result = await scorer.scoreNonExact('海豹', question);
    expect(result.relationHint).not.toContain('企鹅');
    expect(result.relationHint.length).toBeGreaterThan(0);
  });

  it('rejects invalid DeepSeek scores', async () => {
    const question = getQuestionById('animal_penguin')!;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          choices: [{
            message: {
              content: JSON.stringify({ relationship: 101, similarity: 80, direction: 65 }),
            },
          }],
        }),
      ),
    );
    const scorer = new DeepSeekJudgeSemanticScorer({
      apiKey: 'secret',
      model: 'deepseek-v4-flash',
    });

    await expect(scorer.scoreNonExact('海豹', question)).rejects.toMatchObject({
      kind: 'unavailable',
      retryable: true,
      message: 'DeepSeek returned an invalid score.',
    });
  });
});
