import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { GiftTreatForm } from "@/components/GiftTreatForm";
import { Hog } from "@/components/hog/Hog";
import { appearanceForState } from "@/components/hog/appearance";
import { getDatabase } from "@/lib/server/database";
import { getAppSession } from "@/lib/server/hogs";
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
  const visitor = token ? await getAppSession(getDatabase(), token) : null;
  const appearance = appearanceForState(pen.state);
  return (
    <main>
      <p className="eyebrow">Public pen</p>
      <h1>Look, don&apos;t feed.<br />Unless invited.</h1>
      <div className="pen">
        <div className="pen-art"><Hog appearance={appearance} /></div>
        <div className="pen-copy">
          <p className="pen-label">{appearance.name}</p>
          <p>{appearance.description}</p>
          <dl className="pen-stats">
            <div><dt>Meals</dt><dd>{pen.state.mealsAvailable}/6</dd></div>
            <div><dt>Hunger</dt><dd>{pen.state.hunger}</dd></div>
            <div><dt>Filth</dt><dd>{pen.state.stats.filth}</dd></div>
            <div><dt>Joy</dt><dd>{pen.state.stats.joy}</dd></div>
          </dl>
        </div>
      </div>
      {visitor?.hogId === pen.hogId ? (
        <p className="note">This is your public pen. <Link href="/">Return to its controls.</Link></p>
      ) : visitor && pen.giftsEnabled ? (
        <GiftTreatForm penId={pen.penId} requestId={randomUUID()} />
      ) : (
        <p className="note">
          {pen.giftsEnabled
            ? <>Sign in from the <Link href="/">home page</Link> to leave a treat.</>
            : "This owner is not accepting visitor treats."}
        </p>
      )}
      <Link className="lab-link" href="/">Visit your own hog</Link>
    </main>
  );
}
