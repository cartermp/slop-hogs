import type { Metadata } from "next";
import "./globals.css";
import "./farm.css";

export const metadata: Metadata = {
  title: "Slop Hogs",
  description: "A retro multiplayer battle farm where AI-powered hogs Bite, Fart, and risk psychosis.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
