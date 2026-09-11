import { cookies } from "next/headers";
import { LoginForm } from "@/components/LoginForm";
import { PixelFarm } from "@/components/PixelFarm";
import { getDatabase } from "@/lib/server/database";
import { getAccountSession } from "@/lib/server/hogs";

const messages: Record<string, string> = {
  invalid_callback: "Bluesky could not verify that login. Please start again.",
  invalid_handle: "Enter a valid Bluesky handle.",
  login_unavailable: "Bluesky login is temporarily unavailable. Please try again.",
  login_rate_limited: "Too many login attempts. Please wait and try again.",
  provider_logout: "You are signed out here, but Bluesky could not be reached to revoke the provider session.",
};

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const token = (await cookies()).get("slop_hogs_session")?.value;
  const session = token ? await getAccountSession(getDatabase(), token) : null;
  const query = await searchParams;
  const errorCode = typeof query.auth_error === "string" ? query.auth_error : "";
  const notice = messages[errorCode]
    ?? (query.signed_in === "1" ? "Bluesky verified your account. Entering the shared farm..."
      : query.signed_out === "1" ? "You are signed out." : null);

  if (session) return <PixelFarm />;

  return (
    <main className="login-screen">
      <div className="login-scanlines" aria-hidden="true" />
      <section className="login-terminal">
        <p className="pixel-kicker">SLOP SYSTEMS PRESENTS // 2026</p>
        <h1>SLOP<br /><span>HOGS</span></h1>
        <div className="login-pig" aria-hidden="true">
          <i className="hog-ear-pixel" />
          <i className="hog-body-pixel" />
          <i className="hog-eye-pixel" />
          <i className="hog-snout-pixel" />
          <i className="hog-leg-pixel leg-one" />
          <i className="hog-leg-pixel leg-two" />
        </div>
        <div className="login-copy">
          <p>ROAM THE COMMUNAL FARM.</p>
          <p>EAT UNVERIFIED AI SLOP.</p>
          <p>GET BIG. POP SPECTACULARLY.</p>
        </div>
        {notice && <p className={errorCode ? "terminal-notice terminal-error" : "terminal-notice"}>{notice}</p>}
        <div className="terminal-auth">
          <LoginForm />
          <p>IDENTITY BY BLUESKY // NO POSTING PERMISSION REQUESTED</p>
        </div>
        <div className="blink-prompt">PRESS SIGN IN TO INSERT HOG<span>_</span></div>
      </section>
    </main>
  );
}
