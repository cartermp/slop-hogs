import { NextRequest, NextResponse } from "next/server";
import { getDatabase } from "@/lib/server/database";
import { revokeSession } from "@/lib/server/hogs";
import { loadOAuthConfig } from "@/lib/server/oauth-config";
import { deleteOAuthSession, getOAuthClient } from "@/lib/server/oauth";

export const runtime = "nodejs";

const cookieName = "slop_hogs_session";

export async function POST(request: NextRequest) {
  const config = loadOAuthConfig();
  if (request.headers.get("origin") !== config.origin) return new Response("Forbidden", { status: 403 });
  const token = request.cookies.get(cookieName)?.value;
  const ownerDid = token ? await revokeSession(getDatabase(), token) : null;
  let providerError = false;
  if (ownerDid) {
    try {
      await (await getOAuthClient()).revoke(ownerDid);
    } catch (error) {
      providerError = true;
      const message = error instanceof Error ? error.message : "Unknown provider logout failure";
      console.error(`Provider logout failed: ${message}`);
      await deleteOAuthSession(ownerDid);
    }
  }
  const response = NextResponse.redirect(
    new URL(providerError ? "/?auth_error=provider_logout" : "/?signed_out=1", config.origin),
    303,
  );
  response.cookies.set(cookieName, "", {
    httpOnly: true,
    secure: config.origin.startsWith("https://"),
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
