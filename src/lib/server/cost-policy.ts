import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseCostPolicy, type CostPolicy } from "../cost-policy.ts";

let cachedPolicy: CostPolicy | undefined;

export function loadCostPolicy(): CostPolicy {
  if (cachedPolicy) return cachedPolicy;
  // A missing, unreadable, or malformed policy must stop startup. No fallback.
  const path = resolve(process.cwd(), "config/cost-policy.json");
  cachedPolicy = parseCostPolicy(JSON.parse(readFileSync(path, "utf8")));
  return cachedPolicy;
}
