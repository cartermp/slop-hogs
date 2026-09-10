import { getDatabase } from "@/lib/server/database";
import { loadCostPolicy } from "@/lib/server/cost-policy";
import { loadOAuthConfig } from "@/lib/server/oauth-config";
import { getOAuthClient, LoginRateLimitError, loginSource, reserveLoginAttempt } from "@/lib/server/oauth";
import { parseBlueskyHandle } from "@/lib/bluesky-handles";

export const runtime = "nodejs";

class LoginRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function readLoginInput(text: string): string {
  if (text.length > 1_024) throw new LoginRequestError("Login request is too large", 413);
  const handle = parseBlueskyHandle(new URLSearchParams(text).get("handle") ?? "");
  if (!handle) {
    throw new LoginRequestError("Enter a valid Bluesky handle", 400);
  }
  return handle;
}

export async function POST(request: Request) {
  let origin: string | undefined;
  const errorResponse = (code: string, message: string, status: number): Response => {
    if (origin && request.headers.get("accept")?.includes("text/html")) {
      return Response.redirect(new URL(`/?auth_error=${code}`, origin), 303);
    }
    return new Response(message, { status });
  };
  try {
    const config = loadOAuthConfig();
    origin = config.origin;
    if (request.headers.get("origin") !== config.origin) return new Response("Forbidden", { status: 403 });
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/x-www-form-urlencoded")) {
      return new Response("Unsupported content type", { status: 415 });
    }
    const declaredSize = Number(request.headers.get("content-length") ?? "0");
    if (!Number.isFinite(declaredSize) || declaredSize > 1_024) {
      return new Response("Login request is too large", { status: 413 });
    }
    const handle = readLoginInput(await request.text());
    const policy = loadCostPolicy();
    await reserveLoginAttempt(getDatabase(), loginSource(request, config.trustedProxyCount), policy.limits);
    const client = await getOAuthClient();
    const authorizationUrl = await client.authorize(handle, { state: "/" });
    return Response.redirect(authorizationUrl, 303);
  } catch (error) {
    if (error instanceof LoginRateLimitError) {
      return errorResponse("login_rate_limited", "Too many login attempts", 429);
    }
    if (error instanceof LoginRequestError) {
      return errorResponse("invalid_handle", error.message, error.status);
    }
    const message = error instanceof Error ? error.message : "Unknown login failure";
    console.error(`OAuth login failed: ${message}`);
    return errorResponse("login_unavailable", "Login is unavailable", 503);
  }
}
