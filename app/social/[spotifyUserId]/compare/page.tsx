import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { getCommunityUserProfile } from "@/lib/connected-users";
import { getDashboardInsightsFromHistory } from "@/lib/spotify-dashboard";
import { compareTopLists, getListeningSnapshotSummary } from "@/lib/social";
import { getSpotifyTopListsFromHistory } from "@/lib/spotify-toplists";

type ComparePageProps = {
  params: Promise<{ spotifyUserId: string }>;
};

export default async function SocialComparePage({ params }: ComparePageProps) {
  const session = await requireSession();
  const { spotifyUserId } = await params;

  const profile = await getCommunityUserProfile(spotifyUserId);
  if (!profile) {
    notFound();
  }

  const [yourInsights, theirInsights, yourTopLists, theirTopLists] = await Promise.all([
    getDashboardInsightsFromHistory(session.spotifyUserId, "month"),
    profile.privacy.shareListeningActivity ? getDashboardInsightsFromHistory(spotifyUserId, "month") : Promise.resolve(null),
    getSpotifyTopListsFromHistory(session.spotifyUserId, "month", 10),
    profile.privacy.shareTopLists ? getSpotifyTopListsFromHistory(spotifyUserId, "month", 10) : Promise.resolve(null),
  ]);

  const yourSummary = getListeningSnapshotSummary(yourInsights);
  const theirSummary = getListeningSnapshotSummary(theirInsights);
  const comparison = compareTopLists(yourTopLists, theirTopLists);

  return (
    <main className="city-pop-shell min-h-screen px-6 py-10 md:px-10">
      <div className="mx-auto max-w-6xl space-y-8 text-[var(--theme-text)]">
        <section className="glass-panel rounded-[36px] p-8 md:p-10">
          <p className="section-kicker">Compare</p>
          <h1 className="mt-4 font-display text-4xl uppercase tracking-[0.08em] text-[var(--theme-title)] md:text-5xl">
            You vs {profile.displayName}
          </h1>
          <p className="mt-5 max-w-3xl text-base leading-8 text-[var(--theme-body)]">
            This comparison is built entirely from cached monthly SoundScope history. No live Spotify calls are made for {profile.displayName}&apos;s account when you open this page.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href={`/social/${spotifyUserId}`} className="pixel-chip text-[var(--theme-text)] transition hover:text-[#2d0d46]">
              Open profile
            </Link>
            <Link href="/social" className="pixel-chip text-[var(--theme-text)] transition hover:text-[#2d0d46]">
              Back to social
            </Link>
          </div>
        </section>

        {comparison ? (
          <section className="grid gap-5 md:grid-cols-3">
            <div className="desktop-card p-5">
              <p className="font-mono text-sm uppercase tracking-[0.16em] text-[var(--theme-muted)]">Compatibility</p>
              <p className="mt-3 font-display text-4xl uppercase tracking-[0.08em] text-[var(--theme-title)]">{comparison.compatibilityScore}%</p>
            </div>
            <div className="desktop-card p-5 md:col-span-2">
              <p className="font-mono text-sm uppercase tracking-[0.16em] text-[var(--theme-muted)]">Summary</p>
              <p className="mt-3 text-base leading-8 text-[var(--theme-body)]">{comparison.summary}</p>
            </div>
          </section>
        ) : (
          <section className="desktop-card p-6 md:p-8 text-sm leading-7 text-[var(--theme-body)]">
            Top-list comparison is unavailable because one side does not have enough shared cache history or the other profile is not sharing rankings.
          </section>
        )}

        <section className="grid gap-5 lg:grid-cols-2">
          <div className="glass-panel rounded-[30px] p-6">
            <p className="section-kicker">You</p>
            <h2 className="mt-2 font-display text-3xl uppercase tracking-[0.08em] text-[var(--theme-title)]">Your month snapshot</h2>
            <div className="mt-5 space-y-3">
              <div className="desktop-card p-4">Recent listening: {yourSummary?.recentListening ?? "Unavailable"}</div>
              <div className="desktop-card p-4">Top artist: {yourSummary?.topArtist ?? "Unavailable"}</div>
              <div className="desktop-card p-4">Top track: {yourSummary?.topTrack ?? "Unavailable"}</div>
              <div className="desktop-card p-4">Mood leaders: {yourSummary?.moodLeaders.map((entry) => entry.mood).join(", ") || "Unavailable"}</div>
            </div>
          </div>

          <div className="glass-panel rounded-[30px] p-6">
            <p className="section-kicker">{profile.displayName}</p>
            <h2 className="mt-2 font-display text-3xl uppercase tracking-[0.08em] text-[var(--theme-title)]">Shared month snapshot</h2>
            <div className="mt-5 space-y-3">
              <div className="desktop-card p-4">Recent listening: {theirSummary?.recentListening ?? "Private or unavailable"}</div>
              <div className="desktop-card p-4">Top artist: {theirSummary?.topArtist ?? "Private or unavailable"}</div>
              <div className="desktop-card p-4">Top track: {theirSummary?.topTrack ?? "Private or unavailable"}</div>
              <div className="desktop-card p-4">Mood leaders: {theirSummary?.moodLeaders.map((entry) => entry.mood).join(", ") || "Private or unavailable"}</div>
            </div>
          </div>
        </section>

        {comparison ? (
          <section className="grid gap-5 lg:grid-cols-2">
            <div className="glass-panel rounded-[30px] p-6">
              <p className="section-kicker">Shared artists</p>
              <div className="mt-4 space-y-3">
                {comparison.sharedArtists.length > 0 ? comparison.sharedArtists.map((artist) => (
                  <div key={artist.name} className="desktop-card flex items-center justify-between p-4">
                    <p className="font-display text-xl uppercase tracking-[0.08em] text-[var(--theme-title)]">{artist.name}</p>
                    <p className="font-mono text-sm uppercase tracking-[0.16em] text-[var(--theme-highlight)]">You #{artist.yourRank} · Them #{artist.theirRank}</p>
                  </div>
                )) : <div className="desktop-card p-4">No shared artists showed up in the cached top lists.</div>}
              </div>
            </div>
            <div className="glass-panel rounded-[30px] p-6">
              <p className="section-kicker">Shared tracks</p>
              <div className="mt-4 space-y-3">
                {comparison.sharedTracks.length > 0 ? comparison.sharedTracks.map((track) => (
                  <div key={`${track.title}-${track.artist}`} className="desktop-card p-4">
                    <p className="font-display text-xl uppercase tracking-[0.08em] text-[var(--theme-title)]">{track.title}</p>
                    <p className="mt-1 text-sm text-[var(--theme-body)]">{track.artist}</p>
                    <p className="mt-2 font-mono text-sm uppercase tracking-[0.16em] text-[var(--theme-highlight)]">You #{track.yourRank} · Them #{track.theirRank}</p>
                  </div>
                )) : <div className="desktop-card p-4">No shared tracks showed up in the cached top lists.</div>}
              </div>
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
