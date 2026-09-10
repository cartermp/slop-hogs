import { Hog } from "@/components/hog/Hog";
import type { TombstoneView } from "@/lib/server/lifecycle";

export function Tombstone({
  tombstone,
  featured = false,
}: {
  tombstone: TombstoneView;
  featured?: boolean;
}) {
  const stats = tombstone.finalState.stats;
  return (
    <article className={featured ? "tombstone tombstone-featured" : "tombstone"}>
      <div className="tombstone-portrait">
        <Hog appearance={tombstone.finalAppearance} />
      </div>
      <div className="tombstone-copy">
        <p className="specimen">Generation {tombstone.generation}</p>
        <h3>{tombstone.endingName}</h3>
        <p className="tombstone-cause">{tombstone.cause}</p>
        <blockquote>{tombstone.epitaph}</blockquote>
        <p className="tombstone-date">
          Retired from the feed on <time dateTime={tombstone.endedAt.toISOString()}>
            {tombstone.endedAt.toISOString().slice(0, 10)}
          </time>
        </p>
        <dl className="tombstone-stats">
          <div><dt>Slop</dt><dd>{stats.slop}</dd></div>
          <div><dt>Mass</dt><dd>{stats.mass}</dd></div>
          <div><dt>Brain</dt><dd>{stats.brain}</dd></div>
          <div><dt>Filth</dt><dd>{stats.filth}</dd></div>
          <div><dt>Joy</dt><dd>{stats.joy}</dd></div>
        </dl>
      </div>
    </article>
  );
}
