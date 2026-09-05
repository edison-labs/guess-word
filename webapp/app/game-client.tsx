'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ANSWER_LENGTH_UNLOCK_GUESSES,
  GAME_CATEGORIES,
  MAX_HINT_COUNT,
  type AccountDashboardResponse,
  type LeaderboardResponse,
  type ViewerResponse,
  type GameCategory,
  ApiErrorBody,
  CreateGameResponse,
  GameResponse,
  PublicGame,
  PublicGuess,
  StoredSession,
} from '@/lib/contracts';
import { validateGuess } from '@/lib/game-rules';
import {
  EMPTY_STATS,
  parseLocalStats,
  recordCompletedGame,
  type LocalStats,
} from '@/lib/stats';

const SESSION_KEY = 'guessword.session.v1';
const STATS_KEY = 'guessword.stats.v1';
const CATEGORY_DESCRIPTIONS: Record<GameCategory, string> = {
  动物: '飞禽走兽与水生动物',
  食物: '主食、甜品与饮品',
  职业: '常见岗位与专业角色',
  自然现象: '天气、地貌与天文现象',
  抽象概念: '情感、品质与思想',
  日常物品: '家居、工具与数码用品',
  历史人物: '古代人物与近代先贤',
  体育圈: '运动员、教练与体坛名将',
};

type PendingStart =
  | { kind: 'daily' }
  | { kind: 'category'; category: GameCategory }
  | { kind: 'challenge'; sourceGameId: string };

class ApiClientError extends Error {
  constructor(readonly body: ApiErrorBody, readonly status: number) {
    super(body.error.message);
  }
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    cache: 'no-store',
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  const body = (await response.json()) as T | ApiErrorBody;
  if (!response.ok) throw new ApiClientError(body as ApiErrorBody, response.status);
  return body as T;
}

function authHeaders(session: StoredSession): HeadersInit {
  return { Authorization: `Bearer ${session.resumeToken}` };
}

function readSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<StoredSession>;
    return typeof value.gameId === 'string' && typeof value.resumeToken === 'string'
      ? { gameId: value.gameId, resumeToken: value.resumeToken }
      : null;
  } catch {
    return null;
  }
}

function getFriendlyError(error: unknown): string {
  if (error instanceof ApiClientError) return error.message;
  return navigator.onLine
    ? '连接服务失败了，请稍后重试。你的输入仍然保留着。'
    : '当前网络不可用，恢复连接后可以继续。你的输入仍然保留着。';
}

