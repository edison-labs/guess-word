import { describe, expect, it } from 'vitest';
import { GAME_CATEGORIES } from '../../lib/contracts';
import { QUESTIONS, selectRandomQuestion, validateQuestionBank } from '../../lib/server/questions';

describe('question bank', () => {
  it('contains at least 100 valid and balanced questions across all categories', () => {
    expect(QUESTIONS.length).toBeGreaterThanOrEqual(100);
    expect(new Set(QUESTIONS.map((item) => item.category))).toEqual(new Set(GAME_CATEGORIES));
    for (const category of GAME_CATEGORIES) {
      expect(QUESTIONS.filter((item) => item.category === category).length).toBeGreaterThanOrEqual(15);
    }
    expect(validateQuestionBank(QUESTIONS)).toEqual([]);
  });

  it('only selects questions from the requested category', () => {
    for (const category of GAME_CATEGORIES) {
      expect(selectRandomQuestion(category, 0).category).toBe(category);
      expect(selectRandomQuestion(category, 0.999999).category).toBe(category);
    }
  });

  it('detects structural failures', () => {
    const broken = [
      ...QUESTIONS.slice(0, 99),
      { ...QUESTIONS[0], id: QUESTIONS[1].id, hotHint: QUESTIONS[0].answer, length: 99 },
    ];
    const errors = validateQuestionBank(broken);
    expect(errors.some((message) => message.includes('ID 重复'))).toBe(true);
    expect(errors.some((message) => message.includes('字数不正确'))).toBe(true);
    expect(errors.some((message) => message.includes('高关联提示'))).toBe(true);
  });
});
