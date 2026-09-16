import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BATTLE_OUTCOME_MESSAGES,
  battleOutcomeMessage,
  type BattleOutcome,
} from "../src/lib/battle-messages.ts";

const outcomes = Object.keys(BATTLE_OUTCOME_MESSAGES) as BattleOutcome[];

test("battle outcome messages rotate and wrap for every outcome", () => {
  for (const outcome of outcomes) {
    const messages = BATTLE_OUTCOME_MESSAGES[outcome];

    messages.forEach((message, index) => {
      assert.equal(battleOutcomeMessage(outcome, index), message);
    });
    assert.equal(battleOutcomeMessage(outcome, messages.length), messages[0]);
    assert.equal(battleOutcomeMessage(outcome, -1), messages.at(-1));
  }
});

test("psychosis messages keep the pop callout", () => {
  for (const message of BATTLE_OUTCOME_MESSAGES.psychosis) {
    assert.match(message, /^POP!/);
  }
});
