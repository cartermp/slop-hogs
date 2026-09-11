import { getDatabase } from "@/lib/server/database";
import { httpRequestFields, startServerActivity } from "@/lib/server/logging";
import { getStoredShareCard } from "@/lib/server/share-cards";

export async function GET(
  request: Request,
  context: { params: Promise<{ eventId: string }> },
) {
  const event = startServerActivity(
    "share.card.fetch",
    httpRequestFields(request, "/share/[eventId]/card.png"),
  );
  try {
    const { eventId } = await context.params;
    event.add({ share_event_id: eventId });
    const card = await getStoredShareCard(getDatabase(), eventId);
    if (!card) {
      event.emit("not_found", { http_status: 404 });
      return new Response("Not found", { status: 404 });
    }
    event.emit("success", {
      http_status: 200,
      response_bytes: card.png.length,
      card_created_at: card.createdAt,
    });
    return new Response(new Uint8Array(card.png), {
      headers: {
        "Content-Type": "image/png",
        "Content-Length": String(card.png.length),
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    event.emit("failure", { http_status: 500 }, error);
    throw error;
  }
}
