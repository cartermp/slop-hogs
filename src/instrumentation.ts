export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { loadCostPolicy } = await import("./lib/server/cost-policy.ts");
    try {
      loadCostPolicy();
    } catch {
      // Next can retain a listening process after a thrown instrumentation error.
      // An invalid policy must terminate it rather than keep consuming compute.
      console.error("Invalid cost policy. Refusing startup.");
      process.exit(1);
    }
  }
}
