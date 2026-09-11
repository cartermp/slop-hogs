import { SLOP_CATALOG, SLOP_KINDS, type SlopKind } from "./farm-game.ts";

export const HIGH_PSYCHOSIS_MASS = 62;
export const HIGH_PSYCHOSIS_GRACE_MS = 400;
export const ACHIEVEMENT_CATALOG_VERSION = 2;

export const ACHIEVEMENT_CATEGORIES = [
  "consumption",
  "score",
  "movement",
  "psychosis",
  "survival",
  "battle",
  "specialist",
  "style",
] as const;

export type AchievementCategory = (typeof ACHIEVEMENT_CATEGORIES)[number];
export type AchievementTier = "bronze" | "silver" | "gold" | "mythic";
export type AchievementScalarMetric =
  | "totalSlop"
  | "totalScore"
  | "totalDistance"
  | "bestHighPsychosisMs"
  | "highPsychosisDistance"
  | "pops"
  | "knockouts"
  | "runs"
  | "bestRunScore"
  | "bestRunSlop"
  | "bestSameKindStreak"
  | "maxRunVariety";
export type AchievementMetric = AchievementScalarMetric | `kind:${SlopKind}`;

export interface AchievementDefinition {
  id: string;
  title: string;
  description: string;
  category: AchievementCategory;
  tier: AchievementTier;
  metric: AchievementMetric;
  goal: number;
  unit: "count" | "points" | "distance" | "duration";
}

export interface AchievementProgress {
  totalSlop: number;
  totalScore: number;
  totalDistance: number;
  highPsychosisDistance: number;
  currentHighPsychosisMs: number;
  bestHighPsychosisMs: number;
  lastHighMoveAtMs: number | null;
  pops: number;
  knockouts: number;
  runs: number;
  bestRunScore: number;
  bestRunSlop: number;
  currentRunDistance: number;
  bestRunDistance: number;
  kindCounts: Record<SlopKind, number>;
  runKindMask: number;
  maxRunVariety: number;
  lastSlopKind: SlopKind | null;
  sameKindStreak: number;
  bestSameKindStreak: number;
}

export interface AchievementUnlock {
  id: string;
  unlockedAt: string;
}

export interface AchievementState {
  progress: AchievementProgress;
  unlocks: AchievementUnlock[];
}

export interface AchievementAdvance {
  distance: number;
  movementElapsedMs: number;
  movedAtHighPsychosis: boolean;
  nowMs: number;
  slopKind: SlopKind | null;
  pointsGained: number;
  runScore: number;
  runSlop: number;
  popped: boolean;
  knockouts: number;
  restarted: boolean;
}

type LadderOptions = {
  prefix: string;
  titles: readonly string[];
  descriptions: readonly string[];
  goals: readonly number[];
  category: AchievementCategory;
  metric: AchievementMetric;
  unit: AchievementDefinition["unit"];
};

function tierFor(index: number, length: number): AchievementTier {
  const ratio = (index + 1) / length;
  if (ratio <= 0.3) return "bronze";
  if (ratio <= 0.6) return "silver";
  if (ratio <= 0.85) return "gold";
  return "mythic";
}

function ladder(options: LadderOptions): AchievementDefinition[] {
  if (
    options.titles.length !== options.goals.length
    || options.descriptions.length !== options.goals.length
  ) {
    throw new Error(`Achievement ladder ${options.prefix} is incomplete`);
  }
  return options.goals.map((goal, index) => ({
    id: `${options.prefix}-${index + 1}`,
    title: options.titles[index],
    description: options.descriptions[index],
    category: options.category,
    tier: tierFor(index, options.goals.length),
    metric: options.metric,
    goal,
    unit: options.unit,
  }));
}

