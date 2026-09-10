import Link from "next/link";
import { cookies } from "next/headers";
import { Hog } from "@/components/hog/Hog";
import { BASE_HOG } from "@/components/hog/appearance";
import { getDatabase } from "@/lib/server/database";
import { getAppSession } from "@/lib/server/hogs";

const messages: Record<string, string> = {
  invalid_callback: "Bluesky could not verify that login. Please start again.",
  not_invited: "That Bluesky account is not on the private-alpha invite list.",
  account_limit: "The private alpha is full.",
  provider_logout: "You are signed out here, but Bluesky could not be reached to revoke the provider session.",
};

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const token = (await cookies()).get("slop_hogs_session")?.value;
  const session = token ? await getAppSession(getDatabase(), token) : null;
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
        <div className="pen-art"><Hog appearance={BASE_HOG} /></div>
        <div className="pen-copy">
          <p className="pen-label">{session ? "Your hog knows who owns the slop." : "Your hog is almost ready."}</p>
          <p>{session
            ? <>Verified owner: <code>{session.ownerDid}</code><br />Hog: <code>{session.hogId}</code></>
            : "Sign in with Bluesky to claim one private-alpha hog. Slop Hogs requests identity only and cannot post for you."}</p>
        </div>
      </div>
      {notice && <p className={errorCode ? "auth-notice auth-error" : "auth-notice"}>{notice}</p>}
      {session ? (
        <form action="/oauth/logout" method="post"><button className="auth-button" type="submit">Sign out</button></form>
      ) : (
        <form className="login-form" action="/oauth/login" method="post">
          <label htmlFor="handle">Bluesky handle</label>
          <div>
            <input id="handle" name="handle" placeholder="you.bsky.social" autoComplete="username" required maxLength={253} />
            <button className="auth-button" type="submit">Sign in with Bluesky</button>
          </div>
        </form>
      )}
      <p className="note">Feeding from public posts arrives in SH-007. This login grants no posting permission.</p>
      {process.env.NODE_ENV !== "production" && <Link className="lab-link" href="/gallery">Visit the local mutation lab →</Link>}
    </main>
  );
}
