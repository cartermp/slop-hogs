import { parseBlueskyHandleQuery } from "@/lib/bluesky-handles";
import { ActorSearchRateLimitError, reserveActorSearch, searchBlueskyActors } from "@/lib/server/actors";
import { loadCostPolicy } from "@/lib/server/cost-policy";
import { getDatabase } from "@/lib/server/database";
import { requestSource } from "@/lib/server/hourly-rate-limit";
import { httpRequestFields, startServerActivity } from "@/lib/server/logging";
import { loadTrustedProxyCount } from "@/lib/server/proxy-config";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const event = startServerActivity(
    "actor.search",
    httpRequestFields(request, "/api/actors/search"),
  );
  const url = new URL(request.url);
  const query = url.searchParams.get("q") ?? "";
  if (query.length > 253) {
    event.emit("rejected", { http_status: 400, query_length: query.length });
    return Response.json({ error: "Search query is too long" }, { status: 400 });
  }
  if (!parseBlueskyHandleQuery(query)) {
    event.emit("success", {
      http_status: 200,
      query_length: query.length,
      search_performed: false,
      result_count: 0,
    });
    return Response.json({ actors: [] });
  }
  try {
    const policy = loadCostPolicy();
    await reserveActorSearch(
      getDatabase(),
      requestSource(request, loadTrustedProxyCount()),
      policy.limits,
    );
    const actors = await searchBlueskyActors(query, policy.limits);
    event.emit("success", {
      http_status: 200,
      query_length: query.length,
      search_performed: true,
      result_count: actors.length,
    });
    return Response.json(
      { actors },
      { headers: { "Cache-Control": "private, max-age=30" } },
    );
  } catch (error) {
    if (error instanceof ActorSearchRateLimitError) {
      event.emit("rate_limited", { http_status: 429, query_length: query.length }, error);
      return Response.json({ error: "Too many searches" }, { status: 429 });
    }
    event.emit("failure", { http_status: 502, query_length: query.length }, error);
    return Response.json({ error: "Suggestions are temporarily unavailable" }, { status: 502 });
  }
}
