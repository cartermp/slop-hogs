import Link from "next/link";
import { Hog } from "@/components/hog/Hog";
import { BASE_HOG } from "@/components/hog/appearance";

export default function Home() {
  return (
    <main>
      <p className="eyebrow">Slop Hogs</p>
      <h1>A small pig.<br />A terrible appetite.</h1>
      <div className="pen">
        <div className="pen-art"><Hog appearance={BASE_HOG} /></div>
        <div className="pen-copy">
          <p className="pen-label">Your hog is almost ready.</p>
          <p>It has no name, no account, and no idea what the internet is about to do to it.</p>
        </div>
      </div>
      <p className="note">Feeding and Bluesky sign-in are coming. No accounts are being created yet.</p>
      {process.env.NODE_ENV !== "production" && <Link className="lab-link" href="/gallery">Visit the local mutation lab →</Link>}
    </main>
  );
}
