import Link from "next/link";
import { Bolt, Disc3, Heart, ImageIcon, Sparkles } from "lucide-react";
import { hasSpotifyAuthConfig } from "@/lib/env";
import { getSession } from "@/lib/auth";
import { getSpotifyRedirectUri } from "@/lib/spotify";
import { SpotifyComplianceNote } from "@/components/spotify-compliance-note";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";

type LoginPageProps = {
  searchParams: Promise<{ error?: string; deleted?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const session = await getSession();
  const { error, deleted } = await searchParams;
  const isConfigured = hasSpotifyAuthConfig();
  const configuredRedirectUri = getSpotifyRedirectUri();

  return (
    <main className="city-pop-shell flex min-h-screen items-center justify-center px-6 py-10 md:px-10">
      <div className="glass-panel neon-outline w-full max-w-6xl overflow-hidden rounded-[42px]">
        <div className="grid gap-0 lg:grid-cols-[1.08fr_0.92fr]">
          <div className="relative overflow-hidden border-b-[3px] border-[rgba(44,12,70,0.9)] p-8 lg:border-b-0 lg:border-r lg:p-12">
            <div className="dashboard-mesh" />
            <div className="relative z-10 space-y-6 text-[var(--theme-text)]">
              <div className="flex flex-wrap gap-3">
                <div className="sticker-badge inline-flex items-center gap-2 px-4 py-2 font-mono text-sm uppercase tracking-[0.16em] text-[var(--theme-badge)]">
                  <Sparkles className="h-4 w-4 text-[var(--theme-accent)]" /> access pass
                </div>
                <div className="sticker-badge inline-flex items-center gap-2 px-4 py-2 font-mono text-sm uppercase tracking-[0.16em] text-[var(--theme-badge)]">
                  <Heart className="h-4 w-4 text-[var(--theme-highlight)]" /> soft chrome mode
                </div>
              </div>

              <div>
                <p className="section-kicker">Access pass</p>
                <h1 className="mt-4 font-display text-5xl font-bold uppercase leading-[0.92] tracking-[0.08em] text-[var(--theme-title)] md:text-6xl">
                  Plug your Spotify into the pastel pop desktop.
                </h1>
                <p className="mt-5 max-w-lg text-base leading-8 text-[var(--theme-body)]">
                  Connect your account to unlock recent plays, top rotations, playlist breakdowns, and a dashboard built like a cute browser full of album covers, stickers, and little player windows.
                </p>
                <p className="mt-4 max-w-lg text-sm leading-7 text-[var(--theme-muted)]">
                  Before OAuth starts, SoundScope explains which Spotify scopes it uses and gives you a self-serve page to disconnect and delete cached local data later.
                </p>
              </div>

              <div className="grid gap-4">
                <div className="window-panel p-5 pt-14 text-[var(--theme-text)]">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-display text-2xl uppercase tracking-[0.08em] text-[var(--theme-title)]">What it reads</p>
                    <div className="icon-bubble h-10 w-10 text-[var(--theme-accent)]">
                      <ImageIcon className="h-4 w-4" />
                    </div>
                  </div>
                  <p className="mt-3 text-sm leading-7 text-[var(--theme-body)]">
                    Profile, top tracks, saved library, playlists, and recent listening history all become visual widgets instead of plain text tables.
                  </p>
                </div>
                <div className="desktop-card p-5 text-[var(--theme-text)]">
                  <div className="flex items-center gap-3">
                    <div className="icon-bubble h-10 w-10 text-[var(--theme-highlight)]">
                      <Bolt className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="font-mono text-sm uppercase tracking-[0.16em] text-[var(--theme-muted)]">redirect uri</p>
                      <p className="mt-1 break-all text-sm text-[var(--theme-title)]">
                        {configuredRedirectUri || "Auto-detected from the current deploy URL"}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="p-8 md:p-10 lg:p-12">
            <div className="space-y-5 text-[var(--theme-text)]">
              <div className="flex justify-end">
                <ThemeToggle />
              </div>
              <p className="section-kicker">Spotify login</p>
              <h2 className="font-display text-4xl uppercase tracking-[0.08em] text-[var(--theme-title)] md:text-5xl">Start the session.</h2>
              <p className="max-w-xl text-base leading-7 text-[var(--theme-body)]">
                OAuth gives SoundScope the context it needs to build your listening scrapbook with artwork-first sections, playful widgets, and way more personality.
              </p>
            </div>

            {error ? (
              <div className="mt-6 rounded-[24px] border-[3px] border-[rgba(44,12,70,0.9)] bg-[rgba(255,236,245,0.82)] px-5 py-4 text-sm text-[var(--theme-text)]">
                Spotify login could not start or complete: {error.replaceAll("_", " ")}.
              </div>
            ) : null}

            {deleted ? (
              <div className="mt-6 rounded-[24px] border-[3px] border-[rgba(44,12,70,0.9)] bg-[rgba(229,255,255,0.82)] px-5 py-4 text-sm text-[var(--theme-text)]">
                Your local SoundScope session and cached Spotify data were deleted.
              </div>
            ) : null}

            {!isConfigured ? (
              <div className="mt-6 rounded-[24px] border-[3px] border-[rgba(44,12,70,0.9)] bg-[rgba(255,247,224,0.86)] px-5 py-4 text-sm text-[var(--theme-text)]">
                Missing one or more auth settings in `.env.local`. You need `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, and `AUTH_SECRET` before OAuth can start.
              </div>
            ) : null}

            <div className="mt-6 desktop-card p-5 text-sm text-[var(--theme-text)]">
              Spotify requires the redirect URI to exactly match one allowlisted value. On Vercel, add your deployed callback URL to Spotify, or set `SPOTIFY_REDIRECT_URI` to that exact production callback.
            </div>

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

            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              <div className="desktop-card p-4 text-[var(--theme-text)]">
                <div className="flex items-center gap-3">
                  <div className="icon-bubble h-10 w-10 text-[var(--theme-accent)]">
                    <Disc3 className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="font-display text-lg uppercase tracking-[0.08em] text-[var(--theme-title)]">Top lists</p>
                    <p className="text-xs uppercase tracking-[0.16em] text-[var(--theme-muted)]">artist, track, album</p>
                  </div>
                </div>
              </div>
              <div className="desktop-card p-4 text-[var(--theme-text)]">
                <div className="flex items-center gap-3">
                  <div className="icon-bubble h-10 w-10 text-[var(--theme-highlight)]">
                    <Sparkles className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="font-display text-lg uppercase tracking-[0.08em] text-[var(--theme-title)]">Rediscovery</p>
                    <p className="text-xs uppercase tracking-[0.16em] text-[var(--theme-muted)]">memory-wall playlists</p>
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

