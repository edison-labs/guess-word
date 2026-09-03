'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  GAME_CATEGORIES,
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

type PendingStart = { kind: 'daily' } | { kind: 'category'; category: GameCategory };

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

  const createNewGame = useCallback(async (category: GameCategory) => {
    setBusy('new');
    setMessage('');
    try {
      const created = await apiRequest<CreateGameResponse>('/api/games', {
        method: 'POST',
        body: JSON.stringify({ category }),
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
  }, [acceptGame]);

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

  const bootGame = useCallback(async () => {
    setLoading(true);
    setMessage('');
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
    void bootGame();
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
    if (!session || !game || game.status !== 'active' || game.hintCount >= 3 || busy) return;
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
      else await createNewGame(target.category);
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
    const text = [
      `GuessWord ${game.mode === 'daily' ? `每日挑战 ${game.dailyDate}` : game.category}`,
      `${game.status === 'won' ? `第 ${game.guessCount} 次猜中` : `挑战结束 · ${game.guessCount} 次猜测`} · 提示 ${game.hintCount}/3`,
      bars || '还没有猜测',
      `来试试 AI 联想猜词：${location.href}`,
    ].join('\n');
    setShareMessage('');
    setShareFallback('');
    try {
      const nativeShare = window.isSecureContext && typeof navigator.share === 'function';
      setShareMessage(nativeShare ? '正在打开系统分享…' : '正在复制战绩…');
      if (nativeShare) await navigator.share({ title: 'GuessWord', text, url: location.href });
      else await copyText(text);
      setShareMessage(nativeShare ? '战绩已分享。' : '战绩已复制，可以粘贴给朋友了。');
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') {
        setShareMessage('已取消分享。');
      } else {
        setShareMessage('浏览器没有允许自动复制，请长按或全选下方内容。');
        setShareFallback(text);
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
            <details className="rules">
              <summary>怎么玩</summary>
              <div className="rules-card">
                <strong>根据词语关系强弱寻找隐藏词</strong>
                <p>
                  {game?.scoringMode !== 'test'
                    ? '输入 1～10 个汉字。AI 会综合词义、用途、场景、相似点和差异给出关系分；精确猜中为 100%。'
                    : '输入 1～10 个汉字，根据页面返回的测试关系分逐步尝试；精确猜中为 100%。'}
                </p>
                <p>答案字数会直接显示；每局还可依次使用范围、参考词和开头字三条提示。</p>
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
                    <div><dt>提示</dt><dd>{todayDailyResult.hintCount}/3</dd></div>
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
                    <span className="answer-length">目标 {game.answerLength} 个字</span>
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
                    分享战绩
                  </button>
                  {shareMessage && <p className="share-message" role="status">{shareMessage}</p>}
                  {shareFallback && (
                    <textarea
                      className="share-fallback"
                      aria-label="可复制的战绩文本"
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
                      disabled={Boolean(busy) || game.hintCount >= 3}
                      onClick={() => void requestHint()}
                    >
                      <span aria-hidden="true">💡</span>
                      {game.hintCount >= 3 ? '提示已用完' : busy === 'hint' ? '正在揭示…' : `获取提示 ${game.hintCount + 1}/3`}
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
            <h2 id="switch-title">放弃当前进度并开始新题？</h2>
            <p id="switch-description">当前猜词记录会结算为未猜中，之后不能继续。</p>
            <div className="dialog-actions">
              <button className="secondary" type="button" onClick={() => setPendingStart(null)}>取消</button>
              <button className="danger" type="button" onClick={() => void confirmStartNewGame()}>放弃并开始</button>
            </div>
          </section>
        </div>
      )}
    </main>
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
