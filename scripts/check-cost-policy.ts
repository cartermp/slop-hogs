import { loadCostPolicy } from "../src/lib/server/cost-policy.ts";

try {
  loadCostPolicy();
  console.log("Cost policy valid. Railway dashboard limits must be configured separately.");
} catch {
  console.error("Invalid or missing cost policy. See docs/cost-controls.md. Startup refused.");
  process.exitCode = 1;
}
