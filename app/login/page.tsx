import Link from "next/link";
import { Bolt, Disc3, Heart, ImageIcon, Sparkles } from "lucide-react";
import { getSession } from "@/lib/auth";
import { hasSpotifyAuthConfig } from "@/lib/env";
import { hasMongoConfig } from "@/lib/mongodb";
import { getSpotifyRedirectUri } from "@/lib/spotify";
import { SpotifyComplianceNote } from "@/components/spotify-compliance-note";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";

type LoginPageProps = {
  searchParams: Promise<{ error?: string; deleted?: string; local_error?: string; connect_spotify?: string }>;
};

function InputField(props: {
  label: string;
  name: string;
  type?: "text" | "email" | "password" | "url";
  required?: boolean;
  minLength?: number;
  placeholder?: string;
}) {
  return (
    <label className="block text-sm uppercase tracking-[0.16em] text-[var(--theme-muted)]">
      {props.label}
      <input
        name={props.name}
        type={props.type ?? "text"}
        required={props.required}
        minLength={props.minLength}
        placeholder={props.placeholder}
        className="mt-2 w-full rounded-[18px] border-[3px] border-[rgba(44,12,70,0.2)] bg-white/70 px-4 py-3 text-base normal-case tracking-normal text-[var(--theme-text)]"
      />
    </label>
  );
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const session = await getSession();
  const { error, deleted, local_error: localError, connect_spotify: connectSpotify } = await searchParams;
  const isConfigured = hasSpotifyAuthConfig();
  const hasLocalAccounts = hasMongoConfig();
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
                  Join with Spotify or keep it light with an app account.
                </h1>
                <p className="mt-5 max-w-lg text-base leading-8 text-[var(--theme-body)]">
                  Full listening analytics still need Spotify OAuth, but people can now create an account first and attach their public Spotify profile link.
                </p>
              </div>

              <div className="grid gap-4">
                <div className="window-panel p-5 pt-14 text-[var(--theme-text)]">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-display text-2xl uppercase tracking-[0.08em] text-[var(--theme-title)]">What full access reads</p>
                    <div className="icon-bubble h-10 w-10 text-[var(--theme-accent)]">
                      <ImageIcon className="h-4 w-4" />
                    </div>
                  </div>
                  <p className="mt-3 text-sm leading-7 text-[var(--theme-body)]">
                    Profile, top tracks, saved tracks, playlists, and recent listening history once Spotify is connected.
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
              <p className="section-kicker">Account access</p>
              <h2 className="font-display text-4xl uppercase tracking-[0.08em] text-[var(--theme-title)] md:text-5xl">Start the session.</h2>
              <p className="max-w-xl text-base leading-7 text-[var(--theme-body)]">
                Use Spotify for the full dashboard, or use email plus a pasted Spotify profile link for limited access.
              </p>
            </div>

            {error ? (
              <div className="mt-6 rounded-[24px] border-[3px] border-[rgba(44,12,70,0.9)] bg-[rgba(255,236,245,0.82)] px-5 py-4 text-sm text-[var(--theme-text)]">
                Spotify login could not start or complete: {error.replaceAll("_", " ")}.
              </div>
            ) : null}

            {localError ? (
              <div className="mt-6 rounded-[24px] border-[3px] border-[rgba(44,12,70,0.9)] bg-[rgba(255,247,224,0.86)] px-5 py-4 text-sm text-[var(--theme-text)]">
                App account issue: {localError}
              </div>
            ) : null}

            {connectSpotify ? (
              <div className="mt-6 rounded-[24px] border-[3px] border-[rgba(44,12,70,0.9)] bg-[rgba(229,255,255,0.82)] px-5 py-4 text-sm text-[var(--theme-text)]">
                You&apos;re signed in, but that section still needs a connected Spotify account.
              </div>
            ) : null}

            {deleted ? (
              <div className="mt-6 rounded-[24px] border-[3px] border-[rgba(44,12,70,0.9)] bg-[rgba(229,255,255,0.82)] px-5 py-4 text-sm text-[var(--theme-text)]">
                Your SoundScope session was deleted. Cached Spotify data is removed for connected accounts, and local app accounts are removed from storage.
              </div>
            ) : null}

            {!isConfigured ? (
              <div className="mt-6 rounded-[24px] border-[3px] border-[rgba(44,12,70,0.9)] bg-[rgba(255,247,224,0.86)] px-5 py-4 text-sm text-[var(--theme-text)]">
                Missing one or more auth settings in `.env.local`. Spotify OAuth still needs `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, and `AUTH_SECRET`.
              </div>
            ) : null}

            <div className="mt-6 grid gap-4 xl:grid-cols-2">
              <div className="desktop-card p-5 text-sm text-[var(--theme-text)]">
                Spotify requires the redirect URI to exactly match one allowlisted value. On Vercel, add your deployed callback URL to Spotify, or set `SPOTIFY_REDIRECT_URI` to that exact production callback.
              </div>
              <div className="desktop-card p-5 text-sm text-[var(--theme-text)]">
                App-only accounts use MongoDB storage for sign-in. They save your display name, email, password hash, and pasted Spotify profile link.
              </div>
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

            <div className="mt-8 grid gap-5 xl:grid-cols-2">
              <form action="/api/auth/local/login" method="post" className="desktop-card space-y-4 p-5 text-[var(--theme-text)]">
                <div>
                  <p className="font-display text-2xl uppercase tracking-[0.08em] text-[var(--theme-title)]">App login</p>
                  <p className="mt-2 text-sm leading-7 text-[var(--theme-body)]">Sign in without Spotify OAuth. You can connect Spotify later from the dashboard.</p>
                </div>
                {!hasLocalAccounts ? <p className="text-sm leading-7 text-[var(--theme-body)]">Local login needs MongoDB configured first.</p> : null}
                <InputField label="Email" name="email" type="email" required />
                <InputField label="Password" name="password" type="password" required />
                <button
                  type="submit"
                  disabled={!hasLocalAccounts}
                  className="neon-outline inline-flex rounded-full px-5 py-3 text-sm font-medium uppercase tracking-[0.22em] text-[#170718] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Sign in
                </button>
              </form>

              <form action="/api/auth/local/signup" method="post" className="window-panel space-y-4 p-5 pt-14 text-[var(--theme-text)]">
                <div>
                  <p className="font-display text-2xl uppercase tracking-[0.08em] text-[var(--theme-title)]">Create app account</p>
                  <p className="mt-2 text-sm leading-7 text-[var(--theme-body)]">Paste your public Spotify profile link so the app can still identify your profile, even before Spotify OAuth.</p>
                </div>
                {!hasLocalAccounts ? <p className="text-sm leading-7 text-[var(--theme-body)]">Account creation needs MongoDB configured first.</p> : null}
                <InputField label="Display name" name="displayName" required />
                <InputField label="Email" name="email" type="email" required />
                <InputField label="Password" name="password" type="password" minLength={8} required />
                <InputField
                  label="Spotify profile link"
                  name="spotifyProfileUrl"
                  type="url"
                  required
                  placeholder="https://open.spotify.com/user/your-profile-id"
                />
                <button
                  type="submit"
                  disabled={!hasLocalAccounts}
                  className="neon-outline inline-flex rounded-full px-5 py-3 text-sm font-medium uppercase tracking-[0.22em] text-[#170718] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Create account
                </button>
              </form>
            </div>

            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              <div className="desktop-card p-4 text-[var(--theme-text)]">
                <div className="flex items-center gap-3">
                  <div className="icon-bubble h-10 w-10 text-[var(--theme-accent)]">
                    <Disc3 className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="font-display text-lg uppercase tracking-[0.08em] text-[var(--theme-title)]">Top lists</p>
                    <p className="text-xs uppercase tracking-[0.16em] text-[var(--theme-muted)]">full rankings need spotify</p>
                  </div>
                </div>
              </div>
              <div className="desktop-card p-4 text-[var(--theme-text)]">
                <div className="flex items-center gap-3">
                  <div className="icon-bubble h-10 w-10 text-[var(--theme-highlight)]">
                    <Sparkles className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="font-display text-lg uppercase tracking-[0.08em] text-[var(--theme-title)]">Limited mode</p>
                    <p className="text-xs uppercase tracking-[0.16em] text-[var(--theme-muted)]">account shell + profile link</p>
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
