import type { Metadata } from "next";
import { Bebas_Neue, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import AuthProvider from "@/components/AuthProvider";
import DmProvider from "@/components/DmProvider";
import FriendsProvider from "@/components/FriendsProvider";
import FriendsRail from "@/components/FriendsRail";
import InviteBanner from "@/components/InviteBanner";
import NavBar from "@/components/NavBar";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const bebas = Bebas_Neue({
  variable: "--font-bebas",
  weight: "400",
  subsets: ["latin"],
});

// Canonical site origin. Defaults to the production domain; override per
// environment (e.g. Amplify preview branches) with NEXT_PUBLIC_SITE_URL.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.playdailydouble.com";
const DESCRIPTION =
  "A fresh Jeopardy!-style trivia board every day. Jeopardy! and Double Jeopardy! rounds, Daily Doubles, 60 clues — written and judged by Claude.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Daily Double — AI-generated Jeopardy",
  description: DESCRIPTION,
  applicationName: "Daily Double",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "Daily Double",
    title: "Daily Double — AI-generated Jeopardy",
    description: DESCRIPTION,
    url: SITE_URL,
  },
  twitter: {
    card: "summary_large_image",
    title: "Daily Double — AI-generated Jeopardy",
    description: DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${bebas.variable} h-full antialiased`}
    >
      {/* suppressHydrationWarning: browser extensions (e.g. ColorZilla's
          cz-shortcut-listen) inject attributes onto <body> before React
          hydrates, which would otherwise falsely flag as a hydration
          mismatch — this is the documented fix, scoped to this one element. */}
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <AuthProvider>
          <FriendsProvider>
            <DmProvider>
              <NavBar />
              <div className="flex flex-1 min-h-0">
                <main className="flex-1 min-w-0">{children}</main>
                <FriendsRail />
              </div>
              <InviteBanner />
            </DmProvider>
          </FriendsProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
