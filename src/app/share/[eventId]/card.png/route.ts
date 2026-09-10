import { getDatabase } from "@/lib/server/database";
import { getStoredShareCard } from "@/lib/server/share-cards";

export async function GET(
  _request: Request,
  context: { params: Promise<{ eventId: string }> },
) {
  const { eventId } = await context.params;
  const card = await getStoredShareCard(getDatabase(), eventId);
  if (!card) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(card.png), {
    headers: {
      "Content-Type": "image/png",
      "Content-Length": String(card.png.length),
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
