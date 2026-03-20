import Link from "next/link";
import { hasSpotifyAuthConfig } from "@/lib/env";
import { getSession } from "@/lib/auth";
import { getSpotifyRedirectUri } from "@/lib/spotify";

type LoginPageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const session = await getSession();
  const { error } = await searchParams;
  const isConfigured = hasSpotifyAuthConfig();

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-10 md:px-10">
      <div className="glass-panel w-full max-w-2xl rounded-[32px] p-8 md:p-10">
        <p className="text-sm uppercase tracking-[0.32em] text-cyan/70">Spotify Login</p>
        <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight text-white md:text-5xl">
          Connect your Spotify account.
        </h1>
        <p className="mt-4 max-w-xl text-base leading-7 text-ink/80">
          SoundScope uses Spotify OAuth to read your profile, top tracks, library, playlists, and
          recently played history so we can build your analytics dashboard.
        </p>

        {error ? (
          <div className="mt-6 rounded-[24px] border border-coral/30 bg-coral/10 px-5 py-4 text-sm text-ink/85">
            Spotify login could not start or complete: {error.replaceAll("_", " ")}.
          </div>
        ) : null}

        {!isConfigured ? (
          <div className="mt-6 rounded-[24px] border border-gold/30 bg-gold/10 px-5 py-4 text-sm text-ink/85">
            Missing one or more auth settings in `.env.local`. You need `SPOTIFY_CLIENT_ID`,
            `SPOTIFY_CLIENT_SECRET`, and `AUTH_SECRET` before OAuth can start.
          </div>
        ) : null}

        <div className="mt-6 rounded-[24px] border border-cyan/20 bg-cyan/10 px-5 py-4 text-sm text-ink/85">
          Spotify requires the redirect URI to exactly match one allowlisted value. For this app,
          keep using `127.0.0.1` and make sure Spotify has the exact callback below saved.
        </div>

        <div className="mt-8 flex flex-wrap gap-4">
          {session ? (
            <Link
              href="/dashboard"
              className="inline-flex items-center rounded-full bg-white px-5 py-3 text-sm font-medium text-slate-950"
            >
              Open dashboard
            </Link>
          ) : isConfigured ? (
            <a
              href="/api/auth/login"
              className="inline-flex items-center rounded-full bg-white px-5 py-3 text-sm font-medium text-slate-950"
            >
              Continue to Spotify
            </a>
          ) : (
            <span className="inline-flex cursor-not-allowed items-center rounded-full bg-white/20 px-5 py-3 text-sm font-medium text-white/70">
              Finish env setup first
            </span>
          )}

          <Link
            href="/"
            className="inline-flex items-center rounded-full border border-white/15 bg-white/5 px-5 py-3 text-sm font-medium text-white"
          >
            Back to home
          </Link>
        </div>

        <div className="mt-8 rounded-[24px] border border-white/10 bg-white/[0.03] p-5 text-sm text-ink/75">
          Callback URI sent to Spotify: {getSpotifyRedirectUri()}
        </div>
      </div>
    </main>
  );
}