const consumption = ladder({
  prefix: "slop",
  titles: [
    "First Trough",
    "Seconds, Obviously",
    "Slop Regular",
    "Bottomless Browser",
    "Feed Refresh Fiend",
    "Industrial Appetite",
    "Content Landfill",
    "Infinite Scroll Swine",
    "Planetary Trough",
    "The Slop Singularity",
  ],
  descriptions: [
    "Consume your first piece of unverified slop.",
    "Consume 5 pieces of slop.",
    "Consume 10 pieces of slop.",
    "Consume 25 pieces of slop.",
    "Consume 50 pieces of slop.",
    "Consume 100 pieces of slop.",
    "Consume 250 pieces of slop.",
    "Consume 500 pieces of slop.",
    "Consume 1,000 pieces of slop.",
    "Consume 5,000 pieces. The trough now consumes you.",
  ],
  goals: [1, 5, 10, 25, 50, 100, 250, 500, 1_000, 5_000],
  category: "consumption",
  metric: "totalSlop",
  unit: "count",
});

const scoring = ladder({
  prefix: "score",
  titles: [
    "Number Go Up",
    "Engagement Bait",
    "KPI Piglet",
    "Dashboard Darling",
    "Venture-Backed Bacon",
    "Quarterly Slop Target",
    "Unicorn Hog",
    "Market Capybara",
    "Too Big to Fail",
    "Post-Economic Pork",
  ],
  descriptions: [
    "Earn 100 lifetime points.",
    "Earn 500 lifetime points.",
    "Earn 1,000 lifetime points.",
    "Earn 2,500 lifetime points.",
    "Earn 5,000 lifetime points.",
    "Earn 10,000 lifetime points.",
    "Earn 25,000 lifetime points.",
    "Earn 50,000 lifetime points.",
    "Earn 100,000 lifetime points.",
    "Earn 500,000 lifetime points.",
  ],
  goals: [100, 500, 1_000, 2_500, 5_000, 10_000, 25_000, 50_000, 100_000, 500_000],
  category: "score",
  metric: "totalScore",
  unit: "points",
});

const movement = ladder({
  prefix: "roam",
  titles: [
    "Touch Grass",
    "Mud Puddle Commuter",
    "Pasture Pacemaker",
    "Free-Range Cursor",
    "Keyboard Nomad",
    "Farm Loop Optimizer",
    "Cross-Country Hog",
    "Orbital Wanderer",
    "Intercontinental Oink",
    "No Place Left to Scroll",
  ],
  descriptions: [
    "Move 100 pixels across the farm.",
    "Move 500 pixels across the farm.",
    "Move 1,000 pixels across the farm.",
    "Move 2,500 pixels across the farm.",
    "Move 5,000 pixels across the farm.",
    "Move 10,000 pixels across the farm.",
    "Move 25,000 pixels across the farm.",
    "Move 50,000 pixels across the farm.",
    "Move 100,000 pixels across the farm.",
    "Move 250,000 pixels across the farm.",
  ],
  goals: [100, 500, 1_000, 2_500, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000],
  category: "movement",
  metric: "totalDistance",
  unit: "distance",
});

const highPsychosisStreak = ladder({
  prefix: "redline",
  titles: [
    "Over the Line",
    "Keep It Together",
    "Wobble Walker",
    "Redline Roamer",
    "Psychosis Pacemaker",
    "No Brakes, Just Takes",
    "Critical Mass Cardio",
    "Delirium Marathon",
    "One Minute Meltdown",
    "Permanent Breaking News",
  ],
  descriptions: [
    "Keep moving above 50% psychosis for 1 continuous second.",
    "Keep moving above 50% psychosis for 3 continuous seconds.",
    "Keep moving above 50% psychosis for 5 continuous seconds.",
    "Keep moving above 50% psychosis for 10 continuous seconds.",
    "Keep moving above 50% psychosis for 15 continuous seconds.",
    "Keep moving above 50% psychosis for 20 continuous seconds.",
    "Keep moving above 50% psychosis for 30 continuous seconds.",
    "Keep moving above 50% psychosis for 45 continuous seconds.",
    "Keep moving above 50% psychosis for 60 continuous seconds.",
    "Keep moving above 50% psychosis for 120 continuous seconds.",
  ],
  goals: [1_000, 3_000, 5_000, 10_000, 15_000, 20_000, 30_000, 45_000, 60_000, 120_000],
  category: "psychosis",
  metric: "bestHighPsychosisMs",
  unit: "duration",
});