export default function GameClient() {
  const [game, setGame] = useState<PublicGame | null>(null);
  const [session, setSession] = useState<StoredSession | null>(null);
  const [input, setInput] = useState('');
  const [sortMode, setSortMode] = useState<'score' | 'time'>('score');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'guess' | 'hint' | 'abandon' | 'new' | null>(null);
  const [message, setMessage] = useState('');
  const [slow, setSlow] = useState(false);
  const [latestSequence, setLatestSequence] = useState<number | null>(null);
  const [confirmAbandon, setConfirmAbandon] = useState(false);
  const [stats, setStats] = useState<LocalStats>(EMPTY_STATS);
  const [feedbackSent, setFeedbackSent] = useState<Set<number>>(new Set());
  const [showHome, setShowHome] = useState(false);
  const [pendingStart, setPendingStart] = useState<PendingStart | null>(null);
  const [shareMessage, setShareMessage] = useState('');
  const [shareFallback, setShareFallback] = useState('');
  const [challengeSourceGameId, setChallengeSourceGameId] = useState<string | null>(null);
  const [viewer, setViewer] = useState<ViewerResponse>({ authenticated: false, user: null });
  const [showAccount, setShowAccount] = useState(false);
  const booted = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelAbandonRef = useRef<HTMLButtonElement>(null);
  const confirmAbandonRef = useRef<HTMLButtonElement>(null);
  const abandonButtonRef = useRef<HTMLButtonElement>(null);
  const todayDate = getChinaDate(new Date());
  const currentTodayDaily =
    game?.mode === 'daily' && game.dailyDate === todayDate && game.status !== 'active'
      ? game
      : null;
  const storedTodayDaily =
    stats.lastDailyGame?.dailyDate === todayDate
      ? stats.lastDailyGame
      : stats.recentGames.find((item) => item.mode === 'daily' && item.dailyDate === todayDate);
  const todayDailyResult = currentTodayDaily ?? storedTodayDaily ?? null;
  const activeTodayDaily =
    game?.mode === 'daily' && game.dailyDate === todayDate && game.status === 'active';

  const closeAbandonDialog = useCallback(() => {
    setConfirmAbandon(false);
    requestAnimationFrame(() => abandonButtonRef.current?.focus());
  }, []);

  const acceptGame = useCallback((nextGame: PublicGame) => {
    setGame(nextGame);
    if (nextGame.status === 'active') return;
    setStats((current) => {
      const next = recordCompletedGame(current, nextGame);
      try {
        localStorage.setItem(STATS_KEY, JSON.stringify(next));
      } catch {
        // Local statistics are non-authoritative; the game remains playable.
      }
      return next;
    });
  }, []);

  const createNewGame = useCallback(async (
    category: GameCategory,
    additionalExcludeGameIds: readonly string[] = [],
  ) => {
    setBusy('new');
    setMessage('');
    try {
      const excludeGameIds = [
        ...new Set([
          ...additionalExcludeGameIds,
          ...stats.recentGames
            .filter((item) => item.category === category)
            .map((item) => item.gameId),
        ]),
      ].slice(0, 12);
      const created = await apiRequest<CreateGameResponse>('/api/games', {
        method: 'POST',
        body: JSON.stringify({ category, excludeGameIds }),
      });
      const nextSession = {
        gameId: created.game.gameId,
        resumeToken: created.resumeToken,
      };
      localStorage.setItem(SESSION_KEY, JSON.stringify(nextSession));
      setSession(nextSession);
      acceptGame(created.game);
      setInput('');
      setSortMode('score');
      setLatestSequence(null);
      setFeedbackSent(new Set());
      setShowHome(false);
      setShareMessage('');
      setShareFallback('');
      requestAnimationFrame(() => inputRef.current?.focus());
    } catch (error) {
      setMessage(getFriendlyError(error));
    } finally {
      setLoading(false);
      setBusy(null);
    }
  }, [acceptGame, stats.recentGames]);

  const createDailyGame = useCallback(async () => {
    setBusy('new');
    setMessage('');
    try {
      const created = await apiRequest<CreateGameResponse>('/api/games/daily', { method: 'POST', body: '{}' });
      const nextSession = { gameId: created.game.gameId, resumeToken: created.resumeToken };
      localStorage.setItem(SESSION_KEY, JSON.stringify(nextSession));
      setSession(nextSession);
      acceptGame(created.game);
      setInput('');
      setLatestSequence(null);
      setFeedbackSent(new Set());
      setShowHome(false);
      setShareMessage('');
      setShareFallback('');
    } catch (error) {
      setMessage(getFriendlyError(error));
    } finally {
      setLoading(false);
      setBusy(null);
    }
  }, [acceptGame]);

  const createChallengeGame = useCallback(async (sourceGameId: string) => {
    setBusy('new');
    setMessage('');
    try {
      const created = await apiRequest<CreateGameResponse>('/api/games/challenge', {
        method: 'POST',
        body: JSON.stringify({ sourceGameId }),
      });
      const nextSession = { gameId: created.game.gameId, resumeToken: created.resumeToken };
      localStorage.setItem(SESSION_KEY, JSON.stringify(nextSession));
      setSession(nextSession);
      acceptGame(created.game);
      setInput('');
      setSortMode('score');
      setLatestSequence(null);
      setFeedbackSent(new Set());
      setShowHome(false);
      setChallengeSourceGameId(null);
      removeChallengeFromUrl();
      setShareMessage('');
      setShareFallback('');
      requestAnimationFrame(() => inputRef.current?.focus());
    } catch (error) {
      setMessage(getFriendlyError(error));
    } finally {
      setLoading(false);
      setBusy(null);
    }
  }, [acceptGame]);

  const bootGame = useCallback(async (sourceGameId: string | null = null) => {
    setLoading(true);
    setMessage('');
    if (sourceGameId) {
      setChallengeSourceGameId(sourceGameId);
      setShowHome(true);
    }
    try {
      setViewer(await apiRequest<ViewerResponse>('/api/auth/session'));
    } catch (error) {
      setMessage(getFriendlyError(error));
    }
    const stored = readSession();
    if (stored) {
      try {
        const restored = await apiRequest<GameResponse>(`/api/games/${stored.gameId}`, {
          headers: authHeaders(stored),
        });
        setSession(stored);
        acceptGame(restored.game);
        setLoading(false);
        if (restored.game.status === 'active') requestAnimationFrame(() => inputRef.current?.focus());
        return;
      } catch (error) {
        if (!(error instanceof ApiClientError) || error.body.error.code !== 'GAME_NOT_FOUND') {
          setMessage(getFriendlyError(error));
          setLoading(false);
          return;
        }
        localStorage.removeItem(SESSION_KEY);
      }
    }
    setSession(null);
    setGame(null);
    setLoading(false);
  }, [acceptGame]);

  const chooseAnotherCategory = useCallback(() => {
    setInput('');
    setMessage('');
    setLatestSequence(null);
    setSortMode('score');
    setFeedbackSent(new Set());
    setShowHome(true);
    setShareMessage('');
    setShareFallback('');
  }, []);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    setStats(parseLocalStats(localStorage.getItem(STATS_KEY)));
    void bootGame(readChallengeGameId());
  }, [bootGame]);

  useEffect(() => {
    if (loading || showHome || busy || game?.status !== 'active') return;
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [busy, game?.gameId, game?.status, loading, showHome]);

  useEffect(() => {
    if (!confirmAbandon) return;
    cancelAbandonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeAbandonDialog();
        return;
      }
      if (event.key !== 'Tab') return;
      if (event.shiftKey && document.activeElement === cancelAbandonRef.current) {
        event.preventDefault();
        confirmAbandonRef.current?.focus();
      } else if (!event.shiftKey && document.activeElement === confirmAbandonRef.current) {
        event.preventDefault();
        cancelAbandonRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeAbandonDialog, confirmAbandon]);

  const orderedGuesses = useMemo(() => {
    if (!game) return [];
    return [...game.guesses].sort((left, right) =>
      sortMode === 'score'
        ? right.score - left.score || left.sequence - right.sequence
        : left.sequence - right.sequence,
    );
  }, [game, sortMode]);

  async function submitGuess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || !game || game.status !== 'active' || busy) return;
    const validated = validateGuess(input);
    if (!validated.ok) {
      setMessage(validated.message);
      inputRef.current?.focus();
      return;
    }
    if (game.guesses.some((item) => item.guess === validated.value)) {
      setMessage('这个词已经猜过了。');
      inputRef.current?.focus();
      return;
    }

    setBusy('guess');
    setMessage('正在分析词语关系…');
    setSlow(false);
    const slowTimer = window.setTimeout(() => setSlow(true), 3_000);
    try {
      const result = await apiRequest<GameResponse>(`/api/games/${game.gameId}/guesses`, {
        method: 'POST',
        headers: authHeaders(session),
        body: JSON.stringify({ guess: validated.value }),
      });
      const newest = result.game.guesses.at(-1);
      acceptGame(result.game);
      setLatestSequence(newest?.sequence ?? null);
      setInput('');
      setMessage(
        newest
          ? `${newest.guess}：${formatScore(newest.score)}%，${newest.relationHint}`
          : '关系分已更新。',
      );
      requestAnimationFrame(() => inputRef.current?.focus());
    } catch (error) {
      setMessage(getFriendlyError(error));
      requestAnimationFrame(() => inputRef.current?.focus());
    } finally {
      window.clearTimeout(slowTimer);
      setSlow(false);
      setBusy(null);
    }
  }

  async function requestHint() {
    if (!session || !game || game.status !== 'active' || game.hintCount >= MAX_HINT_COUNT || busy) return;
    setBusy('hint');
    setMessage('');
    try {
      const result = await apiRequest<GameResponse>(`/api/games/${game.gameId}/hints`, {
        method: 'POST',
        headers: authHeaders(session),
      });
      acceptGame(result.game);
      setMessage(`第 ${result.game.hintCount} 条提示已揭示。`);
    } catch (error) {
      setMessage(getFriendlyError(error));
    } finally {
      setBusy(null);
    }
  }

  async function abandonGame() {
    if (!session || !game || game.status !== 'active' || busy) return;
    setConfirmAbandon(false);
    setBusy('abandon');
    setMessage('');
    try {
      const result = await apiRequest<GameResponse>(`/api/games/${game.gameId}/abandon`, {
        method: 'POST',
        headers: authHeaders(session),
      });
      acceptGame(result.game);
      setMessage('答案已揭晓，本局结果已生成。');
    } catch (error) {
      setMessage(getFriendlyError(error));
    } finally {
      setBusy(null);
    }
  }

  function goHome() {
    setShowHome(true);
    setMessage('');
  }

  function dismissChallenge() {
    setChallengeSourceGameId(null);
    removeChallengeFromUrl();
    setMessage('');
  }

  function requestStart(target: PendingStart) {
    if (target.kind === 'daily' && todayDailyResult) {
      setMessage('今天的每日挑战已经完成，战绩已保存在上方。明天再来！');
      return;
    }
    if (target.kind === 'daily' && activeTodayDaily) {
      setShowHome(false);
      return;
    }
    if (game?.status === 'active' && session) {
      setPendingStart(target);
      return;
    }
    if (target.kind === 'daily') void createDailyGame();
    else if (target.kind === 'challenge') void createChallengeGame(target.sourceGameId);
    else void createNewGame(target.category);
  }

  async function confirmStartNewGame() {
    if (!pendingStart || !session || !game || game.status !== 'active') return;
    const target = pendingStart;
    setPendingStart(null);
    setBusy('new');
    setMessage('');
    try {
      const result = await apiRequest<GameResponse>(`/api/games/${game.gameId}/abandon`, {
        method: 'POST',
        headers: authHeaders(session),
      });
      acceptGame(result.game);
      localStorage.removeItem(SESSION_KEY);
      if (target.kind === 'daily') await createDailyGame();
      else if (target.kind === 'challenge') await createChallengeGame(target.sourceGameId);
      else await createNewGame(target.category, [game.gameId]);
    } catch (error) {
      setMessage(getFriendlyError(error));
      setBusy(null);
    }
  }

  async function submitFeedback(guess: PublicGuess, direction: 'too_high' | 'too_low') {
    if (!session || !game) return;
    try {
      await apiRequest<{ accepted: true }>(`/api/games/${game.gameId}/feedback`, {
        method: 'POST', headers: authHeaders(session), body: JSON.stringify({ guess: guess.guess, direction }),
      });
      setFeedbackSent((current) => new Set(current).add(guess.sequence));
      setMessage('感谢反馈，会用于后续校准关系分。');
    } catch (error) { setMessage(getFriendlyError(error)); }
  }

  async function shareResult() {
    if (!game || game.status === 'active') return;
    const bars = game.guesses.slice(-8).map((item) => scoreBlock(item.score)).join('');
    const challengeUrl = new URL(location.origin + location.pathname);
    challengeUrl.searchParams.set('challenge', game.gameId);
    const shareText = [
      `我完成了一道 GuessWord ${game.mode === 'daily' ? `每日挑战` : game.category}题`,
      `${game.status === 'won' ? `第 ${game.guessCount} 次猜中` : `挑战结束 · ${game.guessCount} 次猜测`} · 提示 ${game.hintCount}/${MAX_HINT_COUNT}`,
      bars || '还没有猜测',
    ].join('\n');
    const clipboardText = `${shareText}\n你也来挑战同一道题（答案不会提前显示）：\n${challengeUrl.toString()}`;
    setShareMessage('');
    setShareFallback('');
    try {
      const nativeShare = window.isSecureContext && typeof navigator.share === 'function';
      setShareMessage(nativeShare ? '正在打开系统分享…' : '正在复制同题挑战链接…');
      if (nativeShare) {
        await navigator.share({ title: '来挑战这道 GuessWord', text: shareText, url: challengeUrl.toString() });
      } else {
        await copyText(clipboardText);
      }
      setShareMessage(nativeShare ? '同题挑战已分享。' : '同题挑战链接已复制，可以发给朋友了。');
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') {
        setShareMessage('已取消分享。');
      } else {
        setShareMessage('浏览器没有允许自动复制，请长按或全选下方内容。');
        setShareFallback(clipboardText);
      }
    }
  }

  return (
    <main className="app-page">
      <div className="app-frame">
        <header className="app-header">
          <button className="brand" type="button" onClick={goHome} aria-label="返回 GuessWord 首页">
            <span aria-hidden="true" className="brand-mark">猜</span>
            <span className="brand-copy">
              <strong>GuessWord</strong>
              <small>AI 联想猜词</small>
            </span>
          </button>
          <div className="header-actions">
            {game && !showHome && (
              <button className="home-link" type="button" onClick={goHome}>← 首页</button>
            )}
            <button className="account-link" type="button" onClick={() => setShowAccount(true)}>
              {viewer.user?.nickname ?? '登录 / 排行'}
            </button>
            <details className="rules">
              <summary>怎么玩</summary>
              <div className="rules-card">
                <strong>根据词语关系强弱寻找隐藏词</strong>
                <p>
                  {game?.scoringMode !== 'test'
                    ? '输入 1～10 个汉字。AI 会综合词义、用途、场景、相似点和差异给出关系分；精确猜中为 100%。'
                    : '输入 1～10 个汉字，根据页面返回的测试关系分逐步尝试；精确猜中为 100%。'}
                </p>
                <p>答案字数开局时保密；每局可依次获取两条由宽到窄的方向提示，不会提供首字或直接特征。</p>
                <p>连续猜错 {ANSWER_LENGTH_UNLOCK_GUESSES} 次后会自动解锁准确字数，且不消耗提示次数。</p>
              </div>
            </details>
          </div>
        </header>

        <section id="game" className="game-shell" aria-label="猜词游戏">
          {loading ? (
            <div className="loading-state" role="status">
              <span className="loader" aria-hidden="true" />
              <p>正在准备新词…</p>
            </div>
          ) : !game || showHome ? (
            <div className="category-picker">
              {challengeSourceGameId && (
                <section className="challenge-invite" aria-labelledby="challenge-title">
                  <div>
                    <p className="section-kicker">好友同题挑战</p>
                    <h2 id="challenge-title">有人邀你猜同一个隐藏词</h2>
                    <p>会为你创建独立对局，答案和对方的猜词记录都不会提前显示。</p>
                  </div>
                  <div className="challenge-actions">
                    <button
                      className="primary"
                      type="button"
                      disabled={busy === 'new'}
                      onClick={() => requestStart({ kind: 'challenge', sourceGameId: challengeSourceGameId })}
                    >
                      {busy === 'new' ? '正在进入…' : '开始同题挑战'}
                    </button>
                    <button className="secondary" type="button" disabled={busy === 'new'} onClick={dismissChallenge}>
                      自己选题
                    </button>
                  </div>
                </section>
              )}
              <div className="category-heading">
                <p className="section-kicker">开始新一局</p>
                <h1 id="game-title">选择题目分类</h1>
                <p>每局会从所选分类随机抽取一个隐藏词。</p>
              </div>
              {game?.status === 'active' && !activeTodayDaily && (
                <section className="resume-game" aria-label="当前进行中的游戏">
                  <div><span>当前进度</span><strong>{game.mode === 'daily' ? '未完成的每日挑战' : game.category} · 已猜 {game.guessCount} 次</strong></div>
                  <button type="button" onClick={() => setShowHome(false)}>继续本局</button>
                </section>
              )}
              {activeTodayDaily ? (
                <button className="daily-challenge daily-active" type="button" onClick={() => setShowHome(false)}>
                  <span>今日挑战进行中</span><strong>已猜 {game.guessCount} 次 · 继续挑战</strong>
                </button>
              ) : todayDailyResult ? (
                <section className={`daily-result ${todayDailyResult.status}`} aria-label="今日挑战结果">
                  <div className="daily-result-heading">
                    <div>
                      <span>今日挑战已完成</span>
                      <strong>{todayDailyResult.status === 'won' ? '挑战成功' : '今日已结束'}</strong>
                    </div>
                    <span className="daily-result-badge">{todayDailyResult.status === 'won' ? '猜中' : '已揭晓'}</span>
                  </div>
                  <dl className="daily-result-stats">
                    <div><dt>猜测</dt><dd>{todayDailyResult.guessCount} 次</dd></div>
                    <div><dt>用时</dt><dd>{formatDuration(todayDailyResult.durationSeconds ?? 0)}</dd></div>
                    <div><dt>提示</dt><dd>{todayDailyResult.hintCount}/{MAX_HINT_COUNT}</dd></div>
                  </dl>
                  {currentTodayDaily && (
                    <button className="daily-result-link" type="button" onClick={() => setShowHome(false)}>
                      查看完整结果
                    </button>
                  )}
                </section>
              ) : (
                <button className="daily-challenge" type="button" disabled={busy === 'new'} onClick={() => requestStart({ kind: 'daily' })}>
                  <span>每日挑战</span><strong>今天大家猜同一个词</strong>
                </button>
              )}
              <p className="category-divider"><span>或选择分类练习</span></p>
              <div className="category-grid" role="group" aria-label="题目分类">
                {GAME_CATEGORIES.map((category) => (
                  <button
                    key={category}
                    className="category-option"
                    type="button"
                    disabled={busy === 'new'}
                    onClick={() => requestStart({ kind: 'category', category })}
                  >
                    <strong>{category}</strong>
                    <span>{CATEGORY_DESCRIPTIONS[category]}</span>
                  </button>
                ))}
              </div>
              {busy === 'new' && <p className="picker-message" role="status">正在抽取隐藏词…</p>}
              {message && <p className="picker-message error" role="alert">{message}</p>}
              <div className="picker-record" aria-label="本地战绩">
                <span>已完成 {stats.totalGames} 局</span>
                <span>猜中 {stats.wonGames} 局</span>
                <span>最佳 {stats.bestGuessCount ?? '—'} 次</span>
              </div>
            </div>
          ) : (
            <>
              <div className="game-topline">
                <span className={`scoring-label ${game.scoringMode}`}>
                  {game.scoringMode === 'semantic' ? 'AI 关系评分' : '测试评分'}
                </span>
                <div className="local-record" aria-label="本地战绩">
                  <span>本机猜中 {stats.wonGames}/{stats.totalGames}</span>
                  <span>最佳 {stats.bestGuessCount ?? '—'} 次</span>
                </div>
              </div>

              {game.status === 'active' && (
                <>
                  <div className="game-title-row">
                    <h1 id="game-title">{game.category} · 猜隐藏词</h1>
                    {game.answerLength !== undefined && (
                      <span className="rescue-length">救援线索 · {game.answerLength} 个字</span>
                    )}
                  </div>
                  <p className="intro">从词义、用途、场景和相似点逐步接近答案。</p>
                </>
              )}

              {game.status !== 'active' && (
                <section className={`result-card ${game.status}`} aria-labelledby="result-title">
                  <h2 id="result-title">{game.status === 'won' ? '猜中了！' : '答案揭晓'}</h2>
                  <p className="answer"><span>隐藏词</span><strong>{game.answer}</strong></p>
                  <p className="result-note">
                    {game.status === 'won'
                      ? '恭喜猜中，完整猜词记录保留在下方。'
                      : '你已查看答案，本局结束；完整猜词记录保留在下方。'}
                  </p>
                  <dl className={`result-stats ${game.status}`}>
                    <div><dt>有效猜测</dt><dd>{game.guessCount} 次</dd></div>
                    <div><dt>完成用时</dt><dd>{formatDuration(game.durationSeconds ?? 0)}</dd></div>
                    <div><dt>使用提示</dt><dd>{game.hintCount} 次</dd></div>
                    {game.status === 'abandoned' && (
                      <div><dt>最接近的一次</dt><dd>{game.bestGuess ? `${game.bestGuess.guess} · ${formatScore(game.bestGuess.score)}%` : '暂无'}</dd></div>
                    )}
                  </dl>
                  <button className="primary standalone" type="button" onClick={chooseAnotherCategory}>
                    再玩一局
                  </button>
                  <button className="secondary share-result" type="button" onClick={() => void shareResult()}>
                    分享这道题
                  </button>
                  {shareMessage && <p className="share-message" role="status">{shareMessage}</p>}
                  {shareFallback && (
                    <textarea
                      className="share-fallback"
                      aria-label="可复制的同题挑战内容"
                      readOnly
                      value={shareFallback}
                      onFocus={(event) => event.currentTarget.select()}
                    />
                  )}
                </section>
              )}

              {game.status === 'active' && (
                <form className="guess-form" onSubmit={submitGuess} noValidate>
                  <label className="sr-only" htmlFor="guess">你的猜测</label>
                  <div className="guess-row">
                    <input
                      ref={inputRef}
                      id="guess"
                      name="guess"
                      value={input}
                      onChange={(event) => setInput(event.target.value)}
                      placeholder="输入 1～10 个汉字"
                      autoComplete="off"
                      enterKeyHint="send"
                      aria-describedby="guess-note game-message"
                      disabled={busy === 'guess'}
                    />
                    <button className="primary" disabled={Boolean(busy)} type="submit">
                      {busy === 'guess' ? '计算中…' : '猜一下'}
                    </button>
                  </div>
                  <p id="guess-note" className="field-note">
                    {game.scoringMode === 'semantic'
                      ? '综合关系分越高越接近；相关但不同类的词也会获得有效分数。'
                      : '预置测试词用于展示关联层次；其他分数仅用于演示流程。'}
                  </p>
                  {slow && <p className="slow-note">还在认真计算，请再等一下…</p>}
                </form>
              )}

              {game.status === 'active' && (
                <>
                  {message && <p id="game-message" className="message visible" aria-live="polite" aria-atomic="true">{message}</p>}

                  <div className="score-grid" aria-label="游戏概况">
                    <div><span>当前最佳</span><strong>{game.bestGuess ? `${formatScore(game.bestGuess.score)}%` : '—'}</strong></div>
                    <div><span>已猜</span><strong>{game.guessCount} 次</strong></div>
                  </div>

                  {game.revealedHints.length > 0 && (
                    <ol className="hint-list" aria-label="已揭示提示">
                      {game.revealedHints.map((hint) => (
                        <li key={hint.level}>
                          <span>提示 {hint.level} · {hint.label}</span>
                          <strong>{hint.value}</strong>
                        </li>
                      ))}
                    </ol>
                  )}

                  <div className="actions">
                    <button
                      className="hint-action"
                      type="button"
                      disabled={Boolean(busy) || game.hintCount >= MAX_HINT_COUNT}
                      onClick={() => void requestHint()}
                    >
                      <span aria-hidden="true">💡</span>
                      {game.hintCount >= MAX_HINT_COUNT ? '提示已用完' : busy === 'hint' ? '正在揭示…' : `获取提示 ${game.hintCount + 1}/${MAX_HINT_COUNT}`}
                    </button>
                    <button ref={abandonButtonRef} className="reveal" type="button" disabled={Boolean(busy)} onClick={() => setConfirmAbandon(true)}>
                      查看答案
                    </button>
                  </div>
                </>
              )}

              <section className="history" aria-labelledby="history-title">
                <div className="section-heading">
                  <h2 id="history-title">本局猜词榜</h2>
                  <div className="sort-tabs" aria-label="排序方式">
                    <button aria-pressed={sortMode === 'score'} type="button" onClick={() => setSortMode('score')}>按关系分</button>
                    <button aria-pressed={sortMode === 'time'} type="button" onClick={() => setSortMode('time')}>按时间</button>
                  </div>
                </div>

                {orderedGuesses.length === 0 ? (
                  <div className="empty-state">
                    <p>还没有猜词，先试一个熟悉的词吧。</p>
                  </div>
                ) : (
                  <ol className="guess-list" aria-label="有效猜测记录">
                    {orderedGuesses.map((guess) => (
                      <GuessRow key={guess.sequence} guess={guess} isLatest={guess.sequence === latestSequence} feedbackSent={feedbackSent} onFeedback={submitFeedback} />
                    ))}
                  </ol>
                )}
              </section>
            </>
          )}
        </section>
      </div>

      {confirmAbandon && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeAbandonDialog();
        }}>
          <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-description">
            <p className="section-kicker">请确认</p>
            <h2 id="confirm-title">查看答案并结束本局？</h2>
            <p id="confirm-description">答案会立即揭晓，查看后本局不能继续猜测。</p>
            <div className="dialog-actions">
              <button ref={cancelAbandonRef} className="secondary" type="button" onClick={closeAbandonDialog}>继续猜</button>
              <button ref={confirmAbandonRef} className="danger" type="button" onClick={() => void abandonGame()}>结束并查看</button>
            </div>
          </section>
        </div>
      )}

      {pendingStart && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setPendingStart(null);
        }}>
          <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="switch-title" aria-describedby="switch-description">
            <p className="section-kicker">当前还有一局进行中</p>
            <h2 id="switch-title">
              {pendingStart.kind === 'challenge' ? '放弃当前进度并接受好友挑战？' : '放弃当前进度并开始新题？'}
            </h2>
            <p id="switch-description">当前猜词记录会结算为未猜中，之后不能继续。</p>
            <div className="dialog-actions">
              <button className="secondary" type="button" onClick={() => setPendingStart(null)}>取消</button>
              <button className="danger" type="button" onClick={() => void confirmStartNewGame()}>
                {pendingStart.kind === 'challenge' ? '放弃并挑战' : '放弃并开始'}
              </button>
            </div>
          </section>
        </div>
      )}

      {showAccount && (
        <AccountCenter
          viewer={viewer}
          currentGameId={game?.gameId ?? null}
          onViewerChange={setViewer}
          onClose={() => setShowAccount(false)}
        />
      )}
    </main>
  );
}

