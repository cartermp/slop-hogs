import { randomUUID } from "node:crypto";
import Link from "next/link";
import { cookies } from "next/headers";
import { HogControls } from "@/components/HogControls";
import { Hog } from "@/components/hog/Hog";
import { appearanceForState, BASE_HOG } from "@/components/hog/appearance";
import { PostFeeder } from "@/components/PostFeeder";
import { MUTATION_CATALOG } from "@/lib/game";
import { loadCostPolicy } from "@/lib/server/cost-policy";
import { getDatabase } from "@/lib/server/database";
import { getHogView } from "@/lib/server/hogs";

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
  const hog = token ? await getHogView(getDatabase(), token) : null;
  const appearance = hog ? appearanceForState(hog.state) : BASE_HOG;
  const query = await searchParams;
  const errorCode = typeof query.auth_error === "string" ? query.auth_error : "";
  const notice = messages[errorCode]
    ?? (query.signed_in === "1" ? "Bluesky verified your account and your hog is ready."
      : query.signed_out === "1" ? "You are signed out." : null);
  return (
    <main>
      <p className="eyebrow">Slop Hogs</p>
      <h1>A small pig.<br />A terrible appetite.</h1>
      <div className="pen">
        <div className="pen-art"><Hog appearance={appearance} /></div>
        <div className="pen-copy">
          <p className="pen-label">{hog ? appearance.name : "Your hog is almost ready."}</p>
          <p>{hog
            ? <>{appearance.description}<br />Verified owner: <code>{hog.ownerDid}</code><br />Hog: <code>{hog.hogId}</code></>
            : "Sign in with Bluesky to claim one private-alpha hog. Slop Hogs requests identity only and cannot post for you."}</p>
          {hog && (
            <dl className="pen-stats">
              <div><dt>Meals</dt><dd>{hog.state.mealsAvailable}/6</dd></div>
              <div><dt>Hunger</dt><dd>{hog.state.hunger}</dd></div>
              <div><dt>Filth</dt><dd>{hog.state.stats.filth}</dd></div>
              <div><dt>Joy</dt><dd>{hog.state.stats.joy}</dd></div>
            </dl>
          )}
        </div>
      </div>
      {notice && <p className={errorCode ? "auth-notice auth-error" : "auth-notice"}>{notice}</p>}
      {hog ? (
        <>
          <form action="/oauth/logout" method="post"><button className="auth-button" type="submit">Sign out</button></form>
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
          {loadCostPolicy().features.externalPreviews
            ? <PostFeeder />
            : <p className="note">Public-post feeding is temporarily disabled.</p>}
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
