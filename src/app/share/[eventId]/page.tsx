import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Hog } from "@/components/hog/Hog";
import { getDatabase } from "@/lib/server/database";
import { getPublicShareEvent } from "@/lib/server/share-cards";

type Props = { params: Promise<{ eventId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { eventId } = await params;
  const event = await getPublicShareEvent(getDatabase(), eventId);
  if (!event) return { title: "Share event not found | Slop Hogs" };
  const image = new URL(`/share/${event.id}/card.png`, process.env.APP_ORIGIN ?? "http://127.0.0.1:3000");
  return {
    title: `${event.mutationName} unlocked | Slop Hogs`,
    description: event.speech,
    openGraph: event.cardReady ? {
      title: `${event.mutationName} unlocked`,
      description: event.speech,
      type: "article",
      images: [{ url: image, width: 1200, height: 630, alt: `${event.appearanceName}: ${event.mutationName}` }],
    } : undefined,
  };
}

export default async function ShareEventPage({ params }: Props) {
  const { eventId } = await params;
  const event = await getPublicShareEvent(getDatabase(), eventId);
  if (!event) notFound();
  return (
    <main>
      <p className="eyebrow">Mutation report</p>
      <h1>{event.mutationName}<br />unlocked.</h1>
      <div className="pen">
        <div className="pen-art"><Hog appearance={event.appearance} /></div>
        <div className="pen-copy">
          <p className="pen-label">{event.appearanceName}</p>
          <p>{event.eventText}</p>
        </div>
      </div>
      <blockquote className="share-speech">{event.speech}</blockquote>
      {event.cardReady && (
        <img
          className="stored-share-card"
          src={`/share/${event.id}/card.png`}
          width="1200"
          height="630"
          alt={`${event.appearanceName}: ${event.mutationName} unlocked`}
        />
      )}
      <Link className="lab-link" href="/">Raise your own Slop Hog</Link>
    </main>
  );
}
