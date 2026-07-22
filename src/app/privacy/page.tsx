import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — Daily Double",
  description: "How Daily Double collects, uses, and protects your information.",
};

const UPDATED = "July 22, 2026";
const CONTACT = "xstanz@gmail.com";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="font-display text-2xl tracking-wide text-gold">{title}</h2>
      <div className="space-y-3 text-blue-100/80 leading-relaxed">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <div className="flex flex-col flex-1 min-h-screen">
      <main className="flex-1 w-full max-w-3xl mx-auto px-6 py-12">
        <header className="mb-10">
          <h1 className="font-display text-4xl md:text-5xl tracking-wider text-gold">Privacy Policy</h1>
          <p className="text-blue-200/50 mt-2 text-sm">Last updated: {UPDATED}</p>
          <Link href="/" className="inline-block mt-4 text-gold/80 hover:text-gold underline">
            ← Back to Daily Double
          </Link>
        </header>

        <div className="space-y-8">
          <Section title="Who we are">
            <p>
              Daily Double is an independent, AI-generated trivia game, operated by Stanley Luong as a personal
              project (&ldquo;we&rdquo;, &ldquo;us&rdquo;). This policy explains what information the game collects when
              you use it and how that information is handled.
            </p>
          </Section>

          <Section title="Information we collect">
            <ul className="list-disc pl-5 space-y-2">
              <li>
                <strong>Account information.</strong> When you sign in with Google or create an account with an email
                and password, we receive your email address and a display name. We never see or store your Google
                password.
              </li>
              <li>
                <strong>Gameplay data.</strong> Your scores, the answers you submit, which boards you&apos;ve played,
                and any custom board categories you create.
              </li>
              <li>
                <strong>Social features.</strong> Your friends list, game invitations, online presence, and messages you
                send in game chat or direct messages.
              </li>
              <li>
                <strong>Technical data.</strong> Standard, non-identifying information such as your browser type and
                general usage, used to keep the game running reliably.
              </li>
            </ul>
          </Section>

          <Section title="How we use your information">
            <p>We use the information above only to operate the game — for example to:</p>
            <ul className="list-disc pl-5 space-y-2">
              <li>sign you in and keep you signed in;</li>
              <li>save your scores and play history across sessions;</li>
              <li>power leaderboards and ranked ratings;</li>
              <li>enable multiplayer games, friends, invitations, and chat.</li>
            </ul>
          </Section>

          <Section title="Service providers">
            <p>Your data is processed by a small number of third-party services solely to run the game:</p>
            <ul className="list-disc pl-5 space-y-2">
              <li>
                <strong>Google Firebase</strong> — handles sign-in (Authentication) and stores game data (Firestore
                database).
              </li>
              <li>
                <strong>Anthropic (Claude)</strong> — generates the trivia clues and grades the answers you submit. The
                text of an answer you type may be sent to Claude to judge whether it&apos;s correct.
              </li>
              <li>
                <strong>Amazon Web Services (AWS)</strong> — hosts the website.
              </li>
            </ul>
            <p>
              We do <strong>not</strong> sell your personal information, and we do not share it with anyone beyond the
              providers above needed to run the game.
            </p>
          </Section>

          <Section title="Cookies &amp; local storage">
            <p>
              We use browser local storage to keep you signed in and to remember preferences (such as whether sound is
              muted). We do not use advertising or cross-site tracking cookies.
            </p>
          </Section>

          <Section title="Data retention &amp; your choices">
            <p>
              We keep your account and game data while your account is active. You can request access to, correction of,
              or deletion of your data — including deletion of your account — by emailing us at{" "}
              <a href={`mailto:${CONTACT}`} className="text-gold hover:underline">
                {CONTACT}
              </a>
              .
            </p>
          </Section>

          <Section title="Children">
            <p>
              Daily Double is not directed to children under 13, and we do not knowingly collect personal information
              from them. If you believe a child has provided us information, contact us and we will delete it.
            </p>
          </Section>

          <Section title="Changes to this policy">
            <p>
              We may update this policy from time to time. Material changes will be reflected by updating the date at the
              top of this page.
            </p>
          </Section>

          <Section title="Contact">
            <p>
              Questions about this policy? Email{" "}
              <a href={`mailto:${CONTACT}`} className="text-gold hover:underline">
                {CONTACT}
              </a>
              .
            </p>
          </Section>

          <p className="text-blue-200/40 text-sm pt-4">
            See also our{" "}
            <Link href="/terms" className="text-gold/70 hover:text-gold underline">
              Terms of Service
            </Link>
            .
          </p>
        </div>
      </main>
    </div>
  );
}
