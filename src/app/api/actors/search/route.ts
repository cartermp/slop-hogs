import { parseBlueskyHandleQuery } from "@/lib/bluesky-handles";
import { ActorSearchRateLimitError, reserveActorSearch, searchBlueskyActors } from "@/lib/server/actors";
import { loadCostPolicy } from "@/lib/server/cost-policy";
import { getDatabase } from "@/lib/server/database";
import { requestSource } from "@/lib/server/hourly-rate-limit";
import { loadOAuthConfig } from "@/lib/server/oauth-config";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q") ?? "";
  if (query.length > 253) {
    return Response.json({ error: "Search query is too long" }, { status: 400 });
  }
  if (!parseBlueskyHandleQuery(query)) return Response.json({ actors: [] });
  try {
    const policy = loadCostPolicy();
    const config = loadOAuthConfig();
    await reserveActorSearch(getDatabase(), requestSource(request, config.trustedProxyCount), policy.limits);
    const actors = await searchBlueskyActors(query, policy.limits);
    return Response.json(
      { actors },
      { headers: { "Cache-Control": "private, max-age=30" } },
    );
  } catch (error) {
    if (error instanceof ActorSearchRateLimitError) {
      return Response.json({ error: "Too many searches" }, { status: 429 });
    }
    const message = error instanceof Error ? error.message : "Unknown actor search failure";
    console.error(`Bluesky actor search failed: ${message}`);
    return Response.json({ error: "Suggestions are temporarily unavailable" }, { status: 502 });
  }
}
