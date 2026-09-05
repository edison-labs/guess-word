import { describe, expect, it } from 'vitest';
import { AccountService } from '../../lib/server/account-service';
import { GameService } from '../../lib/server/game-service';
import { MemoryGameStore } from '../../lib/server/game-store';
import { getQuestionById, selectDailyQuestion } from '../../lib/server/questions';
import { DeterministicSemanticScorer } from '../../lib/server/scoring';
import { FixedSmsProvider } from '../../lib/server/sms';

const SECRET = 'test-account-secret-with-at-least-32-characters';

function cookieRequest(url: string, cookie?: string): Request {
  return new Request(url, { headers: cookie ? { Cookie: cookie } : {} });
}

function cookieHeader(setCookie?: string): string {
  if (!setCookie) throw new Error('Expected a session cookie.');
  return setCookie.split(';', 1)[0];
}

function createHarness() {
  const store = new MemoryGameStore();
  const sms = new FixedSmsProvider();
  let now = Date.UTC(2026, 8, 5, 4, 0, 0);
  const accounts = new AccountService({
    store,
    sms,
    secret: SECRET,
    now: () => now,
    codeGenerator: () => '123456',
  });
  const games = new GameService({
    store,
    scorer: new DeterministicSemanticScorer(),
    now: () => now,
    questionSelector: () => getQuestionById('animal_penguin')!,
  });
  return {
    store,
    sms,
    accounts,
    games,
    advance(milliseconds: number) { now += milliseconds; },
  };
}

async function login(accounts: AccountService, phone: string) {
  const guest = await accounts.ensureViewer(cookieRequest('http://localhost/api/auth/session'));
  const guestCookie = cookieHeader(guest.setCookie);
  await accounts.requestLoginCode(phone);
  const authenticated = await accounts.verifyLoginCode(
    cookieRequest('http://localhost/api/auth/sms/verify', guestCookie),
    phone,
    '123456',
  );
  return { context: authenticated, cookie: cookieHeader(authenticated.setCookie) };
}

describe('account service', () => {
  it('uses an HttpOnly guest session, verifies one-time codes, and rotates login state', async () => {
    const { accounts, sms } = createHarness();
    const guest = await accounts.ensureViewer(cookieRequest('http://localhost/api/auth/session'));
    expect(guest.setCookie).toContain('HttpOnly');
    expect(guest.setCookie).toContain('SameSite=Lax');
    expect(accounts.toViewerResponse(guest)).toEqual({ authenticated: false, user: null });

    await accounts.requestLoginCode('+86 138-0013-8000');
    expect(sms.sent).toEqual([{ phone: '13800138000', code: '123456' }]);
    const authenticated = await accounts.verifyLoginCode(
      cookieRequest('http://localhost/api/auth/sms/verify', cookieHeader(guest.setCookie)),
      '13800138000',
      '123456',
    );
    expect(accounts.toViewerResponse(authenticated)).toMatchObject({
      authenticated: true,
      user: { nickname: '玩家8000', maskedPhone: '****8000' },
    });
    expect(authenticated.setCookie).not.toBe(guest.setCookie);

    await expect(
      accounts.verifyLoginCode(
        cookieRequest('http://localhost/api/auth/sms/verify', cookieHeader(authenticated.setCookie)),
        '13800138000',
        '123456',
      ),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('merges guest games into the account dashboard after login', async () => {
    const { accounts, games } = createHarness();
    const guest = await accounts.ensureViewer(cookieRequest('http://localhost/api/auth/session'));
    const created = await games.createGame('动物', [], guest.session.playerId);
    await games.submitGuess(created.game.gameId, created.resumeToken, '企鹅');

    await accounts.requestLoginCode('13900139000');
    const authenticated = await accounts.verifyLoginCode(
      cookieRequest('http://localhost/api/auth/sms/verify', cookieHeader(guest.setCookie)),
      '13900139000',
      '123456',
    );
    const dashboard = await accounts.getDashboard(
      cookieRequest('http://localhost/api/account', cookieHeader(authenticated.setCookie)),
    );
    expect(dashboard.stats).toMatchObject({ completedGames: 1, wonGames: 1, bestGuessCount: 1 });
    expect(dashboard.recentGames[0]).toMatchObject({ answer: '企鹅', status: 'won' });
  });

  it('does not transfer one signed-in users history when switching accounts', async () => {
    const { accounts, games, store } = createHarness();
    const first = await login(accounts, '13500135000');
    const created = await games.createGame('动物', [], first.context.user!.id);
    await games.submitGuess(created.game.gameId, created.resumeToken, '企鹅');

    await accounts.requestLoginCode('13400134000');
    const second = await accounts.verifyLoginCode(
      cookieRequest('http://localhost/api/auth/sms/verify', first.cookie),
      '13400134000',
      '123456',
    );
    const secondDashboard = await accounts.getDashboard(
      cookieRequest('http://localhost/api/account', cookieHeader(second.setCookie)),
    );
    expect(secondDashboard.stats.completedGames).toBe(0);
    expect(await store.listOwnedGameResults(first.context.user!.id, 10)).toHaveLength(1);
  });

  it('ranks only each users first daily attempt by guesses, hints, and time', async () => {
    const { accounts, games, advance } = createHarness();
    const first = await login(accounts, '13700137000');
    const second = await login(accounts, '13600136000');
    const answer = selectDailyQuestion('2026-09-05').answer;

    const firstDaily = await games.createDailyGame(first.context.user!.id);
    await games.submitGuess(firstDaily.game.gameId, firstDaily.resumeToken, '海豹');
    advance(2_000);
    await games.submitGuess(firstDaily.game.gameId, firstDaily.resumeToken, answer);

    const secondDaily = await games.createDailyGame(second.context.user!.id);
    advance(1_000);
    await games.submitGuess(secondDaily.game.gameId, secondDaily.resumeToken, answer);

    const board = await accounts.getDailyLeaderboard(
      cookieRequest('http://localhost/api/leaderboards/daily', first.cookie),
      '2026-09-05',
    );
    expect(board.entries.map((entry) => [entry.nickname, entry.guessCount])).toEqual([
      ['玩家6000', 1],
      ['玩家7000', 2],
    ]);
    expect(board.entries[1].isCurrentUser).toBe(true);
    expect(board.participantCount).toBe(2);
    expect(board.currentUserEntry).toMatchObject({ rank: 2, nickname: '玩家7000' });
  });
});
