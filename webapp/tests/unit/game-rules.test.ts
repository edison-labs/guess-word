import { describe, expect, it } from 'vitest';
import {
  calibrateSimilarity,
  capNonExactScore,
  cosineSimilarity,
  normalizeGuess,
  scoreToTemperature,
  validateGuess,
} from '../../lib/game-rules';

describe('guess normalization and validation', () => {
  it('trims Unicode whitespace and applies NFKC', () => {
    expect(normalizeGuess('　企鵝　')).toBe('企鵝');
    expect(normalizeGuess('  企鹅  ')).toBe('企鹅');
  });

  it.each(['猫', '一二三四五六七八九十'])('accepts Chinese words at the boundary: %s', (value) => {
    expect(validateGuess(value)).toEqual({ ok: true, value });
  });

  it.each([
    ['', '先输入一个词再试试。'],
    ['一二三四五六七八九十一', '词语不能超过 10 个汉字。'],
    ['企鹅 海豹', '目前只支持 1～10 个连续汉字。'],
    ['企鹅\n', '企鹅'],
    ['企\u200b鹅', '目前只支持 1～10 个连续汉字。'],
    ['apple', '目前只支持 1～10 个连续汉字。'],
    ['企鹅1', '目前只支持 1～10 个连续汉字。'],
    ['企鹅！', '目前只支持 1～10 个连续汉字。'],
    ['🐧', '目前只支持 1～10 个连续汉字。'],
  ])('handles invalid input %j', (value, expected) => {
    const result = validateGuess(value);
    if (expected === '企鹅') expect(result).toEqual({ ok: true, value: expected });
    else expect(result).toEqual({ ok: false, message: expected });
  });
});

describe('temperature boundaries', () => {
  it.each([
    [0, '几乎无关'],
    [19_999, '几乎无关'],
    [20_000, '关联较弱'],
    [39_999, '关联较弱'],
    [40_000, '有些关联'],
    [59_999, '有些关联'],
    [60_000, '关联较强'],
    [79_999, '关联较强'],
    [80_000, '高度相关'],
    [94_999, '高度相关'],
    [95_000, '非常接近'],
    [99_900, '非常接近'],
    [100_000, '猜中'],
  ] as const)('maps %d to %s', (score, label) => {
    expect(scoreToTemperature(score)).toBe(label);
  });

  it.each([-1, 100_001, 1.2, Number.NaN])('rejects invalid score %s', (score) => {
    expect(() => scoreToTemperature(score)).toThrow(RangeError);
  });
});

describe('semantic math', () => {
  it('computes known cosine cases', () => {
    expect(cosineSimilarity([1, 2], [1, 2])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
    expect(cosineSimilarity([2, 0], [8, 0])).toBeCloseTo(1);
  });

  it.each([
    [[0, 0], [1, 1]],
    [[1], [1, 2]],
    [[1, Number.NaN], [1, 2]],
  ])('rejects invalid vectors', (left, right) => {
    expect(() => cosineSimilarity(left, right)).toThrow(RangeError);
  });

  it('calibrates monotonically and remains bounded', () => {
    const values = [-1, -0.5, 0, 0.5, 1].map(calibrateSimilarity);
    expect(values).toEqual([...values].sort((a, b) => a - b));
    expect(values[0]).toBe(0);
    expect(values.at(-1)).toBe(99_900);
  });

  it('caps every non-exact result at 99.9%', () => {
    expect(capNonExactScore(500_000)).toBe(99_900);
    expect(capNonExactScore(-20)).toBe(0);
    expect(() => capNonExactScore(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});
