export const BATTLE_OUTCOME_MESSAGES = {
  defeat: [
    "HAM OVER. INSERT SLOP.",
    "THE TROUGH CLAIMS ANOTHER.",
    "YOUR BACON HAS BEEN COLLECTED.",
    "ROUND LOST. DIGNITY ALSO LOST.",
    "YOU FOUGHT THE HOG. THE HOG WON.",
    "DEFEATED, DE-HOOFED, DEPLATFORMED.",
  ],
  victory: [
    "FLAWLESS PORKTORY.",
    "THE TROUGH HAS A NEW CHAMPION.",
    "ALL CHALLENGERS HAVE BEEN DEBACONED.",
    "YOUR OPPONENT IS NOW A BREAKFAST ITEM.",
    "FINISH HAM! ...YOU DID.",
    "THE FARM BOWS BEFORE YOUR TERRIBLE POWER.",
  ],
  psychosis: [
    "POP! TOO MUCH SLOP, NOT ENOUGH THOUGHT.",
    "POP! YOUR CONTEXT WINDOW EXPLODED.",
    "POP! PSYCHOSIS WINS. BACON EVERYWHERE.",
    "POP! CRITICAL MASS. TERRIBLE IDEA.",
    "POP! THE MODEL HAS LEFT THE HOG.",
    "POP! YOU ATE THE ENTIRE INTERNET.",
  ],
} as const;

export type BattleOutcome = keyof typeof BATTLE_OUTCOME_MESSAGES;

export function battleOutcomeMessage(outcome: BattleOutcome, rotation: number): string {
  const messages = BATTLE_OUTCOME_MESSAGES[outcome];
  const index = ((Math.trunc(rotation) % messages.length) + messages.length) % messages.length;
  return messages[index];
}
