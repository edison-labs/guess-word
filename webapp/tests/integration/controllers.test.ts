import { beforeEach, describe, expect, it } from 'vitest';
import {
  abandonGameController,
  createGameController,
  resetRateLimitsForTests,
  restoreGameController,
  submitGuessController,
  requestHintController,
} from '../../lib/server/controllers';
import type { ApiErrorBody, CreateGameResponse, GameResponse } from '../../lib/contracts';
import { createTestHarness } from '../helpers';

beforeEach(() => resetRateLimitsForTests());

async function createViaApi() {
  const harness = createTestHarness();
  const response = await createGameController(
    new Request('http://localhost/api/games', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: '动物' }),
    }),
    harness.service,
  );
  return { harness, response, body: (await response.json()) as CreateGameResponse };
}

function authorized(url: string, token: string, init: RequestInit = {}) {
  return new Request(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...init.headers },
  });
}

describe('API controllers', () => {
  it('creates a game with a safe response and security headers', async () => {
    const { response, body } = await createViaApi();
    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    const serialized = JSON.stringify(body.game);
    expect(serialized).not.toContain('企鹅');
    expect(serialized).not.toContain('animal_penguin');
    expect(serialized).not.toContain('南极');
    expect(body.resumeToken.length).toBeGreaterThan(20);
    expect(body.game.category).toBe('动物');
    expect(body.game).not.toHaveProperty('answerLength');
  });

  it.each([
    ['missing category', {}],
    ['unknown category', { category: '体育' }],
    ['extra forged fields', { category: '动物', questionId: 'animal_penguin' }],
  ])('rejects create game with %s', async (_label, payload) => {
    const { service } = createTestHarness();
    const response = await createGameController(
      new Request('http://localhost/api/games', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
      service,
    );
    expect(response.status).toBe(400);
    expect(((await response.json()) as ApiErrorBody).error.code).toBe('INVALID_REQUEST');
  });

  it('restores and guesses through the HTTP contract', async () => {
    const { harness, body } = await createViaApi();
    const restore = await restoreGameController(
      authorized(`http://localhost/api/games/${body.game.gameId}`, body.resumeToken),
      harness.service,
      body.game.gameId,
    );
    expect(restore.status).toBe(200);
    const guess = await submitGuessController(
      authorized(`http://localhost/api/games/${body.game.gameId}/guesses`, body.resumeToken, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guess: '海豹' }),
      }),
      harness.service,
      body.game.gameId,
    );
    expect(guess.status).toBe(200);
    expect(((await guess.json()) as GameResponse).game.guesses[0]).toMatchObject({
      guess: '海豹',
      temperature: '非常接近',
      relationHint: expect.any(String),
    });
  });

  it.each([
    ['invalid characters', { guess: 'penguin' }, 'VALIDATION_ERROR'],
    ['extra forged fields', { guess: '海豹', score: 100, status: 'won' }, 'INVALID_REQUEST'],
  ])('rejects %s', async (_label, payload, expectedCode) => {
    const { harness, body } = await createViaApi();
    const response = await submitGuessController(
      authorized(`http://localhost/api/games/${body.game.gameId}/guesses`, body.resumeToken, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
      harness.service,
      body.game.gameId,
    );
    expect((await response.json() as ApiErrorBody).error.code).toBe(expectedCode);
  });

  it('rejects malformed JSON and cross-origin mutations safely', async () => {
    const { harness, body } = await createViaApi();
    const malformed = await submitGuessController(
      authorized(`http://localhost/api/games/${body.game.gameId}/guesses`, body.resumeToken, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{bad',
      }),
      harness.service,
      body.game.gameId,
    );
    expect(malformed.status).toBe(400);
    const crossOrigin = await submitGuessController(
      authorized(`http://localhost/api/games/${body.game.gameId}/guesses`, body.resumeToken, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://attacker.example' },
        body: JSON.stringify({ guess: '海豹' }),
      }),
      harness.service,
      body.game.gameId,
    );
    expect(crossOrigin.status).toBe(400);
  });

  it('accepts the browser origin when standalone Next.js sees an internal request URL', async () => {
    const { service } = createTestHarness();
    const response = await createGameController(
      new Request('http://127.0.0.1:3000/api/games', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Host: '47.119.123.28',
          Origin: 'http://47.119.123.28',
        },
        body: JSON.stringify({ category: '动物' }),
      }),
      service,
    );

    expect(response.status).toBe(201);
  });

  it('uses browser fetch metadata when the standalone server rewrites every external host', async () => {
    const { service } = createTestHarness();
    const response = await createGameController(
      new Request('http://127.0.0.1:3000/api/games', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Host: '127.0.0.1:3000',
          Origin: 'http://47.119.123.28',
          'Sec-Fetch-Site': 'same-origin',
        },
        body: JSON.stringify({ category: '动物' }),
      }),
      service,
    );
    expect(response.status).toBe(201);

    const crossSite = await createGameController(
      new Request('http://127.0.0.1:3000/api/games', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Host: '47.119.123.28',
          Origin: 'http://47.119.123.28',
          'Sec-Fetch-Site': 'cross-site',
        },
        body: JSON.stringify({ category: '动物' }),
      }),
      service,
    );
    expect(crossSite.status).toBe(400);
  });

  it('accepts a trusted proxy origin while still rejecting a mismatched origin', async () => {
    const { service } = createTestHarness();
    const proxied = await createGameController(
      new Request('http://127.0.0.1:3000/api/games', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Host: '127.0.0.1:3000',
          Origin: 'https://guess.example.com',
          'X-Forwarded-Host': 'guess.example.com',
          'X-Forwarded-Proto': 'https',
        },
        body: JSON.stringify({ category: '动物' }),
      }),
      service,
    );
    expect(proxied.status).toBe(201);

    const mismatched = await createGameController(
      new Request('http://127.0.0.1:3000/api/games', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Host: '47.119.123.28',
          Origin: 'https://attacker.example',
        },
        body: JSON.stringify({ category: '动物' }),
      }),
      service,
    );
    expect(mismatched.status).toBe(400);
  });

  it('returns each hint level and then a stable exhaustion error', async () => {
    const { harness, body } = await createViaApi();
    for (let level = 1; level <= 2; level += 1) {
      const response = await requestHintController(
        authorized(`http://localhost/api/games/${body.game.gameId}/hints`, body.resumeToken, { method: 'POST' }),
        harness.service,
        body.game.gameId,
      );
      const game = ((await response.json()) as GameResponse).game;
      expect(game.revealedHints).toHaveLength(level);
      expect(game.revealedHints.at(-1)?.level).toBe(level);
    }
    const third = await requestHintController(
      authorized(`http://localhost/api/games/${body.game.gameId}/hints`, body.resumeToken, { method: 'POST' }),
      harness.service,
      body.game.gameId,
    );
    expect(third.status).toBe(409);
    expect(((await third.json()) as ApiErrorBody).error.code).toBe('HINTS_EXHAUSTED');
  });

  it('reveals the answer only after abandon and blocks subsequent guessing', async () => {
    const { harness, body } = await createViaApi();
    const abandon = await abandonGameController(
      authorized(`http://localhost/api/games/${body.game.gameId}/abandon`, body.resumeToken, { method: 'POST' }),
      harness.service,
      body.game.gameId,
    );
    expect(((await abandon.clone().json()) as GameResponse).game.answer).toBe('企鹅');
    const guess = await submitGuessController(
      authorized(`http://localhost/api/games/${body.game.gameId}/guesses`, body.resumeToken, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guess: '海豹' }),
      }),
      harness.service,
      body.game.gameId,
    );
    expect(guess.status).toBe(409);
  });

  it('rate limits a burst without corrupting the game', async () => {
    const { harness, body } = await createViaApi();
    const guesses = ['一一', '二二', '三三', '四四', '五五', '六六', '七七', '八八', '九九', '十十', '甲甲', '乙乙', '丙丙', '丁丁', '戊戊', '己己'];
    let finalResponse: Response | undefined;
    for (const guess of guesses) {
      finalResponse = await submitGuessController(
        authorized(`http://localhost/api/games/${body.game.gameId}/guesses`, body.resumeToken, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guess }),
        }),
        harness.service,
        body.game.gameId,
      );
    }
    expect(finalResponse?.status).toBe(429);
    const restored = await harness.service.restoreGame(body.game.gameId, body.resumeToken);
    expect(restored.guessCount).toBe(15);
  });
});
