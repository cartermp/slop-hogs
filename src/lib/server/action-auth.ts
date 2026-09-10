import { cookies, headers } from "next/headers";
import { parseAppOrigin } from "./oauth-config.ts";

const cookieName = "slop_hogs_session";

export async function requireSameOriginToken(): Promise<string> {
  const requestOrigin = (await headers()).get("origin");
  if (requestOrigin !== parseAppOrigin(process.env.APP_ORIGIN)) throw new Error("Forbidden");
  const token = (await cookies()).get(cookieName)?.value;
  if (!token) throw new Error("Unauthorized");
  return token;
}