const highPsychosisDistance = ladder({
  prefix: "danger-mile",
  titles: [
    "Danger Shuffle",
    "Fever Lap",
    "Glazed Gallop",
    "Hallucination Highway",
    "Red-Mist Road Trip",
    "Delusion Distance",
    "Psychotic Circumnavigation",
    "Beyond the Context Window",
  ],
  descriptions: [
    "Move 100 pixels while above 50% psychosis.",
    "Move 250 pixels while above 50% psychosis.",
    "Move 500 pixels while above 50% psychosis.",
    "Move 1,000 pixels while above 50% psychosis.",
    "Move 2,500 pixels while above 50% psychosis.",
    "Move 5,000 pixels while above 50% psychosis.",
    "Move 10,000 pixels while above 50% psychosis.",
    "Move 25,000 pixels while above 50% psychosis.",
  ],
  goals: [100, 250, 500, 1_000, 2_500, 5_000, 10_000, 25_000],
  category: "psychosis",
  metric: "highPsychosisDistance",
  unit: "distance",
});

const popping = ladder({
  prefix: "pop",
  titles: [
    "Terms and Conditions Apply",
    "Repeat Offender",
    "Serial Popper",
    "Planned Obsolescence",
    "Failure as a Service",
    "Pop Culture",
    "Century of Collapse",
    "The Boom Economy",
  ],
  descriptions: [
    "Pop one hog from AI psychosis.",
    "Pop 2 hogs from AI psychosis.",
    "Pop 5 hogs from AI psychosis.",
    "Pop 10 hogs from AI psychosis.",
    "Pop 25 hogs from AI psychosis.",
    "Pop 50 hogs from AI psychosis.",
    "Pop 100 hogs from AI psychosis.",
    "Pop 250 hogs from AI psychosis.",
  ],
  goals: [1, 2, 5, 10, 25, 50, 100, 250],
  category: "survival",
  metric: "pops",
  unit: "count",
});

const redeployments = ladder({
  prefix: "run",
  titles: [
    "Have You Tried Rebooting?",
    "Five-Nines Downtime",
    "Iterate and Perish",
    "Agile Mortality",
    "Ship One Hundred Hogs",
  ],
  descriptions: [
    "Deploy a second hog.",
    "Begin 5 hog runs.",
    "Begin 10 hog runs.",
    "Begin 25 hog runs.",
    "Begin 100 hog runs.",
  ],
  goals: [2, 5, 10, 25, 100],
  category: "survival",
  metric: "runs",
  unit: "count",
});

const knockouts = ladder({
  prefix: "knockout",
  titles: [
    "First Bonk",
    "Ham-to-Ham Combat",
    "Pork Barrel Brawler",
    "Battle-Hardened Bacon",
    "Heavyweight Hog",
  ],
  descriptions: [
    "Knock out another hog.",
    "Knock out 5 hogs.",
    "Knock out 10 hogs.",
    "Knock out 25 hogs.",
    "Knock out 100 hogs.",
  ],
  goals: [1, 5, 10, 25, 100],
  category: "battle",
  metric: "knockouts",
  unit: "count",
});

const kindLadders: Record<SlopKind, {
  titles: readonly string[];
  finale: string;
}> = {
  hallucinated_citation: {
    titles: ["Citation Needed", "Source: Trust Me", "Peer Rejected", "Bibliography Goblin", "404 Scholar", "Tenured Hallucinator"],
    finale: "Consume 100 Hallucinated Citations and receive imaginary tenure.",
  },
  context_overflow: {
    titles: ["Token Taster", "Context Snacker", "Window Shopper", "32K Glutton", "Prompt Compactor", "Context Event Horizon"],
    finale: "Consume 100 Context Overflows and forget where the prompt began.",
  },
  recursive_prompt: {
    titles: ["Do It Again", "Loop Enjoyer", "Recursion Recursion", "Stack Grazer", "Infinite Oink", "Base Case Denier"],
    finale: "Consume 100 Recursive Prompts without finding a base case.",
  },
  model_collapse: {
    titles: ["Synthetic Crumb", "Feedback Feeder", "Derivative Diner", "Entropy Enthusiast", "Collapse Connoisseur", "Last Model Standing"],
    finale: "Consume 100 Model Collapses. Original data is now folklore.",
  },
  premium_tokens: {
    titles: ["Seed Round", "Token Angel", "Series A-Pork", "Runway Eater", "Unprofitable Unicorn", "Exit Liquidity Hog"],
    finale: "Consume 100 Premium Tokens and become the business model.",
  },
};

