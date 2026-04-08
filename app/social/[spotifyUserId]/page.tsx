import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { getCommunityUserProfile } from "@/lib/connected-users";
import { getDashboardInsightsFromHistory } from "@/lib/spotify-dashboard";
import { getSpotifyTopListsFromHistory } from "@/lib/spotify-toplists";
import { getListeningSnapshotSummary } from "@/lib/social";
import { DashboardRange, TopListRange } from "@/lib/types";
import { formatPstDateTime, PST_TIME_ZONE } from "@/lib/time";

type SocialProfilePageProps = {
  params: Promise<{ spotifyUserId: string }>;
  searchParams: Promise<{ range?: string; topRange?: string }>;
};

function normalizeRange(range?: string): DashboardRange {
  if (range === "week" || range === "month" || range === "all") {
    return range;
  }

  return "month";
}

function normalizeTopRange(range?: string): TopListRange {
  if (range === "week" || range === "month" || range === "year" || range === "all") {
    return range;
  }

  return "month";
}

function formatCachedAt(value?: string) {
  if (!value) {
    return null;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: PST_TIME_ZONE,
  }).format(new Date(value)) + " PT";
}

export default async function SocialProfilePage({ params, searchParams }: SocialProfilePageProps) {
  await requireSession();

  const { spotifyUserId } = await params;
  const { range, topRange } = await searchParams;
  const selectedRange = normalizeRange(range);
  const selectedTopRange = normalizeTopRange(topRange);

  const profile = await getCommunityUserProfile(spotifyUserId);
  if (!profile) {
    notFound();
  }

  const [insights, topLists] = await Promise.all([
    profile.privacy.shareListeningActivity ? getDashboardInsightsFromHistory(spotifyUserId, selectedRange) : Promise.resolve(null),
    profile.privacy.shareTopLists ? getSpotifyTopListsFromHistory(spotifyUserId, selectedTopRange, 5) : Promise.resolve(null),
  ]);

  const summary = getListeningSnapshotSummary(insights);
  const cachedAtLabel = formatCachedAt(summary?.cachedAt ?? topLists?.generatedAt ?? profile.lastSnapshotAt);

  return (
    <main className="city-pop-shell min-h-screen px-6 py-10 md:px-10">
      <div className="mx-auto max-w-6xl space-y-8 text-[var(--theme-text)]">
        <section className="glass-panel rounded-[36px] p-8 md:p-10">
          <p className="section-kicker">Public profile</p>
          <h1 className="mt-4 font-display text-4xl uppercase tracking-[0.08em] text-[var(--theme-title)] md:text-5xl">
            {profile.displayName}
          </h1>
          <p className="mt-5 max-w-3xl text-base leading-8 text-[var(--theme-body)]">
            This view is built from cached SoundScope history only. It respects the owner&apos;s sharing settings, so sections disappear when they are not opted in.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href={`/social/${spotifyUserId}/compare`} className="pixel-chip text-[var(--theme-text)] transition hover:text-[#2d0d46]">
              Compare with me
            </Link>
            <Link href="/social" className="pixel-chip text-[var(--theme-text)] transition hover:text-[#2d0d46]">
              Back to social
            </Link>
          </div>
          {cachedAtLabel ? <p className="mt-5 text-sm text-[var(--theme-muted)]">Latest shared cache: {cachedAtLabel}</p> : null}
        </section>

        {summary ? (
          <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            <div className="desktop-card p-5">
              <p className="font-mono text-sm uppercase tracking-[0.16em] text-[var(--theme-muted)]">Recent listening</p>
              <p className="mt-3 font-display text-3xl uppercase tracking-[0.08em] text-[var(--theme-title)]">{summary.recentListening ?? "Unavailable"}</p>
              <p className="mt-2 text-sm text-[var(--theme-body)]">{summary.recentListeningDetail ?? "Cached summary unavailable"}</p>
            </div>
            <div className="desktop-card p-5">
              <p className="font-mono text-sm uppercase tracking-[0.16em] text-[var(--theme-muted)]">Top artist</p>
              <p className="mt-3 font-display text-3xl uppercase tracking-[0.08em] text-[var(--theme-title)]">{summary.topArtist ?? "Unavailable"}</p>
            </div>
            <div className="desktop-card p-5">
              <p className="font-mono text-sm uppercase tracking-[0.16em] text-[var(--theme-muted)]">Top track</p>
              <p className="mt-3 font-display text-3xl uppercase tracking-[0.08em] text-[var(--theme-title)]">{summary.topTrack ?? "Unavailable"}</p>
            </div>
            <div className="desktop-card p-5">
              <p className="font-mono text-sm uppercase tracking-[0.16em] text-[var(--theme-muted)]">Snapshots</p>
              <p className="mt-3 font-display text-3xl uppercase tracking-[0.08em] text-[var(--theme-title)]">{summary.snapshotCount ?? 0}</p>
            </div>
          </section>
        ) : (
          <section className="desktop-card p-6 md:p-8 text-sm leading-7 text-[var(--theme-body)]">
            {profile.displayName} is not sharing listening-pattern summaries right now.
          </section>
        )}

        {summary?.moodLeaders?.length ? (
          <section className="grid gap-5 lg:grid-cols-2">
            <div className="glass-panel rounded-[30px] p-6">
              <p className="section-kicker">Mood balance</p>
              <h2 className="mt-2 font-display text-3xl uppercase tracking-[0.08em] text-[var(--theme-title)]">Shared mood leaders</h2>
              <div className="mt-5 space-y-4">
                {summary.moodLeaders.map((entry) => (
                  <div key={entry.mood} className="desktop-card flex items-center justify-between p-4">
                    <p className="font-display text-2xl uppercase tracking-[0.08em] text-[var(--theme-title)]">{entry.mood}</p>
                    <p className="font-mono text-lg uppercase tracking-[0.16em] text-[var(--theme-highlight)]">{entry.share}%</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="glass-panel rounded-[30px] p-6">
              <p className="section-kicker">Genre pulse</p>
              <h2 className="mt-2 font-display text-3xl uppercase tracking-[0.08em] text-[var(--theme-title)]">Recurring lanes</h2>
              <div className="mt-5 space-y-4">
                {summary.genrePulse.map((entry) => (
                  <div key={entry.genre} className="desktop-card flex items-center justify-between p-4">
                    <p className="font-display text-2xl uppercase tracking-[0.08em] text-[var(--theme-title)]">{entry.genre}</p>
                    <p className="font-mono text-lg uppercase tracking-[0.16em] text-[var(--theme-highlight)]">{entry.hours.toFixed(1)}h</p>
                  </div>
                ))}
              </div>
            </div>
          </section>
        ) : null}

        {topLists ? (
          <section className="grid gap-5 lg:grid-cols-3">
            <div className="glass-panel rounded-[30px] p-6">
              <p className="section-kicker">Top artists</p>
              <div className="mt-4 space-y-3">
                {topLists.artists.map((artist) => (
                  <div key={artist.id} className="desktop-card flex items-center justify-between p-4">
                    <p className="font-display text-xl uppercase tracking-[0.08em] text-[var(--theme-title)]">{artist.name}</p>
                    <p className="font-mono text-lg uppercase text-[var(--theme-highlight)]">#{artist.rank}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="glass-panel rounded-[30px] p-6">
              <p className="section-kicker">Top tracks</p>
              <div className="mt-4 space-y-3">
                {topLists.tracks.map((track) => (
                  <div key={track.id} className="desktop-card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-display text-xl uppercase tracking-[0.08em] text-[var(--theme-title)]">{track.title}</p>
                        <p className="mt-1 text-sm text-[var(--theme-body)]">{track.artist}</p>
                      </div>
                      <p className="font-mono text-lg uppercase text-[var(--theme-highlight)]">#{track.rank}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="glass-panel rounded-[30px] p-6">
              <p className="section-kicker">Top albums</p>
              <div className="mt-4 space-y-3">
                {topLists.albums.map((album) => (
                  <div key={album.id} className="desktop-card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-display text-xl uppercase tracking-[0.08em] text-[var(--theme-title)]">{album.name}</p>
                        <p className="mt-1 text-sm text-[var(--theme-body)]">{album.artist}</p>
                      </div>
                      <p className="font-mono text-lg uppercase text-[var(--theme-highlight)]">#{album.rank}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        ) : (
          <section className="desktop-card p-6 md:p-8 text-sm leading-7 text-[var(--theme-body)]">
            {profile.displayName} is not sharing top-list rankings right now.
          </section>
        )}
      </div>
    </main>
  );
}
