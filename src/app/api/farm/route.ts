import { cookies } from "next/headers";
import { parseFarmAction } from "@/lib/farm-game";
import { requireSameOriginSession } from "@/lib/server/action-auth";
import { getDatabase } from "@/lib/server/database";
import { actOnFarm, syncFarm } from "@/lib/server/farm";
import { getAccountSession } from "@/lib/server/hogs";
import { logOperationalEvent } from "@/lib/server/logging";
import { ReadOnlyError } from "@/lib/server/operations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const cookieName = "slop_hogs_session";

export async function GET() {
  const token = (await cookies()).get(cookieName)?.value;
  const session = token ? await getAccountSession(getDatabase(), token) : null;
  if (!session) {
    return Response.json({ error: "Sign in to enter the farm" }, { status: 401 });
  }
  try {
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
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(contentLength) || contentLength > 1_024) {
    return Response.json({ error: "Farm action is too large" }, { status: 413 });
  }
  try {
    const { session } = await requireSameOriginSession(getDatabase());
    const action = parseFarmAction(await request.json());
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
    const status = message === "Unauthorized" ? 401
      : message === "Forbidden" ? 403
        : error instanceof ReadOnlyError ? 503
        : error instanceof SyntaxError
          || message === "Only a popped hog can restart"
          || message === "Invalid farm action" ? 400
          : 500;
    if (status >= 500) logOperationalEvent("farm.action", "failure", {}, error);
    return Response.json(
      {
        error: status === 500 ? "The farm action failed"
          : status === 400 ? "Invalid farm action"
            : status === 503 ? "The farm is temporarily read-only"
              : message,
      },
      { status },
    );
  }
}
