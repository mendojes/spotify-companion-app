import Link from "next/link";
import { Disc3, Heart, ImageIcon, Sparkles } from "lucide-react";
import { getSession } from "@/lib/auth";
import { hasSpotifyAuthConfig } from "@/lib/env";
import { hasMongoConfig } from "@/lib/mongodb";
import { SpotifyComplianceNote } from "@/components/spotify-compliance-note";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { LocalAccountAccess } from "@/components/local-account-access";

type LoginPageProps = {
  searchParams: Promise<{ error?: string; deleted?: string; local_error?: string; connect_spotify?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const session = await getSession();
  const { error, deleted, local_error: localError } = await searchParams;
  const isConfigured = hasSpotifyAuthConfig();
  const hasLocalAccounts = hasMongoConfig();

  return (
    <main className="city-pop-shell flex min-h-screen items-center justify-center px-6 py-10 md:px-10">
      <div className="glass-panel neon-outline w-full max-w-4xl overflow-hidden rounded-[42px] p-8 md:p-10 lg:p-12">
        <div className="dashboard-mesh" />
        <div className="relative z-10">
          <div className="space-y-6 text-[var(--theme-text)]">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex flex-wrap gap-3">
                <div className="sticker-badge inline-flex items-center gap-2 px-4 py-2 font-mono text-sm uppercase tracking-[0.16em] text-[var(--theme-badge)]">
                  <Sparkles className="h-4 w-4 text-[var(--theme-accent)]" /> access pass
                </div>
                <div className="sticker-badge inline-flex items-center gap-2 px-4 py-2 font-mono text-sm uppercase tracking-[0.16em] text-[var(--theme-badge)]">
                  <Heart className="h-4 w-4 text-[var(--theme-highlight)]" /> soft chrome mode
                </div>
              </div>
              <ThemeToggle />
            </div>

            <div>
              <p className="section-kicker">Account access</p>
              <h1 className="mt-4 font-display text-5xl font-bold uppercase leading-[0.92] tracking-[0.08em] text-[var(--theme-title)] md:text-6xl">
                Start with Spotify or use the public-profile dashboard.
              </h1>
              <p className="mt-5 max-w-3xl text-base leading-8 text-[var(--theme-body)]">
                People who can&apos;t connect Spotify can still sign in with a SoundScope account and get the experience built from public profile data.
              </p>
            </div>

            <div className="space-y-5 text-[var(--theme-text)]">
              <h2 className="font-display text-4xl uppercase tracking-[0.08em] text-[var(--theme-title)] md:text-5xl">Start the session.</h2>
              <p className="max-w-xl text-base leading-7 text-[var(--theme-body)]">
                Continue with Spotify if available, or continue without connecting to use the public-profile version of SoundScope.
              </p>
            </div>

            {error ? (
              <div className="mt-6 rounded-[24px] border-[3px] border-[rgba(44,12,70,0.9)] bg-[rgba(255,236,245,0.82)] px-5 py-4 text-sm text-[var(--theme-text)]">
                Spotify login could not start or complete: {error.replaceAll("_", " ")}.
              </div>
            ) : null}

            {localError ? (
              <div className="mt-6 rounded-[24px] border-[3px] border-[rgba(44,12,70,0.9)] bg-[rgba(255,247,224,0.86)] px-5 py-4 text-sm text-[var(--theme-text)]">
                Account issue: {localError}
              </div>
            ) : null}

            {deleted ? (
              <div className="mt-6 rounded-[24px] border-[3px] border-[rgba(44,12,70,0.9)] bg-[rgba(229,255,255,0.82)] px-5 py-4 text-sm text-[var(--theme-text)]">
                Your SoundScope session was deleted.
              </div>
            ) : null}

            {!isConfigured ? (
              <div className="mt-6 rounded-[24px] border-[3px] border-[rgba(44,12,70,0.9)] bg-[rgba(255,247,224,0.86)] px-5 py-4 text-sm text-[var(--theme-text)]">
                Missing one or more auth settings in `.env.local`. Spotify OAuth still needs `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, and `AUTH_SECRET`.
              </div>
            ) : null}

            <div className="mt-6">
              <SpotifyComplianceNote />
            </div>

            <div className="mt-8 flex flex-wrap gap-4">
              {session ? (
                <Button href="/dashboard">Open dashboard</Button>
              ) : isConfigured ? (
                <Button href="/api/auth/login">Continue to Spotify</Button>
              ) : (
                <span className="inline-flex cursor-not-allowed items-center rounded-full border-[3px] border-[rgba(44,12,70,0.8)] bg-white/50 px-5 py-3 text-sm font-medium uppercase tracking-[0.16em] text-[#7f6b92]">
                  Finish env setup first
                </span>
              )}

              <Link href="/" className="chrome-line inline-flex items-center rounded-full bg-white/[0.58] px-5 py-3 font-mono text-lg uppercase tracking-[0.14em] text-[var(--theme-text)]">
                Back to home
              </Link>
              <Link href="/privacy" className="chrome-line inline-flex items-center rounded-full bg-white/[0.58] px-5 py-3 font-mono text-lg uppercase tracking-[0.14em] text-[var(--theme-text)]">
                Privacy
              </Link>
            </div>

            {!session ? <LocalAccountAccess enabled={hasLocalAccounts} initialOpen={Boolean(localError)} /> : null}

            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              <div className="desktop-card p-4 text-[var(--theme-text)]">
                <div className="flex items-center gap-3">
                  <div className="icon-bubble h-10 w-10 text-[var(--theme-accent)]">
                    <Disc3 className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="font-display text-lg uppercase tracking-[0.08em] text-[var(--theme-title)]">Public playlists</p>
                    <p className="text-xs uppercase tracking-[0.16em] text-[var(--theme-muted)]">genre + vibe read</p>
                  </div>
                </div>
              </div>
              <div className="desktop-card p-4 text-[var(--theme-text)]">
                <div className="flex items-center gap-3">
                  <div className="icon-bubble h-10 w-10 text-[var(--theme-highlight)]">
                    <Sparkles className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="font-display text-lg uppercase tracking-[0.08em] text-[var(--theme-title)]">Recent artists</p>
                    <p className="text-xs uppercase tracking-[0.16em] text-[var(--theme-muted)]">only if spotify shows them publicly</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
