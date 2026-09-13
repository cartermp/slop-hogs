import { cookies } from "next/headers";
import { parseSinglePlayerAction } from "@/lib/single-player";
import { requireSameOriginToken } from "@/lib/server/action-auth";
import { resolveBlueskyHandle } from "@/lib/server/actors";
import { loadCostPolicy } from "@/lib/server/cost-policy";
import { getDatabase } from "@/lib/server/database";
import { reserveFarmAction, reserveFarmAdmission, reserveFarmSync } from "@/lib/server/farm-rate-limits";
import { getAccountSession, setAccountHandle } from "@/lib/server/hogs";
import { logOperationalEvent } from "@/lib/server/logging";
import { ReadOnlyError } from "@/lib/server/operations";
import {
  readBoundedJson,
  RequestBodyTooLargeError,
} from "@/lib/server/request-limits";
import { actOnSinglePlayer, syncSinglePlayer } from "@/lib/server/single-player";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const cookieName = "slop_hogs_session";
const sessionToken = /^[0-9a-f]{64}$/;
const actionMaxBytes = 1_024;

function rateLimitedResponse() {
  return Response.json(
    { error: "Too many solo arena requests. Try again in a moment." },
    {
      status: 429,
      headers: { "Cache-Control": "private, no-store", "Retry-After": "1" },
    },
  );
}

export async function GET(request: Request) {
  const token = (await cookies()).get(cookieName)?.value;
  if (!token || !sessionToken.test(token)) {
    return Response.json({ error: "Sign in to enter the solo arena" }, { status: 401 });
  }
  try {
    const policy = loadCostPolicy();
    if (!reserveFarmAdmission(request, policy)) return rateLimitedResponse();
    const session = await getAccountSession(getDatabase(), token);
    if (!session) {
      return Response.json({ error: "Sign in to enter the solo arena" }, { status: 401 });
    }
    if (!reserveFarmSync(session.ownerDid, policy)) return rateLimitedResponse();
    if (!session.handle && session.authProvider === "bluesky") {
      const handle = await resolveBlueskyHandle(session.ownerDid, policy.limits);
      await setAccountHandle(getDatabase(), session.ownerDid, handle);
    }
    const result = await syncSinglePlayer(getDatabase(), session.ownerDid);
    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "Start a single-player game") {
      return Response.json({ error: message }, { status: 404 });
    }
    if (error instanceof ReadOnlyError) {
      return Response.json({ error: "The farm is temporarily read-only" }, { status: 503 });
    }
    logOperationalEvent("single_player.sync", "failure", {}, error);
    return Response.json({ error: "The solo arena is temporarily unavailable" }, { status: 500 });
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
        || Number(declaredLength) > actionMaxBytes
      )
    ) {
      return Response.json({ error: "Solo arena action is too large" }, { status: 413 });
    }
    const token = await requireSameOriginToken();
    if (!sessionToken.test(token)) throw new Error("Unauthorized");
    const policy = loadCostPolicy();
    if (!reserveFarmAdmission(request, policy)) return rateLimitedResponse();
    const session = await getAccountSession(getDatabase(), token);
    if (!session) throw new Error("Unauthorized");
    if (!reserveFarmAction(session.ownerDid, policy)) return rateLimitedResponse();
    const action = parseSinglePlayerAction(await readBoundedJson(request, actionMaxBytes));
    if (!session.handle && session.authProvider === "bluesky") {
      const handle = await resolveBlueskyHandle(session.ownerDid, policy.limits);
      await setAccountHandle(getDatabase(), session.ownerDid, handle);
    }
    const result = await actOnSinglePlayer(getDatabase(), session.ownerDid, action);
    if (result.events.length) {
      logOperationalEvent("single_player.game_event", "success", {
        action_type: action.type,
        difficulty: result.snapshot.singlePlayer.difficulty,
        event_types: result.events.map(event => event.type),
      });
    }
    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const badAction = error instanceof SyntaxError || message === "Invalid single-player action";
    const status = error instanceof RequestBodyTooLargeError ? 413
      : message === "Unauthorized" ? 401
      : message === "Forbidden" ? 403
        : message === "Resume or finish the current run first" ? 409
        : error instanceof ReadOnlyError ? 503
        : badAction
          || message === "Attack is cooling down"
          || message === "That opponent is no longer in the battle"
          || message === "That opponent is out of range"
          || message === "Finish the current run first"
          || message === "Start a single-player game" ? 400
          : 500;
    if (status >= 500) logOperationalEvent("single_player.action", "failure", {}, error);
    return Response.json(
      {
        error: status === 500 ? "The solo arena action failed"
          : status === 413 ? "Solo arena action is too large"
          : badAction ? "Invalid single-player action"
          : status === 503 ? "The farm is temporarily read-only"
          : message,
      },
      { status },
    );
  }
}
