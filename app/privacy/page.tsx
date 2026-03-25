import Link from "next/link";
import { getSession } from "@/lib/auth";

export default async function PrivacyPage() {
  const session = await getSession();

  return (
    <main className="city-pop-shell min-h-screen px-6 py-10 md:px-10">
      <div className="mx-auto max-w-5xl space-y-8 text-[var(--theme-text)]">
        <div className="glass-panel rounded-[36px] p-8 md:p-10">
          <p className="section-kicker">Privacy and Spotify data</p>
          <h1 className="mt-4 font-display text-4xl uppercase tracking-[0.08em] text-[var(--theme-title)] md:text-5xl">
            Data use and account controls
          </h1>
          <p className="mt-5 max-w-3xl text-base leading-8 text-[var(--theme-body)]">
            SoundScope only requests the Spotify permissions it uses for your dashboard: profile basics, recent listening, current playback, top content, saved tracks, and private playlists. Cached Spotify data is used to build your personal dashboard views, and any social sharing now runs from explicit opt-in settings only.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href={session ? "/dashboard" : "/login"} className="pixel-chip text-[var(--theme-text)] transition hover:text-[#2d0d46]">
              {session ? "Back to dashboard" : "Back to login"}
            </Link>
            {session ? (
              <Link href="/settings" className="pixel-chip text-[var(--theme-text)] transition hover:text-[#2d0d46]">
                Sharing settings
              </Link>
            ) : null}
            <a href="https://developer.spotify.com/terms" target="_blank" rel="noreferrer" className="pixel-chip text-[var(--theme-text)] transition hover:text-[#2d0d46]">
              Spotify terms
            </a>
            <a href="https://developer.spotify.com/documentation/design" target="_blank" rel="noreferrer" className="pixel-chip text-[var(--theme-text)] transition hover:text-[#2d0d46]">
              Spotify design rules
            </a>
          </div>
        </div>

        <section className="desktop-card p-6 md:p-8">
          <h2 className="font-display text-2xl uppercase tracking-[0.08em] text-[var(--theme-title)]">What SoundScope accesses</h2>
          <p className="mt-4 text-sm leading-7 text-[var(--theme-body)]">
            Spotify account ID, display name, profile image, email, recent plays, current playback context, top artists and tracks, saved tracks, and playlists. Public social pages only use SoundScope&apos;s own cached history and only when a user explicitly enables profile sharing in settings.
          </p>
        </section>

        <section className="desktop-card p-6 md:p-8">
          <h2 className="font-display text-2xl uppercase tracking-[0.08em] text-[var(--theme-title)]">How sharing works</h2>
          <p className="mt-4 text-sm leading-7 text-[var(--theme-body)]">
            The social directory reads cached SoundScope data from MongoDB instead of requesting Spotify data for other users on demand. You can independently choose whether to show your profile, your top lists, and your listening-pattern summaries.
          </p>
        </section>

        <section className="desktop-card p-6 md:p-8">
          <h2 className="font-display text-2xl uppercase tracking-[0.08em] text-[var(--theme-title)]">How to disconnect and delete local data</h2>
          <p className="mt-4 text-sm leading-7 text-[var(--theme-body)]">
            Logging out only ends your current session. If you want SoundScope to remove cached Spotify data it controls, use the delete action below. This clears the local session and deletes cached snapshots, synced recent plays, and stored connection records for your Spotify account.
          </p>
          {session ? (
            <form action="/api/account/delete" method="post" className="mt-6">
              <button type="submit" className="rounded-full border-[3px] border-[rgba(44,12,70,0.85)] bg-[rgba(255,236,245,0.9)] px-5 py-3 font-mono text-sm uppercase tracking-[0.16em] text-[var(--theme-text)] transition hover:bg-[rgba(255,225,239,0.96)]">
                Disconnect account and delete cached data
              </button>
            </form>
          ) : (
            <p className="mt-6 text-sm text-[var(--theme-muted)]">
              Sign in first if you want to use the in-app deletion control.
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
