import type { Metadata } from "next";
import "./globals.css";
import "./farm.css";

export const metadata: Metadata = {
  title: "Slop Hogs",
  description: "A retro multiplayer farm game about hogs, AI slop, and getting dangerously large.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
