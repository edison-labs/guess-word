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
};

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
  const booted = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelAbandonRef = useRef<HTMLButtonElement>(null);
  const confirmAbandonRef = useRef<HTMLButtonElement>(null);
  const abandonButtonRef = useRef<HTMLButtonElement>(null);

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
      requestAnimationFrame(() => inputRef.current?.focus());
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
    localStorage.removeItem(SESSION_KEY);
    setSession(null);
    setGame(null);
    setInput('');
    setMessage('');
    setLatestSequence(null);
    setSortMode('score');
  }, []);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    setStats(parseLocalStats(localStorage.getItem(STATS_KEY)));
    void bootGame();
  }, [bootGame]);

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
    setMessage('正在计算关联度…');
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
          ? `${newest.guess}：${formatScore(newest.score)}%，${newest.temperature}`
          : '关联度已更新。',
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

  return (
    <main className="app-page">
      <div className="app-frame">
        <header className="app-header">
          <a className="brand" href="#game" aria-label="GuessWord 首页">
            <span aria-hidden="true" className="brand-mark">猜</span>
            <span className="brand-copy">
              <strong>GuessWord</strong>
              <small>AI 联想猜词</small>
            </span>
          </a>
          <details className="rules">
            <summary>怎么玩</summary>
            <div className="rules-card">
              <strong>根据语义关联强弱寻找隐藏词</strong>
              <p>
                {game?.scoringMode !== 'test'
                  ? '输入 1～10 个汉字。AI 语义关联度越高，通常越接近答案；精确猜中为 100%。'
                  : '输入 1～10 个汉字，根据页面返回的测试关联度逐步尝试；精确猜中为 100%。'}
              </p>
              <p>每局可依次使用三条提示：字数、子类别和高关联参考词。</p>
            </div>
          </details>
        </header>

        <section id="game" className="game-shell" aria-label="猜词游戏">
          {loading ? (
            <div className="loading-state" role="status">
              <span className="loader" aria-hidden="true" />
              <p>正在准备新词…</p>
            </div>
          ) : !game ? (
            <div className="category-picker">
              <div className="category-heading">
                <p className="section-kicker">开始新一局</p>
                <h1 id="game-title">选择题目分类</h1>
                <p>每局会从所选分类随机抽取一个隐藏词。</p>
              </div>
              <div className="category-grid" role="group" aria-label="题目分类">
                {GAME_CATEGORIES.map((category) => (
                  <button
                    key={category}
                    className="category-option"
                    type="button"
                    disabled={busy === 'new'}
                    onClick={() => void createNewGame(category)}
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
                <div className="local-record" aria-label="本地战绩">
                  <span>本机猜中 {stats.wonGames}/{stats.totalGames}</span>
                  <span>最佳 {stats.bestGuessCount ?? '—'} 次</span>
                </div>
              </div>

              {game.status === 'active' && (
                <>
                  <div className={`scoring-notice ${game.scoringMode}`}>
                    <strong>{game.scoringMode === 'semantic' ? 'AI 语义评分' : '测试评分'}</strong>
                    <span>{game.scoringMode === 'semantic' ? '关联度表示词义接近程度，不是答案概率。' : '仅用于演示游戏流程。'}</span>
                  </div>
                  <h1 id="game-title">{game.category} · 猜隐藏词</h1>
                  <p className="intro">输入一个中文词，根据关联度逐步接近答案。</p>
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
                      ? '数值越高，语义关联通常越强；关联度不是答案概率。'
                      : '预置测试词用于展示关联层次；其他分数仅用于演示流程。'}
                  </p>
                  {slow && <p className="slow-note">还在认真计算，请再等一下…</p>}
                </form>
              )}

              {game.status === 'active' && (
                <>
                  <p id="game-message" className={`message ${message ? 'visible' : ''}`} aria-live="polite" aria-atomic="true">
                    {message || '\u00a0'}
                  </p>

                  <div className="score-grid" aria-label="游戏概况">
                    <div><span>当前最佳</span><strong>{game.bestGuess ? `${formatScore(game.bestGuess.score)}%` : '—'}</strong></div>
                    <div><span>已猜</span><strong>{game.guessCount} 次</strong></div>
                    <div><span>提示</span><strong>{game.hintCount} / 3</strong></div>
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
                      className="secondary"
                      type="button"
                      disabled={Boolean(busy) || game.hintCount >= 3}
                      onClick={() => void requestHint()}
                    >
                      {game.hintCount >= 3 ? '提示已用完' : busy === 'hint' ? '正在揭示…' : `获取第 ${game.hintCount + 1} 条提示`}
                    </button>
                    <button ref={abandonButtonRef} className="reveal" type="button" disabled={Boolean(busy)} onClick={() => setConfirmAbandon(true)}>
                      查看答案
                    </button>
                  </div>
                </>
              )}

              <section className="history" aria-labelledby="history-title">
                <div className="section-heading">
                  <div>
                    <h2 id="history-title">本局猜词榜</h2>
                    <p className="history-count">已猜 {game.guessCount} 次</p>
                  </div>
                  <div className="sort-tabs" aria-label="排序方式">
                    <button aria-pressed={sortMode === 'score'} type="button" onClick={() => setSortMode('score')}>按关联度</button>
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
                      <GuessRow key={guess.sequence} guess={guess} isLatest={guess.sequence === latestSequence} />
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
    </main>
  );
}

function GuessRow({ guess, isLatest }: { guess: PublicGuess; isLatest: boolean }) {
  return (
    <li className={`guess-item ${isLatest ? 'latest' : ''}`} data-temperature={guess.temperature}>
      <div className="guess-word-cell">
        <div className="guess-copy">
          <span className="guess-sequence">#{guess.sequence}</span>
          <strong>{guess.guess}</strong>
          <span className="guess-temperature">{guess.temperature}</span>
          {isLatest && <span className="latest-label">新</span>}
        </div>
        <div
          className="score-progress"
          role="progressbar"
          aria-label={`${guess.guess} 的关联度`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={guess.score}
        >
          <span style={{ width: `${guess.score}%` }} />
        </div>
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

function formatScore(score: number): string {
  return score.toFixed(3);
}
