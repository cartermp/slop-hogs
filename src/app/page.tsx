import { cookies } from "next/headers";
import { FeedbackLinks } from "@/components/FeedbackLinks";
import { LoginForm } from "@/components/LoginForm";
import { PixelFarm } from "@/components/PixelFarm";
import { getDatabase } from "@/lib/server/database";
import { getAccountSession } from "@/lib/server/hogs";

const messages: Record<string, string> = {
  invalid_callback: "Bluesky could not verify that login. Please start again.",
  invalid_handle: "Enter a valid Bluesky handle.",
  login_unavailable: "Bluesky login is temporarily unavailable. Please try again.",
  login_rate_limited: "Too many login attempts. Please wait and try again.",
  github_invalid_callback: "GitHub could not verify that login. Please start again.",
  github_login_canceled: "GitHub login was canceled.",
  github_login_unavailable: "GitHub login is temporarily unavailable. Please try again.",
  provider_logout: "You are signed out here, but the provider session could not be revoked.",
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
      : query.signed_in === "github" ? "GitHub verified your account. Entering the shared farm..."
      : query.signed_out === "1" ? "You are signed out." : null);

  if (session) return <PixelFarm />;

  return (
    <main className="login-screen">
      <div className="login-scanlines" aria-hidden="true" />
      <section className="login-terminal">
        <p className="pixel-kicker">SLOP SYSTEMS PRESENTS</p>
        <h1>SLOP<br /><span>HOGS</span></h1>
        <p className="battle-royale-callout">A BATTLE ROYALE BETWEEN HOGS</p>
        <p className="battle-royale-rules">Bite. Fart. Eat slop. Be the last hog standing.</p>
        <div className="login-hog-stage" aria-hidden="true">
          <div className="login-pig">
            <i className="hog-tail-pixel" />
            <i className="hog-ear-pixel" />
            <i className="hog-body-pixel" />
            <i className="hog-eye-pixel" />
            <i className="hog-snout-pixel" />
            <i className="hog-leg-pixel leg-one" />
            <i className="hog-leg-pixel leg-two" />
          </div>
          <span className="battle-effect bite-effect login-bite-effect">
            <i /><i /><i /><i /><b>CHOMP!</b>
          </span>
          <span className="battle-effect fart-effect login-fart-effect">
            <i /><i /><i /><i /><b>PFFT!</b>
          </span>
        </div>
        {notice && <p className={errorCode ? "terminal-notice terminal-error" : "terminal-notice"}>{notice}</p>}
        <div className="terminal-auth">
          <LoginForm />
        </div>
        <FeedbackLinks variant="login" />
      </section>
    </main>
  );
}