const specialists = SLOP_KINDS.flatMap(kind => {
  const definition = SLOP_CATALOG[kind];
  const goals = [1, 5, 10, 25, 50, 100] as const;
  return ladder({
    prefix: `specialist-${kind.replaceAll("_", "-")}`,
    titles: kindLadders[kind].titles,
    descriptions: goals.map((goal, index) => (
      index === goals.length - 1
        ? kindLadders[kind].finale
        : `Consume ${goal} ${definition.label}${goal === 1 ? "" : "s"}.`
    )),
    goals,
    category: "specialist",
    metric: `kind:${kind}`,
    unit: "count",
  });
});

const runScore = ladder({
  prefix: "run-score",
  titles: ["Strong Quarter", "One-Hog Unicorn", "Perfectly Unsustainable"],
  descriptions: [
    "Earn 500 points in a single hog run.",
    "Earn 900 points in a single hog run.",
    "Earn 1,200 points in a single hog run.",
  ],
  goals: [500, 900, 1_200],
  category: "style",
  metric: "bestRunScore",
  unit: "points",
});

const runSlop = ladder({
  prefix: "run-slop",
  titles: ["Three-Course Slop", "Trough Tactician", "Maximum Viable Hog"],
  descriptions: [
    "Consume 3 pieces of slop in one hog run.",
    "Consume 6 pieces of slop in one hog run.",
    "Consume 9 pieces of slop in one hog run.",
  ],
  goals: [3, 6, 9],
  category: "style",
  metric: "bestRunSlop",
  unit: "count",
});

const monotony = ladder({
  prefix: "monotony",
  titles: ["Algorithm Trained", "Filter Bubble"],
  descriptions: [
    "Consume the same kind of slop 3 times in a row.",
    "Consume the same kind of slop 6 times in a row.",
  ],
  goals: [3, 6],
  category: "style",
  metric: "bestSameKindStreak",
  unit: "count",
});

export const ACHIEVEMENTS: readonly AchievementDefinition[] = [
  ...consumption,
  ...scoring,
  ...movement,
  ...highPsychosisStreak,
  ...highPsychosisDistance,
  ...popping,
  ...redeployments,
  ...knockouts,
  ...specialists,
  ...runScore,
  ...runSlop,
  ...monotony,
  {
    id: "style-balanced-diet",
    title: "Balanced Misinformation Diet",
    description: "Consume all 5 kinds of slop in a single hog run.",
    category: "style",
    tier: "gold",
    metric: "maxRunVariety",
    goal: 5,
    unit: "count",
  },
];

if (ACHIEVEMENTS.length !== 105) {
  throw new Error(`Expected 105 achievements, received ${ACHIEVEMENTS.length}`);
}

export const ACHIEVEMENT_BY_ID = new Map(ACHIEVEMENTS.map(achievement => [achievement.id, achievement]));

export function emptyAchievementProgress(): AchievementProgress {
  return {
    totalSlop: 0,
    totalScore: 0,
    totalDistance: 0,
    highPsychosisDistance: 0,
    currentHighPsychosisMs: 0,
    bestHighPsychosisMs: 0,
    lastHighMoveAtMs: null,
    pops: 0,
    knockouts: 0,
    runs: 1,
    bestRunScore: 0,
    bestRunSlop: 0,
    currentRunDistance: 0,
    bestRunDistance: 0,
    kindCounts: Object.fromEntries(SLOP_KINDS.map(kind => [kind, 0])) as Record<SlopKind, number>,
    runKindMask: 0,
    maxRunVariety: 0,
    lastSlopKind: null,
    sameKindStreak: 0,
    bestSameKindStreak: 0,
  };
}

function countKinds(mask: number): number {
  let count = 0;
  for (let value = mask; value; value >>>= 1) count += value & 1;
  return count;
}

