import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { GiftTreatForm } from "@/components/GiftTreatForm";
import { Tombstone } from "@/components/Tombstone";
import { Hog } from "@/components/hog/Hog";
import { appearanceForState } from "@/components/hog/appearance";
import { getDatabase } from "@/lib/server/database";
import { getAccountSession } from "@/lib/server/hogs";
import { getPublicPen } from "@/lib/server/social";

export const metadata: Metadata = {
  title: "Public pen | Slop Hogs",
  description: "Visit a Slop Hog and leave a bounded treat for its owner to approve.",
};

export default async function PublicPenPage({
  params,
}: {
  params: Promise<{ penId: string }>;
}) {
  const { penId } = await params;
  const pen = await getPublicPen(getDatabase(), penId);
  if (!pen) notFound();
  const token = (await cookies()).get("slop_hogs_session")?.value;
  const visitor = token ? await getAccountSession(getDatabase(), token) : null;
  const active = pen.hogId !== null && pen.state !== null
    ? { hogId: pen.hogId, state: pen.state, appearance: appearanceForState(pen.state) }
    : null;
  const latestTombstone = pen.tombstones[0] ?? null;
  return (
    <main>
      <p className="eyebrow">Public pen</p>
      <h1>{active
        ? <>Look, don&apos;t feed.<br />Unless you brought snacks.</>
        : <>The pen is quiet.<br />The plot is not.</>}</h1>
      {active ? (
        <div className="pen">
          <div className="pen-art"><Hog appearance={active.appearance} /></div>
          <div className="pen-copy">
            <p className="pen-label">{active.appearance.name}</p>
            <p>{active.appearance.description}</p>
            <dl className="pen-stats">
              <div><dt>Meals</dt><dd>{active.state.mealsAvailable}/6</dd></div>
              <div><dt>Hunger</dt><dd>{active.state.hunger}</dd></div>
              <div><dt>Filth</dt><dd>{active.state.stats.filth}</dd></div>
              <div><dt>Joy</dt><dd>{active.state.stats.joy}</dd></div>
            </dl>
          </div>
        </div>
      ) : latestTombstone ? (
        <Tombstone tombstone={latestTombstone} featured />
      ) : (
        <p className="note">No hog life has reached this public pen yet.</p>
      )}
      {active && visitor?.hogId === active.hogId ? (
        <p className="note">This is your public pen. <Link href="/">Return to its controls.</Link></p>
      ) : active && visitor && pen.giftsEnabled ? (
        <GiftTreatForm penId={pen.penId} requestId={randomUUID()} />
      ) : active ? (
        <p className="note">
          {pen.giftsEnabled
            ? <>Sign in from the <Link href="/">home page</Link> to leave a treat.</>
            : "This owner is not accepting visitor treats."}
        </p>
      ) : <p className="note">The owner has not begun the next generation yet.</p>}
      {pen.tombstones.length > (active ? 0 : 1) && (
        <section className="life-history" aria-labelledby="public-history-title">
          <p className="eyebrow">Family plot</p>
          <h2 id="public-history-title">The pen remembers.</h2>
          <div className="tombstone-grid">
            {pen.tombstones.slice(active ? 0 : 1).map(tombstone => (
              <Tombstone key={tombstone.hogId} tombstone={tombstone} />
            ))}
          </div>
        </section>
      )}
      <Link className="lab-link" href="/">Visit your own hog</Link>
    </main>
  );
}
