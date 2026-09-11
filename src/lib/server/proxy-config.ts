export function loadTrustedProxyCount(env: NodeJS.ProcessEnv = process.env): number {
  const value = env.TRUSTED_PROXY_COUNT;
  if (value === undefined && env.NODE_ENV !== "production") return 0;
  if (!/^[0-5]$/.test(value ?? "")) {
    throw new Error("TRUSTED_PROXY_COUNT must be an integer from 0 to 5");
  }
  return Number(value);
}
