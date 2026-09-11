export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { loadCostPolicy } = await import("./lib/server/cost-policy.ts");
    const { logOperationalEvent } = await import("./lib/server/logging.ts");
    try {
      loadCostPolicy();
    } catch (error) {
      // Next can retain a listening process after a thrown instrumentation error.
      // An invalid policy must terminate it rather than keep consuming compute.
      logOperationalEvent("service.startup", "failure", {
        startup_stage: "cost_policy_validation",
      }, error);
      process.exit(1);
    }
  }
}
