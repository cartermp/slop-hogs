import { cookies } from "next/headers";
import { parseFarmAction } from "@/lib/farm-game";
import { requireSameOriginToken } from "@/lib/server/action-auth";
import { resolveBlueskyHandle } from "@/lib/server/actors";
import { loadCostPolicy } from "@/lib/server/cost-policy";
import { getDatabase } from "@/lib/server/database";
import { actOnFarm, syncFarm } from "@/lib/server/farm";
import { getAccountSession, setAccountHandle } from "@/lib/server/hogs";
import { requestSource } from "@/lib/server/hourly-rate-limit";
import { logOperationalEvent } from "@/lib/server/logging";
import { ReadOnlyError } from "@/lib/server/operations";
import { loadTrustedProxyCount } from "@/lib/server/proxy-config";
import {
  rateLimitKey,
  readBoundedJson,
  RequestBodyTooLargeError,
  TokenBucketRateLimiter,
} from "@/lib/server/request-limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const cookieName = "slop_hogs_session";
const sessionToken = /^[0-9a-f]{64}$/;
const farmActionMaxBytes = 1_024;
const sourceAdmissionLimiter = new TokenBucketRateLimiter();
const globalAdmissionLimiter = new TokenBucketRateLimiter(1);
const accountSyncLimiter = new TokenBucketRateLimiter();
const accountActionLimiter = new TokenBucketRateLimiter();

function rateLimitedResponse() {
  return Response.json(
    { error: "Too many farm requests. Try again in a moment." },
    {
      status: 429,
      headers: { "Cache-Control": "private, no-store", "Retry-After": "1" },
    },
  );
}

function reserveAdmission(request: Request, policy: ReturnType<typeof loadCostPolicy>): boolean {
  const source = requestSource(request, loadTrustedProxyCount());
  const sourceAllowed = sourceAdmissionLimiter.reserve(
    rateLimitKey("farm", source),
    {
      refillPerMinute: policy.limits.farmRequestsPerIpPerMinute,
      burst: policy.limits.farmRequestBurstPerIp,
    },
  );
  if (!sourceAllowed) return false;
  return globalAdmissionLimiter.reserve("farm", {
    refillPerMinute: policy.limits.farmRequestsGlobalPerMinute,
    burst: policy.limits.farmRequestGlobalBurst,
  });
}

export async function GET(request: Request) {
  const token = (await cookies()).get(cookieName)?.value;
  if (!token || !sessionToken.test(token)) {
    return Response.json({ error: "Sign in to enter the farm" }, { status: 401 });
  }
  try {
    const policy = loadCostPolicy();
    if (!reserveAdmission(request, policy)) return rateLimitedResponse();
    const limits = {
      refillPerMinute: policy.limits.farmSyncsPerAccountPerMinute,
      burst: policy.limits.farmSyncBurstPerAccount,
    };
    const session = await getAccountSession(getDatabase(), token);
    if (!session) {
      return Response.json({ error: "Sign in to enter the farm" }, { status: 401 });
    }
    if (!accountSyncLimiter.reserve(session.ownerDid, limits)) return rateLimitedResponse();
    if (!session.handle && session.authProvider === "bluesky") {
      const handle = await resolveBlueskyHandle(session.ownerDid, policy.limits);
      await setAccountHandle(getDatabase(), session.ownerDid, handle);
    }
    const snapshot = await syncFarm(getDatabase(), session.ownerDid);
    return Response.json(
      { snapshot, events: [] },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof ReadOnlyError) {
      return Response.json({ error: "The farm is temporarily read-only" }, { status: 503 });
    }
    logOperationalEvent("farm.sync", "failure", {}, error);
    return Response.json({ error: "The farm is temporarily unavailable" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const declaredLength = request.headers.get("content-length");
    if (
      declaredLength !== null
      && (
        !Number.isSafeInteger(Number(declaredLength))
        || Number(declaredLength) < 0
        || Number(declaredLength) > farmActionMaxBytes
      )
    ) {
      return Response.json({ error: "Farm action is too large" }, { status: 413 });
    }
    const token = await requireSameOriginToken();
    if (!sessionToken.test(token)) throw new Error("Unauthorized");
    const policy = loadCostPolicy();
    if (!reserveAdmission(request, policy)) return rateLimitedResponse();
    const limits = {
      refillPerMinute: policy.limits.farmActionsPerAccountPerMinute,
      burst: policy.limits.farmActionBurstPerAccount,
    };
    const session = await getAccountSession(getDatabase(), token);
    if (!session) throw new Error("Unauthorized");
    if (!accountActionLimiter.reserve(session.ownerDid, limits)) return rateLimitedResponse();
    const action = parseFarmAction(await readBoundedJson(request, farmActionMaxBytes));
    const result = await actOnFarm(getDatabase(), session.ownerDid, action);
    if (result.events.length) {
      logOperationalEvent("farm.game_event", "success", {
        action_type: action.type,
        event_types: result.events.map(item => item.type),
      });
    }
    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const status = error instanceof RequestBodyTooLargeError ? 413
      : message === "Unauthorized" ? 401
      : message === "Forbidden" ? 403
        : error instanceof ReadOnlyError ? 503
        : error instanceof SyntaxError
          || message === "Only a stopped hog can redeploy"
          || message === "Only living hogs can battle"
          || message === "That opponent is no longer in the battle"
          || message === "That opponent is out of range"
          || message === "Attack is cooling down"
          || message === "Invalid farm action" ? 400
          : 500;
    if (status >= 500) logOperationalEvent("farm.action", "failure", {}, error);
    return Response.json(
      {
        error: status === 500 ? "The farm action failed"
          : status === 413 ? "Farm action is too large"
          : status === 400 && (error instanceof SyntaxError || message === "Invalid farm action")
            ? "Invalid farm action"
            : status === 503 ? "The farm is temporarily read-only"
              : message,
      },
      { status },
    );
  }
}
