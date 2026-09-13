import type { Metadata } from "next";
import "./globals.css";
import "./farm.css";

export const metadata: Metadata = {
  title: "Slop Hogs",
  description: "A retro hog battle farm with multiplayer and difficulty-based single-player arenas.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