export function advanceAchievementProgress(
  current: AchievementProgress,
  input: AchievementAdvance,
): AchievementProgress {
  if (input.restarted) {
    return {
      ...current,
      currentHighPsychosisMs: 0,
      lastHighMoveAtMs: null,
      runs: current.runs + 1,
      knockouts: current.knockouts + input.knockouts,
      currentRunDistance: 0,
      runKindMask: 0,
      lastSlopKind: null,
      sameKindStreak: 0,
    };
  }

  const progress: AchievementProgress = {
    ...current,
    kindCounts: { ...current.kindCounts },
    totalDistance: current.totalDistance + input.distance,
    currentRunDistance: current.currentRunDistance + input.distance,
    bestRunDistance: Math.max(current.bestRunDistance, current.currentRunDistance + input.distance),
  };
  if (input.movedAtHighPsychosis) {
    const continuous = current.lastHighMoveAtMs !== null
      && input.nowMs - current.lastHighMoveAtMs <= HIGH_PSYCHOSIS_GRACE_MS;
    progress.currentHighPsychosisMs = continuous
      ? current.currentHighPsychosisMs + input.movementElapsedMs
      : input.movementElapsedMs;
    progress.bestHighPsychosisMs = Math.max(
      current.bestHighPsychosisMs,
      progress.currentHighPsychosisMs,
    );
    progress.highPsychosisDistance += input.distance;
    progress.lastHighMoveAtMs = input.nowMs;
  } else {
    progress.currentHighPsychosisMs = 0;
    progress.lastHighMoveAtMs = null;
  }

  if (input.slopKind) {
    const kind = input.slopKind;
    progress.totalSlop += 1;
    progress.totalScore += input.pointsGained;
    progress.kindCounts[kind] += 1;
    progress.bestRunScore = Math.max(progress.bestRunScore, input.runScore);
    progress.bestRunSlop = Math.max(progress.bestRunSlop, input.runSlop);
    progress.runKindMask |= 1 << SLOP_KINDS.indexOf(kind);
    progress.maxRunVariety = Math.max(progress.maxRunVariety, countKinds(progress.runKindMask));
    progress.sameKindStreak = current.lastSlopKind === kind ? current.sameKindStreak + 1 : 1;
    progress.bestSameKindStreak = Math.max(current.bestSameKindStreak, progress.sameKindStreak);
    progress.lastSlopKind = kind;
  }
  if (input.popped) progress.pops += 1;
  progress.knockouts += input.knockouts;
  return progress;
}

export function achievementValue(
  achievement: AchievementDefinition,
  progress: AchievementProgress,
): number {
  if (isKindMetric(achievement.metric)) {
    return progress.kindCounts[achievement.metric.slice(5) as SlopKind];
  }
  return progress[achievement.metric];
}

function isKindMetric(metric: AchievementMetric): metric is `kind:${SlopKind}` {
  return metric.startsWith("kind:");
}

export function eligibleAchievements(progress: AchievementProgress): AchievementDefinition[] {
  return ACHIEVEMENTS.filter(achievement => achievementValue(achievement, progress) >= achievement.goal);
}

export function newlyEligibleAchievements(
  previous: AchievementProgress,
  next: AchievementProgress,
): AchievementDefinition[] {
  return ACHIEVEMENTS.filter(achievement => (
    achievementValue(achievement, previous) < achievement.goal
    && achievementValue(achievement, next) >= achievement.goal
  ));
}

export function formatAchievementProgress(
  value: number,
  achievement: AchievementDefinition,
): string {
  const bounded = Math.min(value, achievement.goal);
  if (achievement.unit === "duration") {
    return `${Math.floor(bounded / 1_000)}s / ${Math.floor(achievement.goal / 1_000)}s`;
  }
  if (achievement.unit === "distance") {
    return `${Math.floor(bounded).toLocaleString()}px / ${achievement.goal.toLocaleString()}px`;
  }
  return `${Math.floor(bounded).toLocaleString()} / ${achievement.goal.toLocaleString()}${achievement.unit === "points" ? " pts" : ""}`;
}

export function achievementShareUrl(achievement: AchievementDefinition, playerName: string): string {
  const text = [
    `[SLOP HOG ACHIEVEMENT: ${achievement.title.toUpperCase()}]`,
    `${playerName} earned a ${achievement.tier.toUpperCase()} badge in Slop Hogs.`,
    achievement.description,
    "#SlopHogs",
  ].join("\n\n");
  return `https://bsky.app/intent/compose?text=${encodeURIComponent(text)}`;
}
