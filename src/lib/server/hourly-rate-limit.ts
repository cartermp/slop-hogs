import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { transaction } from "./database.ts";

export function requestSource(request: Request, trustedProxyCount: number): string {
  if (trustedProxyCount === 0) return "direct";
  const forwarded = request.headers.get("x-forwarded-for")?.split(",").map(value => value.trim()).filter(Boolean);
  if (!forwarded || forwarded.length < trustedProxyCount) throw new Error("Trusted proxy address is missing");
  return forwarded[forwarded.length - trustedProxyCount];
}

export async function reserveHourlyAttempt(
  pool: Pool,
  namespace: string,
  source: string,
  limits: { perSource: number; global: number },
): Promise<boolean> {
  const sourceHash = createHash("sha256").update(`${namespace}:${source}`).digest("hex");
  return transaction(pool, async client => {
    await client.query(
      `DELETE FROM oauth_login_attempts WHERE (bucket_start, source_hash) IN (
         SELECT bucket_start, source_hash FROM oauth_login_attempts
          WHERE bucket_start < date_trunc('hour', clock_timestamp()) - interval '24 hours'
          ORDER BY bucket_start
          LIMIT 100
       )`,
    );
    const increment = async (key: string, maximum: number): Promise<number> => {
      const result = await client.query<{ attempts: number }>(
        `INSERT INTO oauth_login_attempts(bucket_start, source_hash, attempts)
         VALUES (date_trunc('hour', clock_timestamp()),$1,1)
         ON CONFLICT (bucket_start, source_hash)
         DO UPDATE SET attempts=LEAST(oauth_login_attempts.attempts + 1,$2)
         RETURNING attempts`,
        [key, maximum + 1],
      );
      return result.rows[0].attempts;
    };
    const global = await increment(namespace === "login" ? "global" : `${namespace}:global`, limits.global);
    const perSource = await increment(sourceHash, limits.perSource);
    return global <= limits.global && perSource <= limits.perSource;
  });
}
