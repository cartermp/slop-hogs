import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseCostPolicy } from "../cost-policy.ts";

export function loadCostPolicy() {
  // A missing, unreadable, or malformed policy must stop startup. No fallback.
  const path = resolve(process.cwd(), "config/cost-policy.json");
  return parseCostPolicy(JSON.parse(readFileSync(path, "utf8")));
}
