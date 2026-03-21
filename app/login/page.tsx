import Link from "next/link";
import { hasSpotifyAuthConfig } from "@/lib/env";
import { getSession } from "@/lib/auth";
import { getSpotifyRedirectUri } from "@/lib/spotify";
import { Button } from "@/components/ui/button";

type LoginPageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const session = await getSession();
  const { error } = await searchParams;
  const isConfigured = hasSpotifyAuthConfig();

  return (
    <main className="city-pop-shell flex min-h-screen items-center justify-center px-6 py-10 md:px-10">
      <div className="glass-panel neon-outline w-full max-w-6xl overflow-hidden rounded-[40px]">
        <div className="grid gap-0 lg:grid-cols-[1fr_1fr]">
          <div className="relative overflow-hidden border-b border-white/10 p-8 lg:border-b-0 lg:border-r lg:p-12">
            <div className="dashboard-mesh" />
            <div className="relative z-10 space-y-6">
              <p className="section-kicker">Access pass</p>
              <h1 className="font-display text-5xl font-bold uppercase leading-[0.92] tracking-[0.08em] text-white md:text-6xl">
                Plug your Spotify into the chrome dream.
              </h1>
              <p className="max-w-lg text-base leading-8 text-ink/80">
                Connect your account to unlock recent plays, top rotations, playlist breakdowns, and a dashboard that feels more like a collectible web shrine than an admin tool.
              </p>
              <div className="grid gap-4">
                <div className="window-panel p-5 pt-14">
                  <p className="font-mono text-lg uppercase tracking-[0.16em] text-ink/70">Reads</p>
                  <p className="mt-2 text-white">Profile, top tracks, saved library, playlists, and recent listening history.</p>
                </div>
                <div className="rounded-[28px] border border-cyan/20 bg-cyan/10 p-5">
                  <p className="font-mono text-lg uppercase tracking-[0.16em] text-cyan/85">Redirect URI</p>
                  <p className="mt-2 break-all text-sm text-ink/85">{getSpotifyRedirectUri()}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="p-8 md:p-10 lg:p-12">
            <p className="section-kicker">Spotify login</p>
            <h2 className="mt-4 font-display text-4xl uppercase tracking-[0.08em] text-white md:text-5xl">Start the session.</h2>
            <p className="mt-4 max-w-xl text-base leading-7 text-ink/78">
              Spotify OAuth gives SoundScope the context it needs to turn your listening history into an artwork-heavy, mood-forward archive.
            </p>

            {error ? (
              <div className="mt-6 rounded-[24px] border border-coral/30 bg-coral/10 px-5 py-4 text-sm text-ink/90">
                Spotify login could not start or complete: {error.replaceAll("_", " ")}.
              </div>
            ) : null}

            {!isConfigured ? (
              <div className="mt-6 rounded-[24px] border border-gold/30 bg-gold/10 px-5 py-4 text-sm text-ink/90">
                Missing one or more auth settings in `.env.local`. You need `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, and `AUTH_SECRET` before OAuth can start.
              </div>
            ) : null}

            <div className="mt-6 rounded-[24px] border border-cyan/20 bg-cyan/10 px-5 py-4 text-sm text-ink/90">
              Spotify requires the redirect URI to exactly match one allowlisted value. Keep using `127.0.0.1` and make sure Spotify has the exact callback shown here.
            </div>

            <div className="mt-8 flex flex-wrap gap-4">
              {session ? (
                <Button href="/dashboard">Open dashboard</Button>
              ) : isConfigured ? (
                <Button href="/api/auth/login">Continue to Spotify</Button>
              ) : (
                <span className="inline-flex cursor-not-allowed items-center rounded-full bg-white/20 px-5 py-3 text-sm font-medium uppercase tracking-[0.16em] text-white/70">
                  Finish env setup first
                </span>
              )}

              <Link
                href="/"
                className="chrome-line inline-flex items-center rounded-full bg-white/[0.04] px-5 py-3 font-mono text-lg uppercase tracking-[0.14em] text-white"
              >
                Back to home
              </Link>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
