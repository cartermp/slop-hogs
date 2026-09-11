import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ACHIEVEMENTS,
  advanceAchievementProgress,
  achievementShareUrl,
  achievementValue,
  eligibleAchievements,
  emptyAchievementProgress,
} from "../src/lib/achievements.ts";

test("the catalog contains 100 unique, measurable achievements", () => {
  assert.equal(ACHIEVEMENTS.length, 100);
  assert.equal(new Set(ACHIEVEMENTS.map(achievement => achievement.id)).size, 100);
  assert.ok(ACHIEVEMENTS.every(achievement => achievement.goal > 0));
  assert.ok(ACHIEVEMENTS.some(achievement => achievement.metric === "bestHighPsychosisMs"));
  assert.ok(ACHIEVEMENTS.some(achievement => achievement.metric === "maxRunVariety"));
  assert.ok(ACHIEVEMENTS.every(achievement => {
    const text = new URL(achievementShareUrl(achievement, "HOG-CAFE")).searchParams.get("text") ?? "";
    return [...text].length <= 300;
  }));
});

test("achievement eligibility reads scalar and slop-kind progress", () => {
  const progress = emptyAchievementProgress();
  progress.totalSlop = 1;
  progress.kindCounts.premium_tokens = 5;
  const eligible = eligibleAchievements(progress);
  assert.ok(eligible.some(achievement => achievement.id === "slop-1"));
  assert.ok(eligible.some(achievement => achievement.id === "specialist-premium-tokens-2"));
  assert.equal(
    achievementValue(ACHIEVEMENTS.find(achievement => achievement.id === "specialist-premium-tokens-2")!, progress),
    5,
  );
});

test("Bluesky sharing uses a prefilled compose intent", () => {
  const achievement = ACHIEVEMENTS[0];
  const url = new URL(achievementShareUrl(achievement, "HOG-CAFE"));
  assert.equal(url.origin, "https://bsky.app");
  assert.equal(url.pathname, "/intent/compose");
  assert.match(url.searchParams.get("text") ?? "", /HOG-CAFE/);
  assert.match(url.searchParams.get("text") ?? "", /FIRST TROUGH/);
});

test("high-psychosis movement requires a continuous server-observed streak", () => {
  const start = emptyAchievementProgress();
  const first = advanceAchievementProgress(start, {
    distance: 10,
    movementElapsedMs: 120,
    movedAtHighPsychosis: true,
    nowMs: 1_000,
    slopKind: null,
    pointsGained: 0,
    runScore: 0,
    runSlop: 0,
    popped: false,
    restarted: false,
  });
  const continuous = advanceAchievementProgress(first, {
    distance: 12,
    movementElapsedMs: 120,
    movedAtHighPsychosis: true,
    nowMs: 1_120,
    slopKind: null,
    pointsGained: 0,
    runScore: 0,
    runSlop: 0,
    popped: false,
    restarted: false,
  });
  const afterGap = advanceAchievementProgress(continuous, {
    distance: 8,
    movementElapsedMs: 120,
    movedAtHighPsychosis: true,
    nowMs: 1_600,
    slopKind: null,
    pointsGained: 0,
    runScore: 0,
    runSlop: 0,
    popped: false,
    restarted: false,
  });
  assert.equal(continuous.currentHighPsychosisMs, 240);
  assert.equal(continuous.highPsychosisDistance, 22);
  assert.equal(afterGap.currentHighPsychosisMs, 120);
  assert.equal(afterGap.bestHighPsychosisMs, 240);
});

test("consumption progress tracks run variety, streaks, and lifetime totals", () => {
  const input = {
    distance: 0,
    movementElapsedMs: 0,
    movedAtHighPsychosis: false,
    nowMs: 1_000,
    slopKind: "premium_tokens" as const,
    pointsGained: 300,
    runScore: 300,
    runSlop: 1,
    popped: false,
    restarted: false,
  };
  const first = advanceAchievementProgress(emptyAchievementProgress(), input);
  const second = advanceAchievementProgress(first, { ...input, nowMs: 1_200, runScore: 600, runSlop: 2 });
  assert.equal(second.totalSlop, 2);
  assert.equal(second.totalScore, 600);
  assert.equal(second.kindCounts.premium_tokens, 2);
  assert.equal(second.maxRunVariety, 1);
  assert.equal(second.sameKindStreak, 2);
  assert.equal(second.bestRunScore, 600);
});
