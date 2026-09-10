import { NextResponse } from "next/server";
import { getDatabase } from "@/lib/server/database";
import { loadCostPolicy } from "@/lib/server/cost-policy";
import { AccountLimitError, completeOAuthSignIn, NotInvitedError, RegistrationClosedError } from "@/lib/server/hogs";
import { loadOAuthConfig, parseInvitedDids } from "@/lib/server/oauth-config";
import { getOAuthClient } from "@/lib/server/oauth";

export const runtime = "nodejs";

const cookieName = "slop_hogs_session";

function errorRedirect(origin: string, code: string): NextResponse {
  return NextResponse.redirect(new URL(`/?auth_error=${code}`, origin), 303);
}

export async function GET(request: Request) {
  const config = loadOAuthConfig();
  const requestUrl = new URL(request.url);
  if (requestUrl.search.length > 4_096) return errorRedirect(config.origin, "invalid_callback");
  let oauthSession: Awaited<ReturnType<Awaited<ReturnType<typeof getOAuthClient>>["callback"]>>["session"] | undefined;
  try {
    const client = await getOAuthClient();
    ({ session: oauthSession } = await client.callback(requestUrl.searchParams));
    const policy = loadCostPolicy();
    const appSession = await completeOAuthSignIn(getDatabase(), oauthSession.did, {
      registrationsEnabled: policy.features.registrations,
      accountLimit: policy.limits.accounts,
      invitedDids: parseInvitedDids(process.env.BLUESKY_INVITED_DIDS),
      operationalPolicy: {
        database: policy.database,
        readOnlyMode: policy.features.readOnlyMode,
      },
    });
    const response = NextResponse.redirect(new URL("/?signed_in=1", config.origin), 303);
    response.cookies.set(cookieName, appSession.token, {
      httpOnly: true,
      secure: config.origin.startsWith("https://"),
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
      priority: "high",
    });
    return response;
  } catch (error) {
    if (oauthSession) {
      try {
        await oauthSession.signOut();
      } catch (signOutError) {
        const message = signOutError instanceof Error ? signOutError.message : "Unknown provider logout failure";
        console.error(`OAuth cleanup failed: ${message}`);
      }
    }
    if (error instanceof NotInvitedError) return errorRedirect(config.origin, "not_invited");
    if (error instanceof RegistrationClosedError) return errorRedirect(config.origin, "registration_closed");
    if (error instanceof AccountLimitError) return errorRedirect(config.origin, "account_limit");
    const message = error instanceof Error ? error.message : "Unknown callback failure";
    console.error(`OAuth callback failed: ${message}`);
    return errorRedirect(config.origin, "invalid_callback");
  }
}
