import { NextResponse } from "next/server";
import { resolveBlueskyHandle } from "@/lib/server/actors";
import { loadCostPolicy } from "@/lib/server/cost-policy";
import { getDatabase } from "@/lib/server/database";
import { completeOAuthSignIn } from "@/lib/server/hogs";
import { loadOAuthConfig } from "@/lib/server/oauth-config";
import { getOAuthClient } from "@/lib/server/oauth";
import { httpRequestFields, startServerActivity } from "@/lib/server/logging";

export const runtime = "nodejs";

const cookieName = "slop_hogs_session";

function errorRedirect(origin: string, code: string): NextResponse {
  return NextResponse.redirect(new URL(`/?auth_error=${code}`, origin), 303);
}

export async function GET(request: Request) {
  const event = startServerActivity(
    "auth.login.callback",
    httpRequestFields(request, "/oauth/callback"),
  );
  let config: ReturnType<typeof loadOAuthConfig>;
  try {
    config = loadOAuthConfig();
  } catch (error) {
    event.emit("failure", { http_status: 500, failure_stage: "configuration" }, error);
    throw error;
  }
  const requestUrl = new URL(request.url);
  if (requestUrl.search.length > 4_096) {
    event.emit("rejected", { http_status: 303, rejection_reason: "query_too_large" });
    return errorRedirect(config.origin, "invalid_callback");
  }
  let oauthSession: Awaited<ReturnType<Awaited<ReturnType<typeof getOAuthClient>>["callback"]>>["session"] | undefined;
  try {
    const client = await getOAuthClient();
    ({ session: oauthSession } = await client.callback(requestUrl.searchParams));
    event.add({ actor_did: oauthSession.did });
    const handle = await resolveBlueskyHandle(oauthSession.did, loadCostPolicy().limits);
    const appSession = await completeOAuthSignIn(getDatabase(), oauthSession.did, handle);
    const response = NextResponse.redirect(new URL("/?signed_in=1", config.origin), 303);
    response.cookies.set(cookieName, appSession.token, {
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
    let cleanupError: unknown;
    if (oauthSession) {
      try {
        await oauthSession.signOut();
      } catch (signOutError) {
        cleanupError = signOutError;
      }
    }
    const cleanupFields = cleanupError instanceof Error
      ? { provider_cleanup_outcome: "failure", provider_cleanup_error: cleanupError.message }
      : { provider_cleanup_outcome: oauthSession ? "success" : "not_needed" };
    event.emit("failure", { http_status: 303, ...cleanupFields }, error);
    return errorRedirect(config.origin, "invalid_callback");
  }
}
