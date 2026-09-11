import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getDatabase } from "@/lib/server/database";
import { authenticateGitHubCode, loadGitHubOAuthConfig } from "@/lib/server/github-oauth";
import { completeGitHubSignIn } from "@/lib/server/hogs";
import { httpRequestFields, startServerActivity } from "@/lib/server/logging";

export const runtime = "nodejs";

const sessionCookieName = "slop_hogs_session";
const stateCookieName = "slop_hogs_github_state";

function stateMatches(received: string, expected: string | undefined): boolean {
  const statePattern = /^[A-Za-z0-9_-]{43}$/;
  if (!expected || !statePattern.test(received) || !statePattern.test(expected)) return false;
  return timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}

function redirect(origin: string, path: string): NextResponse {
  const response = NextResponse.redirect(new URL(path, origin), 303);
  response.cookies.set(stateCookieName, "", {
    httpOnly: true,
    secure: origin.startsWith("https://"),
    sameSite: "lax",
    path: "/oauth/github/callback",
    maxAge: 0,
  });
  return response;
}

export async function GET(request: NextRequest) {
  const event = startServerActivity(
    "auth.github.login.callback",
    httpRequestFields(request, "/oauth/github/callback"),
  );
  let config: ReturnType<typeof loadGitHubOAuthConfig>;
  try {
    config = loadGitHubOAuthConfig();
  } catch (error) {
    event.emit("failure", { http_status: 500, failure_stage: "configuration" }, error);
    throw error;
  }
  const requestUrl = new URL(request.url);
  if (requestUrl.search.length > 4_096) {
    event.emit("rejected", { http_status: 303, rejection_reason: "query_too_large" });
    return redirect(config.origin, "/?auth_error=github_invalid_callback");
  }
  const state = requestUrl.searchParams.get("state") ?? "";
  const code = requestUrl.searchParams.get("code") ?? "";
  if (!stateMatches(state, request.cookies.get(stateCookieName)?.value)) {
    event.emit("denied", { http_status: 303, rejection_reason: "state_mismatch" });
    return redirect(config.origin, "/?auth_error=github_invalid_callback");
  }
  if (requestUrl.searchParams.get("error") === "access_denied") {
    event.emit("rejected", { http_status: 303, rejection_reason: "provider_access_denied" });
    return redirect(config.origin, "/?auth_error=github_login_canceled");
  }
  try {
    const identity = await authenticateGitHubCode(config, code);
    const actorDid = `did:github:${identity.id}`;
    event.add({ actor_did: actorDid, actor_handle: identity.login, auth_provider: "github" });
    const appSession = await completeGitHubSignIn(getDatabase(), identity.id, identity.login);
    const response = redirect(config.origin, "/?signed_in=github");
    response.cookies.set(sessionCookieName, appSession.token, {
      httpOnly: true,
      secure: config.origin.startsWith("https://"),
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
      priority: "high",
    });
    event.emit("success", { http_status: 303, hog_id: appSession.hogId });
    return response;
  } catch (error) {
    event.emit("failure", { http_status: 303 }, error);
    return redirect(config.origin, "/?auth_error=github_invalid_callback");
  }
}
