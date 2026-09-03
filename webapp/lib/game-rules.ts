import type { Temperature } from './contracts';

const CHINESE_WORD = /^\p{Script=Han}{1,10}$/u;

export type GuessValidation =
  | { ok: true; value: string }
  | { ok: false; message: string };

export function normalizeGuess(input: string): string {
  return input.normalize('NFKC').trim();
}

export function validateGuess(input: unknown): GuessValidation {
  if (typeof input !== 'string') {
    return { ok: false, message: '请输入一个中文词语。' };
  }

  const value = normalizeGuess(input);
  const length = Array.from(value).length;
  if (length === 0) {
    return { ok: false, message: '先输入一个词再试试。' };
  }
  if (length > 10) {
    return { ok: false, message: '词语不能超过 10 个汉字。' };
  }
  if (!CHINESE_WORD.test(value)) {
    return { ok: false, message: '目前只支持 1～10 个连续汉字。' };
  }
  return { ok: true, value };
}

export function scoreToTemperature(scoreMilliPercent: number): Temperature {
  if (
    !Number.isInteger(scoreMilliPercent) ||
    scoreMilliPercent < 0 ||
    scoreMilliPercent > 100_000
  ) {
    throw new RangeError('Score must be an integer from 0 to 100000.');
  }
  if (scoreMilliPercent === 100_000) return '猜中';
  if (scoreMilliPercent >= 85_000) return '非常接近';
  if (scoreMilliPercent >= 65_000) return '强关系';
  if (scoreMilliPercent >= 45_000) return '明显相关';
  if (scoreMilliPercent >= 25_000) return '方向接近';
  if (scoreMilliPercent >= 10_000) return '同类线索';
  return '关系较远';
}

export function scoreMilliPercentToPercent(scoreMilliPercent: number): number {
  return scoreMilliPercent / 1000;
}

export function capNonExactScore(scoreMilliPercent: number): number {
  if (!Number.isFinite(scoreMilliPercent)) {
    throw new RangeError('Score must be finite.');
  }
  return Math.max(0, Math.min(99_900, Math.round(scoreMilliPercent)));
}

export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || a.length !== b.length) {
    throw new RangeError('Vectors must be non-empty and have matching dimensions.');
  }
  let dot = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index];
    const right = b[index];
    if (!Number.isFinite(left) || !Number.isFinite(right)) {
      throw new RangeError('Vectors must contain finite numbers.');
    }
    dot += left * right;
    magnitudeA += left * left;
    magnitudeB += right * right;
  }
  if (magnitudeA === 0 || magnitudeB === 0) {
    throw new RangeError('Zero vectors do not have a cosine similarity.');
  }
  return dot / (Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB));
}

export function calibrateSimilarity(cosine: number): number {
  if (!Number.isFinite(cosine)) {
    throw new RangeError('Cosine similarity must be finite.');
  }
  const clamped = Math.max(-1, Math.min(1, cosine));
  const normalized = (clamped + 1) / 2;
  return capNonExactScore(normalized ** 3 * 99_900);
}
