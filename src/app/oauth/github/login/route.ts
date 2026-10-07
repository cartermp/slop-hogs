import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { createGitHubAuthorizationUrl, loadGitHubOAuthConfig } from "@/lib/server/github-oauth";
import { httpRequestFields, startServerActivity } from "@/lib/server/logging";

export const runtime = "nodejs";

const stateCookieName = "slop_hogs_github_state";

export async function POST(request: Request) {
  const event = startServerActivity(
    "auth.github.login.start",
    httpRequestFields(request, "/oauth/github/login"),
  );
  let origin: string | undefined;
  const errorResponse = (code: string, message: string, status: number): Response => {
    if (origin && request.headers.get("accept")?.includes("text/html")) {
      return Response.redirect(new URL(`/?auth_error=${code}`, origin), 303);
    }
    return new Response(message, { status });
  };
  try {
    const config = loadGitHubOAuthConfig();
    origin = config.origin;
    if (request.headers.get("origin") !== config.origin) {
      event.emit("denied", { http_status: 403, rejection_reason: "origin_mismatch" });
      return new Response("Forbidden", { status: 403 });
    }
    const state = randomBytes(32).toString("base64url");
    const authorizationUrl = createGitHubAuthorizationUrl(config, state);
    const response = NextResponse.redirect(authorizationUrl, 303);
    response.cookies.set(stateCookieName, state, {
      httpOnly: true,
      secure: config.origin.startsWith("https://"),
      sameSite: "lax",
      path: "/oauth/github/callback",
      maxAge: 60 * 10,
      priority: "high",
    });
    event.emit("success", { http_status: 303, authorization_host: authorizationUrl.hostname });
    return response;
  } catch (error) {
    event.emit("failure", { http_status: 503 }, error);
    return errorResponse("github_login_unavailable", "GitHub login is unavailable", 503);
  }
}