function AccountCenter({
  viewer,
  currentGameId,
  onViewerChange,
  onClose,
}: {
  viewer: ViewerResponse;
  currentGameId: string | null;
  onViewerChange: (viewer: ViewerResponse) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'account' | 'leaderboard'>('account');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [nickname, setNickname] = useState(viewer.user?.nickname ?? '');
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState<'code' | 'login' | 'profile' | 'logout' | null>(null);
  const [notice, setNotice] = useState('');
  const [dashboard, setDashboard] = useState<AccountDashboardResponse | null>(null);
  const [boardType, setBoardType] = useState<'daily' | 'challenge'>('daily');
  const [leaderboard, setLeaderboard] = useState<LeaderboardResponse | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
      ) ?? [])];
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const loadDashboard = useCallback(async () => {
    if (!viewer.authenticated) return;
    try { setDashboard(await apiRequest<AccountDashboardResponse>('/api/account')); }
    catch (error) { setNotice(getFriendlyError(error)); }
  }, [viewer.authenticated]);

  useEffect(() => {
    if (!viewer.authenticated) return;
    let active = true;
    void apiRequest<AccountDashboardResponse>('/api/account')
      .then((result) => { if (active) setDashboard(result); })
      .catch((error: unknown) => { if (active) setNotice(getFriendlyError(error)); });
    return () => { active = false; };
  }, [viewer.authenticated]);
  useEffect(() => {
    if (tab !== 'leaderboard') return;
    if (boardType === 'challenge' && !currentGameId) return;
    let active = true;
    const path = boardType === 'daily'
      ? '/api/leaderboards/daily'
      : `/api/leaderboards/challenge?gameId=${encodeURIComponent(currentGameId!)}`;
    void apiRequest<LeaderboardResponse>(path)
      .then((result) => {
        if (!active) return;
        setLeaderboard(result);
        setNotice('');
      })
      .catch((error: unknown) => { if (active) setNotice(getFriendlyError(error)); });
    return () => { active = false; };
  }, [boardType, currentGameId, tab]);
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(() => setCooldown((current) => Math.max(0, current - 1)), 1_000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  async function requestCode() {
    if (busy || cooldown > 0) return;
    setBusy('code');
    setNotice('');
    try {
      const result = await apiRequest<{ cooldownSeconds: number }>('/api/auth/sms/request', {
        method: 'POST', body: JSON.stringify({ phone }),
      });
      setCooldown(result.cooldownSeconds);
      setNotice('验证码已发送，5 分钟内有效。');
    } catch (error) { setNotice(getFriendlyError(error)); }
    finally { setBusy(null); }
  }

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy('login');
    setNotice('');
    try {
      const result = await apiRequest<ViewerResponse>('/api/auth/sms/verify', {
        method: 'POST', body: JSON.stringify({ phone, code }),
      });
      onViewerChange(result);
      setNickname(result.user?.nickname ?? '');
      setNotice('登录成功，当前游客战绩已合并。');
      setCode('');
    } catch (error) { setNotice(getFriendlyError(error)); }
    finally { setBusy(null); }
  }

  async function saveNickname(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy('profile');
    setNotice('');
    try {
      const result = await apiRequest<ViewerResponse>('/api/account', {
        method: 'PATCH', body: JSON.stringify({ nickname }),
      });
      onViewerChange(result);
      setNotice('昵称已保存。');
      await loadDashboard();
    } catch (error) { setNotice(getFriendlyError(error)); }
    finally { setBusy(null); }
  }

  async function logout() {
    if (busy) return;
    setBusy('logout');
    setNotice('');
    try {
      const result = await apiRequest<ViewerResponse>('/api/auth/logout', { method: 'POST', body: '{}' });
      onViewerChange(result);
      setDashboard(null);
      setPhone('');
      setCode('');
      setNotice('已退出登录，仍可继续以游客身份游玩。');
    } catch (error) { setNotice(getFriendlyError(error)); }
    finally { setBusy(null); }
  }

  return (
    <div className="dialog-backdrop account-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section ref={dialogRef} className="account-dialog" role="dialog" aria-modal="true" aria-labelledby="account-title">
        <div className="account-dialog-head">
          <div>
            <p className="section-kicker">GuessWord 账号</p>
            <h2 id="account-title">{viewer.authenticated ? viewer.user?.nickname : '登录后保存全部战绩'}</h2>
          </div>
          <button ref={closeButtonRef} className="dialog-close" type="button" aria-label="关闭账号中心" onClick={onClose}>×</button>
        </div>
        <div className="account-tabs" role="tablist" aria-label="账号中心">
          <button type="button" role="tab" aria-selected={tab === 'account'} onClick={() => setTab('account')}>
            {viewer.authenticated ? '我的' : '登录'}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'leaderboard'} onClick={() => setTab('leaderboard')}>排行榜</button>
        </div>

        {tab === 'account' && !viewer.authenticated && (
          <form className="login-form" onSubmit={login}>
            <p>无需注册密码，使用中国大陆手机号验证码登录；登录前的游客战绩会自动合并。</p>
            <label htmlFor="login-phone">手机号</label>
            <div className="code-row">
              <input id="login-phone" inputMode="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="请输入 11 位手机号" />
              <button className="secondary" type="button" disabled={Boolean(busy) || cooldown > 0} onClick={() => void requestCode()}>
                {cooldown > 0 ? `${cooldown}s` : busy === 'code' ? '发送中…' : '获取验证码'}
              </button>
            </div>
            <label htmlFor="login-code">验证码</label>
            <input id="login-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} placeholder="6 位验证码" />
            <button className="primary" type="submit" disabled={Boolean(busy)}>{busy === 'login' ? '登录中…' : '登录并保存战绩'}</button>
          </form>
        )}

        {tab === 'account' && viewer.authenticated && (
          <div className="account-content">
            <form className="profile-form" onSubmit={saveNickname}>
              <label htmlFor="profile-nickname">昵称</label>
              <input id="profile-nickname" value={nickname} onChange={(event) => setNickname(event.target.value)} maxLength={12} />
              <button className="secondary" type="submit" disabled={Boolean(busy)}>保存昵称</button>
            </form>
            <p className="masked-phone">已绑定手机号 {viewer.user?.maskedPhone}</p>
            {dashboard ? (
              <>
                <dl className="account-stats">
                  <div><dt>完成</dt><dd>{dashboard.stats.completedGames} 局</dd></div>
                  <div><dt>猜中</dt><dd>{dashboard.stats.wonGames} 局</dd></div>
                  <div><dt>最佳</dt><dd>{dashboard.stats.bestGuessCount ?? '—'} 次</dd></div>
                  <div><dt>连续挑战</dt><dd>{dashboard.stats.dailyStreak} 天</dd></div>
                </dl>
                <h3>最近战绩</h3>
                {dashboard.recentGames.length === 0 ? <p className="panel-empty">还没有已完成的游戏。</p> : (
                  <ol className="account-history">
                    {dashboard.recentGames.map((item) => (
                      <li key={item.gameId}>
                        <span>{item.mode === 'daily' ? '每日挑战' : item.category}</span>
                        <strong>{item.answer}</strong>
                        <small>{item.status === 'won' ? `${item.guessCount} 次猜中` : '已揭晓'} · 提示 {item.hintCount}</small>
                      </li>
                    ))}
                  </ol>
                )}
              </>
            ) : <p className="panel-empty">正在读取战绩…</p>}
            <button className="text-action" type="button" disabled={Boolean(busy)} onClick={() => void logout()}>退出登录</button>
          </div>
        )}

        {tab === 'leaderboard' && (
          <div className="leaderboard-panel">
            <div className="board-switch">
              <button type="button" aria-pressed={boardType === 'daily'} onClick={() => { setLeaderboard(null); setNotice(''); setBoardType('daily'); }}>每日挑战</button>
              <button type="button" disabled={!currentGameId} aria-pressed={boardType === 'challenge'} onClick={() => { setLeaderboard(null); setNotice(''); setBoardType('challenge'); }}>好友同题</button>
            </div>
            {leaderboard && <h3>{leaderboard.title}</h3>}
            {leaderboard?.entries.length ? (
              <ol className="leaderboard-list">
                {leaderboard.entries.map((entry) => (
                  <li key={`${entry.rank}-${entry.nickname}-${entry.completedAt}`} className={entry.isCurrentUser ? 'is-me' : ''}>
                    <strong>#{entry.rank}</strong><span>{entry.nickname}</span>
                    <small>{entry.guessCount} 次 · 提示 {entry.hintCount} · {formatDuration(entry.durationSeconds)}</small>
                  </li>
                ))}
              </ol>
            ) : leaderboard ? <p className="panel-empty">还没有可上榜的猜中记录。</p> : <p className="panel-empty">正在读取榜单…</p>}
            {!viewer.authenticated && <p className="ranking-note">游客可以查看榜单，登录后完成挑战才会显示昵称并参与排名。</p>}
            {!currentGameId && <p className="ranking-note">完成或打开一道题后，可以查看这道题的好友同题榜。</p>}
          </div>
        )}
        {notice && <p className="account-notice" role="status">{notice}</p>}
      </section>
    </div>
  );
}

