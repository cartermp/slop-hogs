import type {
  SinglePlayerAchievementProgress,
  SinglePlayerDifficulty,
} from "./single-player.ts";

export type SinglePlayerAchievementMetric = keyof SinglePlayerAchievementProgress | "difficultiesBeaten";
export type SinglePlayerAchievementTier = "bronze" | "silver" | "gold" | "mythic";

export interface SinglePlayerAchievementDefinition {
  id: string;
  title: string;
  description: string;
  category: "solo" | "victory" | "mastery";
  tier: SinglePlayerAchievementTier;
  metric: SinglePlayerAchievementMetric;
  goal: number;
  unit: "count" | "points";
}

export const SINGLE_PLAYER_ACHIEVEMENTS: readonly SinglePlayerAchievementDefinition[] = [
  {
    id: "solo-table-for-one",
    title: "Table for One",
    description: "Start a single-player run.",
    category: "solo",
    tier: "bronze",
    metric: "gamesStarted",
    goal: 1,
    unit: "count",
  },
  {
    id: "solo-first-blood",
    title: "First Blood, No Witnesses",
    description: "Knock out your first CPU hog.",
    category: "solo",
    tier: "bronze",
    metric: "totalKnockouts",
    goal: 1,
    unit: "count",
  },
  {
    id: "solo-survivor",
    title: "Solo Queue Survivor",
    description: "Win a single-player run on any difficulty.",
    category: "victory",
    tier: "bronze",
    metric: "wins",
    goal: 1,
    unit: "count",
  },
  {
    id: "solo-easy-win",
    title: "Training Wheels Removed",
    description: "Win on Easy.",
    category: "victory",
    tier: "bronze",
    metric: "easyWins",
    goal: 1,
    unit: "count",
  },
  {
    id: "solo-medium-win",
    title: "Standard Deviation",
    description: "Win on Medium.",
    category: "victory",
    tier: "silver",
    metric: "mediumWins",
    goal: 1,
    unit: "count",
  },
  {
    id: "solo-hard-win",
    title: "Nightmare Fuel",
    description: "Win on Hard.",
    category: "victory",
    tier: "gold",
    metric: "hardWins",
    goal: 1,
    unit: "count",
  },
  {
    id: "solo-clean-plate",
    title: "Clean Plate",
    description: "Win without taking damage.",
    category: "mastery",
    tier: "gold",
    metric: "flawlessWins",
    goal: 1,
    unit: "count",
  },
  {
    id: "solo-one-hog-army",
    title: "One-Hog Army",
    description: "Knock out 10 CPU hogs.",
    category: "mastery",
    tier: "silver",
    metric: "totalKnockouts",
    goal: 10,
    unit: "count",
  },
  {
    id: "solo-botnet-butcher",
    title: "Botnet Butcher",
    description: "Knock out 25 CPU hogs.",
    category: "mastery",
    tier: "gold",
    metric: "totalKnockouts",
    goal: 25,
    unit: "count",
  },
  {
    id: "solo-repeat-customer",
    title: "Repeat Customer",
    description: "Win 5 single-player runs.",
    category: "mastery",
    tier: "gold",
    metric: "wins",
    goal: 5,
    unit: "count",
  },
  {
    id: "solo-difficulty-spike",
    title: "Difficulty Spike",
    description: "Win on Easy, Medium, and Hard.",
    category: "mastery",
    tier: "mythic",
    metric: "difficultiesBeaten",
    goal: 3,
    unit: "count",
  },
  {
    id: "solo-score-attack",
    title: "Score Attack",
    description: "Score 1,000 points in one single-player run.",
    category: "mastery",
    tier: "mythic",
    metric: "bestRunScore",
    goal: 1_000,
    unit: "points",
  },
];

export const SINGLE_PLAYER_ACHIEVEMENT_BY_ID = new Map(
  SINGLE_PLAYER_ACHIEVEMENTS.map(achievement => [achievement.id, achievement]),
);

export function emptySinglePlayerAchievementProgress(): SinglePlayerAchievementProgress {
  return {
    gamesStarted: 0,
    wins: 0,
    easyWins: 0,
    mediumWins: 0,
    hardWins: 0,
    totalKnockouts: 0,
    bestRunScore: 0,
    flawlessWins: 0,
  };
}

export function singlePlayerAchievementValue(
  achievement: SinglePlayerAchievementDefinition,
  progress: SinglePlayerAchievementProgress,
): number {
  if (achievement.metric === "difficultiesBeaten") {
    return Number(progress.easyWins > 0) + Number(progress.mediumWins > 0) + Number(progress.hardWins > 0);
  }
  return progress[achievement.metric];
}

export function eligibleSinglePlayerAchievements(
  progress: SinglePlayerAchievementProgress,
): SinglePlayerAchievementDefinition[] {
  return SINGLE_PLAYER_ACHIEVEMENTS.filter(
    achievement => singlePlayerAchievementValue(achievement, progress) >= achievement.goal,
  );
}

export function newlyEligibleSinglePlayerAchievements(
  previous: SinglePlayerAchievementProgress,
  next: SinglePlayerAchievementProgress,
): SinglePlayerAchievementDefinition[] {
  return SINGLE_PLAYER_ACHIEVEMENTS.filter(achievement => (
    singlePlayerAchievementValue(achievement, previous) < achievement.goal
    && singlePlayerAchievementValue(achievement, next) >= achievement.goal
  ));
}

export function formatSinglePlayerAchievementProgress(
  value: number,
  achievement: SinglePlayerAchievementDefinition,
): string {
  const suffix = achievement.unit === "points" ? " pts" : "";
  return `${Math.min(value, achievement.goal).toLocaleString()} / ${achievement.goal.toLocaleString()}${suffix}`;
}

export function singlePlayerAchievementShareUrl(
  achievement: SinglePlayerAchievementDefinition,
  playerName: string,
): string {
  const text = [
    `[SOLO SLOP HOG ACHIEVEMENT: ${achievement.title.toUpperCase()}]`,
    `${playerName} earned a ${achievement.tier.toUpperCase()} single-player badge in Slop Hogs.`,
    achievement.description,
    "#SlopHogs",
  ].join("\n\n");
  return `https://bsky.app/intent/compose?text=${encodeURIComponent(text)}`;
}

export function recordSinglePlayerVictory(
  progress: SinglePlayerAchievementProgress,
  difficulty: SinglePlayerDifficulty,
  flawless: boolean,
): SinglePlayerAchievementProgress {
  return {
    ...progress,
    wins: progress.wins + 1,
    easyWins: progress.easyWins + Number(difficulty === "easy"),
    mediumWins: progress.mediumWins + Number(difficulty === "medium"),
    hardWins: progress.hardWins + Number(difficulty === "hard"),
    flawlessWins: progress.flawlessWins + Number(flawless),
  };
}
