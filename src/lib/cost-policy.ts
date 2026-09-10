/** Feature enforcement ships with each feature before its flag can be enabled. */
const limitCeilings = {
  accounts: 50,
  loginAttemptsPerIpPerHour: 5,
  loginAttemptsGlobalPerHour: 200,
  postLookupsPerAccountPerDay: 12,
  postLookupsGlobalPerHour: 100,
  cardsPerAccountPerDay: 2,
  cardsGlobalPerDay: 50,
  cardMaxBytes: 250_000,
  cardStorageMaxBytes: 250_000_000,
  externalRequestTimeoutMs: 5_000,
  externalResponseMaxBytes: 1_000_000,
} as const;
const databaseCeilings = {
  maxBytes: 1_000_000_000,
  warningPercent: 70,
  restrictPercent: 85,
  readOnlyPercent: 95,
} as const;
const featureNames = [
  "registrations", "readOnlyMode", "externalPreviews", "cardRendering", "activityImports", "paidAi",
] as const;
const implementedFeatures = new Set<(typeof featureNames)[number]>(["registrations", "readOnlyMode", "externalPreviews"]);

type Limits = { [K in keyof typeof limitCeilings]: number };
type DatabasePolicy = { [K in keyof typeof databaseCeilings]: number };
type Features = { registrations: boolean; readOnlyMode: boolean; externalPreviews: boolean } & {
  [K in Exclude<typeof featureNames[number], "registrations" | "readOnlyMode" | "externalPreviews">]: false
};
export interface CostPolicy {
  version: 2;
  railway: { usageAlertCents: number; computeHardLimitCents: number };
  limits: Limits;
  database: DatabasePolicy;
  features: Features;
  paidAiMonthlyBudgetCents: 0;
}

function objectWithKeys(value: unknown, keys: readonly string[], path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  const object = value as Record<string, unknown>;
  if (Object.keys(object).length !== keys.length || keys.some(key => !Object.hasOwn(object, key))) {
    throw new Error(`${path} must contain exactly the documented keys`);
  }
  return object;
}

function positiveInteger(value: unknown, ceiling: number, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0 || value > ceiling) {
    throw new Error(`${path} must be a positive integer no greater than ${ceiling}`);
  }
  return value;
}

export function parseCostPolicy(input: unknown): CostPolicy {
  const root = objectWithKeys(input,
    ["version", "railway", "limits", "database", "features", "paidAiMonthlyBudgetCents"], "cost policy");
  if (root.version !== 2) throw new Error("Unsupported cost policy version");
  const provider = objectWithKeys(root.railway, ["usageAlertCents", "computeHardLimitCents"], "railway");
  const railway = {
    usageAlertCents: positiveInteger(provider.usageAlertCents, 1_500, "railway.usageAlertCents"),
    computeHardLimitCents: positiveInteger(provider.computeHardLimitCents, 3_000, "railway.computeHardLimitCents"),
  };
  if (railway.usageAlertCents >= railway.computeHardLimitCents) {
    throw new Error("Railway alert must be below the hard limit");
  }
  const rawLimits = objectWithKeys(root.limits, Object.keys(limitCeilings), "limits");
  const limits = Object.fromEntries(Object.entries(limitCeilings).map(([key, ceiling]) =>
    [key, positiveInteger(rawLimits[key], ceiling, `limits.${key}`)])) as Limits;
  if (limits.cardMaxBytes > limits.cardStorageMaxBytes) {
    throw new Error("One card must fit within the total card storage budget");
  }
  const rawDatabase = objectWithKeys(root.database, Object.keys(databaseCeilings), "database");
  const database = Object.fromEntries(Object.entries(databaseCeilings).map(([key, ceiling]) =>
    [key, positiveInteger(rawDatabase[key], ceiling, `database.${key}`)])) as DatabasePolicy;
  if (!(database.warningPercent < database.restrictPercent
    && database.restrictPercent < database.readOnlyPercent)) {
    throw new Error("Database thresholds must increase from warning to restriction to read-only");
  }
  const rawFeatures = objectWithKeys(root.features, featureNames, "features");
  for (const name of featureNames) {
    if (typeof rawFeatures[name] !== "boolean") {
      throw new Error(`features.${name} must be a boolean`);
    }
    if (!implementedFeatures.has(name) && rawFeatures[name] !== false) {
      throw new Error(`features.${name} must remain false until its enforcement is implemented`);
    }
  }
  if (root.paidAiMonthlyBudgetCents !== 0) throw new Error("Paid AI budget must be zero");
  return {
    version: 2, railway, limits, database,
    features: {
      registrations: rawFeatures.registrations as boolean,
      readOnlyMode: rawFeatures.readOnlyMode as boolean,
      externalPreviews: rawFeatures.externalPreviews as boolean,
      cardRendering: false,
      activityImports: false,
      paidAi: false,
    },
    paidAiMonthlyBudgetCents: 0,
  };
}
