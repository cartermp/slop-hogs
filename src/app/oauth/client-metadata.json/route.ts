import { createClientMetadata, parseAppOrigin } from "@/lib/server/oauth-config";

export const runtime = "nodejs";

export function GET() {
  const metadata = createClientMetadata(parseAppOrigin(process.env.APP_ORIGIN));
  return Response.json(metadata, { headers: { "Cache-Control": "public, max-age=300" } });
}
