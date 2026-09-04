import { describe, expect, it } from 'vitest';
import { GAME_CATEGORIES } from '../../lib/contracts';
import { QUESTIONS, selectDailyQuestion, selectRandomQuestion, validateQuestionBank } from '../../lib/server/questions';

describe('question bank', () => {
  it('contains at least 25 valid questions in every supported category', () => {
    expect(QUESTIONS.length).toBeGreaterThanOrEqual(GAME_CATEGORIES.length * 25);
    expect(new Set(QUESTIONS.map((item) => item.category))).toEqual(new Set(GAME_CATEGORIES));
    for (const category of GAME_CATEGORIES) {
      expect(QUESTIONS.filter((item) => item.category === category).length).toBeGreaterThanOrEqual(25);
    }
    expect(validateQuestionBank(QUESTIONS)).toEqual([]);
  });

  it('selects one stable shared question per date', () => {
    expect(selectDailyQuestion('2026-09-02')).toEqual(selectDailyQuestion('2026-09-02'));
    expect(selectDailyQuestion('2026-09-02')).not.toEqual(selectDailyQuestion('2026-09-03'));
  });

  it('only selects questions from the requested category', () => {
    for (const category of GAME_CATEGORIES) {
      expect(selectRandomQuestion(category, 0).category).toBe(category);
      expect(selectRandomQuestion(category, 0.999999).category).toBe(category);
    }
  });

  it('avoids recently used questions and falls back only when the pool is exhausted', () => {
    const first = selectRandomQuestion('动物', 0);
    const next = selectRandomQuestion('动物', 0, new Set([first.id]));
    expect(next.id).not.toBe(first.id);
    expect(next.category).toBe('动物');

    const allAnimalIds = new Set(
      QUESTIONS.filter((item) => item.category === '动物').map((item) => item.id),
    );
    expect(selectRandomQuestion('动物', 0, allAnimalIds).id).toBe(first.id);
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
