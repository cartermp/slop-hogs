import { NextRequest, NextResponse } from "next/server";
import { getDatabase } from "@/lib/server/database";
import { revokeSession } from "@/lib/server/hogs";
import { loadOAuthConfig } from "@/lib/server/oauth-config";
import { deleteOAuthSession, getOAuthClient } from "@/lib/server/oauth";
import { httpRequestFields, startServerActivity } from "@/lib/server/logging";

export const runtime = "nodejs";

const cookieName = "slop_hogs_session";

export async function POST(request: NextRequest) {
  const event = startServerActivity(
    "auth.logout",
    httpRequestFields(request, "/oauth/logout"),
  );
  try {
    const config = loadOAuthConfig();
    if (request.headers.get("origin") !== config.origin) {
      event.emit("denied", { http_status: 403, rejection_reason: "origin_mismatch" });
      return new Response("Forbidden", { status: 403 });
    }
    const token = request.cookies.get(cookieName)?.value;
    const revokedSession = token ? await revokeSession(getDatabase(), token) : null;
    event.add({
      actor_did: revokedSession?.ownerDid,
      auth_provider: revokedSession?.authProvider,
      local_session_found: revokedSession !== null,
    });
    let providerError = false;
    let providerFailure: unknown;
    if (revokedSession?.authProvider === "bluesky") {
      try {
        await (await getOAuthClient()).revoke(revokedSession.ownerDid);
      } catch (error) {
        providerError = true;
        providerFailure = error;
        await deleteOAuthSession(revokedSession.ownerDid);
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
    event.emit(providerError ? "failure" : "success", {
      http_status: 303,
      local_session_revoked: revokedSession !== null,
      provider_revoke_outcome: revokedSession?.authProvider === "bluesky"
        ? (providerError ? "failure" : "success")
        : "not_needed",
    }, providerFailure);
    return response;
  } catch (error) {
    event.emit("failure", { http_status: 500 }, error);
    throw error;
  }
}
