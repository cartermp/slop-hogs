import { getOAuthClient } from "@/lib/server/oauth";

export const runtime = "nodejs";

export async function GET() {
  const client = await getOAuthClient();
  return Response.json(client.jwks, { headers: { "Cache-Control": "public, max-age=300" } });
}
