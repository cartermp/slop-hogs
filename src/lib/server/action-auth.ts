import { cookies, headers } from "next/headers";
import type { Pool } from "pg";
import { getAccountSession, type AccountSession } from "./hogs.ts";
import { parseAppOrigin } from "./oauth-config.ts";

const cookieName = "slop_hogs_session";

export async function requireSameOriginToken(): Promise<string> {
  const requestOrigin = (await headers()).get("origin");
  if (requestOrigin !== parseAppOrigin(process.env.APP_ORIGIN)) throw new Error("Forbidden");
  const token = (await cookies()).get(cookieName)?.value;
  if (!token) throw new Error("Unauthorized");
  return token;
}

export async function requireSameOriginSession(
  pool: Pool,
): Promise<{ token: string; session: AccountSession }> {
  const token = await requireSameOriginToken();
  const session = await getAccountSession(pool, token);
  if (!session) throw new Error("Unauthorized");
  return { token, session };
}
