import Link from "next/link";
import { hasSpotifyConnection, requireSession } from "@/lib/auth";
import { getConnectedUser, getDefaultPrivacySettings, listCommunityUsers } from "@/lib/connected-users";
import { formatPstDateTime, PST_TIME_ZONE } from "@/lib/time";

function formatSeenAt(value?: string) {
  if (!value) {
    return "No recent activity";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: PST_TIME_ZONE,
  }).format(new Date(value)) + " PT";
}

export default async function SocialPage() {
  const session = await requireSession();
  const spotifyConnected = hasSpotifyConnection(session);

  if (!spotifyConnected) {
    return (
      <main className="city-pop-shell min-h-screen px-6 py-10 md:px-10">
        <div className="mx-auto max-w-6xl space-y-8 text-[var(--theme-text)]">
          <section className="glass-panel rounded-[36px] p-8 md:p-10">
            <p className="section-kicker">Social</p>
            <h1 className="mt-4 font-display text-4xl uppercase tracking-[0.08em] text-[var(--theme-title)] md:text-5xl">
              Social compare unlocks after Spotify connection
            </h1>
            <p className="mt-5 max-w-3xl text-base leading-8 text-[var(--theme-body)]">
              SoundScope compares cached listening history between connected Spotify accounts. Your app-only account can sign in and save a public profile link, but it does not have listening snapshots to compare yet.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <a href="/api/auth/login" className="pixel-chip text-[var(--theme-text)] transition hover:text-[#2d0d46]">
                Connect Spotify
              </a>
              <Link href="/dashboard" className="pixel-chip text-[var(--theme-text)] transition hover:text-[#2d0d46]">
                Back to dashboard
              </Link>
            </div>
          </section>
        </div>
      </main>
    );
  }

  const [communityUsers, currentUser] = await Promise.all([
    listCommunityUsers(24),
    getConnectedUser(session.spotifyUserId),
  ]);

  const privacy = currentUser?.privacy ?? getDefaultPrivacySettings();
  const visibleUsers = communityUsers.filter((user) => user.spotifyUserId !== session.spotifyUserId);

  return (
    <main className="city-pop-shell min-h-screen px-6 py-10 md:px-10">
      <div className="mx-auto max-w-6xl space-y-8 text-[var(--theme-text)]">
        <section className="glass-panel rounded-[36px] p-8 md:p-10">
          <p className="section-kicker">Social</p>
          <h1 className="mt-4 font-display text-4xl uppercase tracking-[0.08em] text-[var(--theme-title)] md:text-5xl">
            Compare cached listening worlds
          </h1>
          <p className="mt-5 max-w-3xl text-base leading-8 text-[var(--theme-body)]">
            This community area only uses stored SoundScope history. Opening someone else&apos;s profile never triggers a fresh Spotify request for their account.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/settings" className="pixel-chip text-[var(--theme-text)] transition hover:text-[#2d0d46]">
              Manage sharing settings
            </Link>
            <Link href="/dashboard" className="pixel-chip text-[var(--theme-text)] transition hover:text-[#2d0d46]">
              Back to dashboard
            </Link>
          </div>
        </section>

        <section className="desktop-card p-6 md:p-8">
          <h2 className="font-display text-2xl uppercase tracking-[0.08em] text-[var(--theme-title)]">Your visibility</h2>
          <p className="mt-3 text-sm leading-7 text-[var(--theme-body)]">
            Profile: {privacy.shareProfile ? "Visible" : "Hidden"} · Top lists: {privacy.shareTopLists ? "Shared" : "Private"} · Listening patterns: {privacy.shareListeningActivity ? "Shared" : "Private"}
          </p>
        </section>

        <section className="space-y-5">
          <div>
            <p className="section-kicker">Community directory</p>
            <h2 className="mt-2 font-display text-3xl uppercase tracking-[0.08em] text-[var(--theme-title)]">Opted-in profiles</h2>
          </div>

          {visibleUsers.length === 0 ? (
            <div className="glass-panel rounded-[30px] p-8 text-sm leading-7 text-[var(--theme-body)]">
              No one else is publicly sharing yet. Turn on profile sharing in settings if you want to make your own page discoverable.
            </div>
          ) : (
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {visibleUsers.map((user) => (
                <div key={user.spotifyUserId} className="glass-panel rounded-[30px] p-6">
                  <p className="font-display text-2xl uppercase tracking-[0.08em] text-[var(--theme-title)]">{user.displayName}</p>
                  <p className="mt-3 text-sm text-[var(--theme-muted)]">Seen {formatSeenAt(user.lastSeenAt)}</p>
                  <p className="mt-4 text-sm leading-7 text-[var(--theme-body)]">
                    Shares {user.privacy.shareTopLists ? "top lists" : "limited profile info"}
                    {user.privacy.shareListeningActivity ? " and listening patterns." : "."}
                  </p>
                  <div className="mt-5 flex flex-wrap gap-3">
                    <Link href={`/social/${user.spotifyUserId}`} className="pixel-chip text-[var(--theme-text)] transition hover:text-[#2d0d46]">
                      Open profile
                    </Link>
                    <Link href={`/social/${user.spotifyUserId}/compare`} className="pixel-chip text-[var(--theme-text)] transition hover:text-[#2d0d46]">
                      Compare
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
