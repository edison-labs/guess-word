import { vi } from 'vitest';
import { GameService } from '../lib/server/game-service';
import { MemoryGameStore } from '../lib/server/game-store';
import { getQuestionById } from '../lib/server/questions';
import type { SemanticScorer } from '../lib/server/scoring';
import type { ScoringMode } from '../lib/contracts';

export function createTestHarness(scorer?: SemanticScorer, scoringMode: ScoringMode = 'test') {
  const store = new MemoryGameStore();
  let now = Date.UTC(2026, 7, 30, 8, 0, 0);
  let sequence = 0;
  let claimSequence = 0;
  const scoreNonExact = vi.fn(async (guess: string) => {
    const scores: Record<string, number> = {
      银行: 8_137,
      汽车: 18_426,
      鸟类: 78_364,
      海豹: 88_719,
      南极: 97_283,
    };
    return scores[guess] ?? 42_173;
  });
  const activeScorer: SemanticScorer = scorer ?? { scoreNonExact };
  const service = new GameService({
    store,
    scorer: activeScorer,
    scoringMode,
    now: () => now,
    questionSelector: () => getQuestionById('animal_penguin')!,
    idGenerator: () => {
      sequence += 1;
      return `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
    },
    tokenGenerator: () => `test-token-${String(sequence + 1).padStart(32, 'x')}`,
    claimTokenGenerator: () => {
      claimSequence += 1;
      return `claim-token-${String(claimSequence).padStart(32, 'x')}`;
    },
  });
  return {
    store,
    service,
    scoreNonExact,
    advance(ms: number) {
      now += ms;
    },
  };
}