function GuessRow({ guess, isLatest, feedbackSent, onFeedback }: { guess: PublicGuess; isLatest: boolean; feedbackSent: Set<number>; onFeedback: (guess: PublicGuess, direction: 'too_high' | 'too_low') => void }) {
  return (
    <li className={`guess-item ${isLatest ? 'latest' : ''}`} data-temperature={guess.temperature}>
      <div className="guess-word-cell">
        <div className="guess-copy">
          <span className="guess-sequence">#{guess.sequence}</span>
          <strong>{guess.guess}</strong>
          <span className="guess-relation" title={`${guess.temperature}：${guess.relationHint}`}>{guess.relationHint}</span>
          {isLatest && <span className="latest-label">新</span>}
        </div>
        <div
          className="score-progress"
          role="progressbar"
          aria-label={`${guess.guess} 的关系分`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={guess.score}
        >
          <span style={{ width: `${guess.score}%` }} />
        </div>
        {guess.score < 100 && (
          <div className="score-feedback" aria-label={`${guess.guess} 评分反馈`}>
            <span>AI 评分不准？</span>
            <button type="button" disabled={feedbackSent.has(guess.sequence)} onClick={() => onFeedback(guess, 'too_high')}>偏高</button>
            <button type="button" disabled={feedbackSent.has(guess.sequence)} onClick={() => onFeedback(guess, 'too_low')}>偏低</button>
          </div>
        )}
      </div>
      <strong className="guess-score">{formatScore(guess.score)}%</strong>
    </li>
  );
}

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes} 分 ${seconds} 秒` : `${seconds} 秒`;
}

function getChinaDate(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function readChallengeGameId(): string | null {
  const value = new URL(location.href).searchParams.get('challenge');
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

function removeChallengeFromUrl(): void {
  const url = new URL(location.href);
  if (!url.searchParams.has('challenge')) return;
  url.searchParams.delete('challenge');
  history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

function formatScore(score: number): string {
  return score.toFixed(3);
}

function scoreBlock(score: number): string {
  return score >= 80 ? '🟥' : score >= 60 ? '🟧' : score >= 40 ? '🟨' : score >= 20 ? '🟦' : '⬜';
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText && window.isSecureContext) return navigator.clipboard.writeText(text);
  const area = document.createElement('textarea');
  area.value = text;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  const copied = document.execCommand('copy');
  area.remove();
  if (!copied) throw new Error('Copy failed');
}
