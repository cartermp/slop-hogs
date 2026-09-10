import { randomUUID } from "node:crypto";
import Link from "next/link";
import { cookies } from "next/headers";
import { HogControls } from "@/components/HogControls";
import { NextGenerationControls } from "@/components/NextGenerationControls";
import { PenControls } from "@/components/PenControls";
import { ShareControls } from "@/components/ShareControls";
import { Tombstone } from "@/components/Tombstone";
import { Hog } from "@/components/hog/Hog";
import { appearanceForState, BASE_HOG } from "@/components/hog/appearance";
import { PostFeeder } from "@/components/PostFeeder";
import { FOOD_LABELS } from "@/lib/food";
import { MUTATION_CATALOG, favoriteFood } from "@/lib/game";
import { loadCostPolicy } from "@/lib/server/cost-policy";
import { getDatabase } from "@/lib/server/database";
import { getHogProfile } from "@/lib/server/lifecycle";
import { getShareEvents } from "@/lib/server/share-cards";
import { getPenManagement } from "@/lib/server/social";

const messages: Record<string, string> = {
  invalid_callback: "Bluesky could not verify that login. Please start again.",
  not_invited: "That Bluesky account is not on the private-alpha invite list.",
  registration_closed: "New private-alpha registrations are temporarily closed.",
  account_limit: "The private alpha is full.",
  provider_logout: "You are signed out here, but Bluesky could not be reached to revoke the provider session.",
};

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const token = (await cookies()).get("slop_hogs_session")?.value;
  const [profile, pen, shareEvents] = token
    ? await Promise.all([
        getHogProfile(getDatabase(), token),
        getPenManagement(getDatabase(), token),
        getShareEvents(getDatabase(), token),
      ])
    : [null, null, []];
  const hog = profile?.active ?? null;
  const latestTombstone = profile?.tombstones[0] ?? null;
  const policy = loadCostPolicy();
  const appearance = hog ? appearanceForState(hog.state) : BASE_HOG;
  const favorite = hog ? favoriteFood(hog.state.taste) : null;
  const query = await searchParams;
  const errorCode = typeof query.auth_error === "string" ? query.auth_error : "";
  const notice = messages[errorCode]
    ?? (query.signed_in === "1" ? "Bluesky verified your account and your hog is ready."
      : query.signed_out === "1" ? "You are signed out." : null);
  return (
    <main>
      <p className="eyebrow">Slop Hogs</p>
      <h1>{profile && !hog
        ? <>One hog down.<br />The pen remembers.</>
        : <>A small pig.<br />A terrible appetite.</>}</h1>
      {hog ? (
        <div className="pen">
          <div className="pen-art"><Hog appearance={appearance} /></div>
          <div className="pen-copy">
            <p className="pen-label">{appearance.name}</p>
            <p>
              {appearance.description}<br />
              Generation {hog.generation} - {hog.state.mealsEaten} lifetime meals
            </p>
            <dl className="pen-stats">
              <div><dt>Tray</dt><dd>{hog.state.mealsAvailable}/6</dd></div>
              <div><dt>Hunger</dt><dd>{hog.state.hunger}</dd></div>
              <div><dt>Slop</dt><dd>{hog.state.stats.slop}</dd></div>
              <div><dt>Brain</dt><dd>{hog.state.stats.brain}</dd></div>
              <div><dt>Filth</dt><dd>{hog.state.stats.filth}</dd></div>
              <div><dt>Joy</dt><dd>{hog.state.stats.joy}</dd></div>
            </dl>
            <div className="diet-readout">
              <p><strong>Lifetime favorite:</strong> {favorite ? FOOD_LABELS[favorite] : "Mixed slop"}</p>
              <p><strong>Recent meals:</strong></p>
              {hog.state.recentMeals.length ? (
                <ol aria-label="Recent meals, oldest to newest">
                  {hog.state.recentMeals.map((food, index) => (
                    <li key={`${index}-${food}`}>{FOOD_LABELS[food]}</li>
                  ))}
                </ol>
              ) : <p className="diet-empty">Nothing yet. The next meal starts the build.</p>}
            </div>
          </div>
        </div>
      ) : latestTombstone ? (
        <Tombstone tombstone={latestTombstone} featured />
      ) : (
        <div className="pen">
          <div className="pen-art"><Hog appearance={BASE_HOG} /></div>
          <div className="pen-copy">
            <p className="pen-label">{profile ? "The pen is empty." : "Your hog is almost ready."}</p>
            <p>{profile
              ? "This account has no active or completed hog life."
              : "Sign in with Bluesky to claim one private-alpha hog. Slop Hogs requests identity only and cannot post for you."}</p>
          </div>
        </div>
      )}
      {notice && <p className={errorCode ? "auth-notice auth-error" : "auth-notice"}>{notice}</p>}
      {profile ? (
        <>
          <form action="/oauth/logout" method="post"><button className="auth-button" type="submit">Sign out</button></form>
          {hog ? (
            <>
              <HogControls feedRequestId={randomUUID()} cleanRequestId={randomUUID()} />
              <section className="mutation-collection" aria-labelledby="collection-title">
                <p className="eyebrow">Mutation collection</p>
                <h2 id="collection-title">{hog.state.discoveries.length} of {MUTATION_CATALOG.length} bad ideas discovered.</h2>
                <div className="mutation-grid">
                  {MUTATION_CATALOG.map(mutation => {
                    const discovered = hog.state.discoveries.includes(mutation.id);
                    const equipped = hog.state.equippedMutations.includes(mutation.id);
                    return (
                      <article className={discovered ? "mutation-card" : "mutation-card mutation-locked"} key={mutation.id}>
                        <p className="specimen">{equipped ? "Equipped" : discovered ? mutation.slot : "Undiscovered"}</p>
                        <h3>{discovered ? mutation.name : "???"}</h3>
                        <p>{discovered ? mutation.description : "Keep feeding deliberate diets to reveal this mutation."}</p>
                      </article>
                    );
                  })}
                </div>
              </section>
            </>
          ) : latestTombstone ? (
            <NextGenerationControls />
          ) : (
            <p className="auth-notice auth-error">This account needs repair before another hog can enter the pen.</p>
          )}
          <ShareControls events={shareEvents} cardsEnabled={policy.features.cardRendering} />
          {hog && policy.features.externalPreviews
            ? <PostFeeder />
            : hog ? <p className="note">Public-post feeding is temporarily disabled.</p> : null}
          {pen && (
            <PenControls
              pen={{
                ...pen,
                pendingGifts: pen.pendingGifts.map(gift => ({
                  ...gift,
                  createdAt: gift.createdAt.toISOString(),
                })),
              }}
              requestIds={{
                visibility: randomUUID(),
                gifts: randomUUID(),
                block: randomUUID(),
                accept: pen.pendingGifts.map(() => randomUUID()),
                decline: pen.pendingGifts.map(() => randomUUID()),
                giftBlock: pen.pendingGifts.map(() => randomUUID()),
                unblock: pen.blockedDids.map(() => randomUUID()),
              }}
            />
          )}
          {profile.tombstones.length > (hog ? 0 : 1) && (
            <section className="life-history" aria-labelledby="life-history-title">
              <p className="eyebrow">Family plot</p>
              <h2 id="life-history-title">Previous bad decisions.</h2>
              <div className="tombstone-grid">
                {profile.tombstones.slice(hog ? 0 : 1).map(tombstone => (
                  <Tombstone key={tombstone.hogId} tombstone={tombstone} />
                ))}
              </div>
            </section>
          )}
        </>
      ) : (
        <form className="login-form" action="/oauth/login" method="post">
          <label htmlFor="handle">Bluesky handle</label>
          <div>
            <input id="handle" name="handle" placeholder="you.bsky.social" autoComplete="username" required maxLength={253} />
            <button className="auth-button" type="submit">Sign in with Bluesky</button>
          </div>
        </form>
      )}
      <p className="note">Slop Hogs only reads public posts you paste. It never receives permission to publish.</p>
      {process.env.NODE_ENV !== "production" && <Link className="lab-link" href="/gallery">Visit the local mutation lab →</Link>}
    </main>
  );
}
