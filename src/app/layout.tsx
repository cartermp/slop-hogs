import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Slop Hogs",
  description: "A small pig with a terrible appetite. A virtual pet game in the making.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
