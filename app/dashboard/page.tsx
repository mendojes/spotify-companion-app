import Link from "next/link";
import { Disc3, LibraryBig, Sparkles, UserRound } from "lucide-react";
import { redirect } from "next/navigation";
import { DashboardView } from "@/components/dashboard-view";
import { NowPlayingPanel } from "@/components/now-playing-panel";
import { SpotifyComplianceNote } from "@/components/spotify-compliance-note";
import { AuthorizedSession, getAuthorizedSession, hasSpotifyConnection, isSessionRefreshFailure, requireSession } from "@/lib/auth";
import { getPublicSpotifyProfileInsights } from "@/lib/spotify-public";
import { getDashboardInsightsFromSnapshots, getSharedDashboardCacheSnapshots } from "@/lib/spotify-dashboard";
import { getDashboardPlaylistInsights } from "@/lib/spotify-playlists";
import { getSpotifyTopListsFromSnapshots } from "@/lib/spotify-toplists";
import { DashboardRange, TopListRange } from "@/lib/types";

type DashboardPageProps = {
  searchParams: Promise<{ range?: string; topRange?: string; topFrom?: string; topTo?: string; refreshed?: string; refresh_error?: string; welcome?: string; connect_spotify?: string }>;
};

type CacheLoadResult<T> = {
  value: T | null;
  error: string | null;
};

function normalizeRange(range?: string): DashboardRange {
  if (range === "month" || range === "all") {
    return range;
  }

  return "week";
}

function normalizeTopRange(range?: string): TopListRange {
  if (range === "week" || range === "month" || range === "year" || range === "all" || range === "custom") {
    return range;
  }

  return "week";
}

function dashboardRangeToTopListRange(range: DashboardRange): TopListRange {
  if (range === "month") {
    return "month";
  }

  if (range === "all") {
    return "all";
  }

  return "week";
}

function normalizeDate(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return undefined;
  }

  return value;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown error";
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetriableMongoError(error: unknown) {
  const message = getErrorMessage(error).toLowerCase();
  return message.includes("27017") || message.includes("timed out") || message.includes("server selection");
}

async function settleCacheLoad<T>(label: string, loader: () => Promise<T | null>, retries = 1): Promise<CacheLoadResult<T>> {
  try {
    return {
      value: await loader(),
      error: null,
    };
  } catch (error) {
    if (retries > 0 && isRetriableMongoError(error)) {
      await wait(300);
      return settleCacheLoad(label, loader, retries - 1);
    }

    return {
      value: null,
      error: `${label}: ${getErrorMessage(error)}`,
    };
  }
}

function Notice({ tone, children }: { tone: "cyan" | "coral" | "gold"; children: React.ReactNode }) {
  const styles = {
    cyan: "bg-[rgba(229,255,255,0.78)] text-[#3a1a58]",
    coral: "bg-[rgba(255,236,245,0.82)] text-[#3a1a58]",
    gold: "bg-[rgba(255,247,224,0.86)] text-[#3a1a58]",
  };

  return <div className={`mx-auto max-w-7xl rounded-[24px] border-[3px] border-[rgba(44,12,70,0.9)] px-5 py-4 text-sm shadow-glow ${styles[tone]}`}>{children}</div>;
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const session = await requireSession();

  if (!session) {
    redirect("/login");
  }

  const { range, topRange, topFrom, topTo, refreshed, refresh_error: refreshErrorFlag, welcome, connect_spotify: connectSpotify } = await searchParams;

  if (!hasSpotifyConnection(session)) {
    const publicInsights = session.spotifyUserId
      ? await getPublicSpotifyProfileInsights(session.spotifyUserId, session.spotifyProfileUrl).catch(() => null)
      : null;

    return (
      <main className="relative overflow-hidden pb-10">
        <div className="space-y-4 px-6 pt-6 md:px-10">
          {welcome ? <Notice tone="cyan">Your SoundScope account is ready.</Notice> : null}
          {connectSpotify ? <Notice tone="gold">That section needs private Spotify account data, so SoundScope brought you back to the public-profile dashboard.</Notice> : null}
        </div>

        <section className="px-6 py-8 md:px-10">
          <div className="mx-auto max-w-7xl space-y-6">
            <div className="glass-panel rounded-[34px] p-6 text-[var(--theme-text)] md:p-8">
              <p className="section-kicker">Public profile dashboard</p>
              <h1 className="mt-3 font-display text-4xl uppercase tracking-[0.08em] text-[var(--theme-title)] md:text-5xl">Your SoundScope account is using public Spotify data.</h1>
              <p className="mt-5 max-w-2xl text-base leading-8 text-[var(--theme-body)]">
                This version is built around what Spotify exposes publicly on your profile page. SoundScope reads your public profile identity, recently played artists when Spotify shows them, and insight cards from your public playlists.
              </p>
              <div className="mt-6 space-y-3 rounded-[28px] border-[3px] border-[rgba(44,12,70,0.18)] bg-white/[0.42] p-5">
                <p className="font-display text-2xl uppercase tracking-[0.08em] text-[var(--theme-title)]">{session.displayName}</p>
                <p className="text-sm text-[var(--theme-body)]">{session.email}</p>
                <p className="text-sm leading-7 text-[var(--theme-body)]">
                  Public profile link:{" "}
                  {session.spotifyProfileUrl ? (
                    <a href={session.spotifyProfileUrl} target="_blank" rel="noreferrer" className="underline decoration-[rgba(44,12,70,0.45)] underline-offset-4">
                      {session.spotifyProfileUrl}
                    </a>
                  ) : "Not saved"}
                </p>
              </div>
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <div className="desktop-card p-4">
                  <p className="font-mono text-sm uppercase tracking-[0.16em] text-[var(--theme-muted)]">Public playlists</p>
                  <p className="mt-3 font-display text-3xl uppercase tracking-[0.08em] text-[var(--theme-title)]">{publicInsights?.publicPlaylistCount ?? 0}</p>
                </div>
                <div className="desktop-card p-4">
                  <p className="font-mono text-sm uppercase tracking-[0.16em] text-[var(--theme-muted)]">Recent artists visible</p>
                  <p className="mt-3 font-display text-3xl uppercase tracking-[0.08em] text-[var(--theme-title)]">
                    {publicInsights?.recentArtistsVisible ? `${publicInsights.recentArtists.length} found` : "Not shared"}
                  </p>
                </div>
              </div>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link href="/settings" className="pixel-chip inline-flex items-center gap-2 text-[var(--theme-text)] transition hover:text-[#2d0d46]">
                  Account details
                </Link>
              </div>
            </div>

            {publicInsights ? (
              <div className="space-y-4">
                <div className="glass-panel rounded-[34px] p-6 text-[var(--theme-text)]">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="section-kicker">Public profile</p>
                      <h2 className="mt-2 font-display text-3xl uppercase tracking-[0.08em] text-[var(--theme-title)]">
                        {publicInsights.displayName}
                      </h2>
                      <p className="mt-3 text-sm leading-7 text-[var(--theme-body)]">
                        These sections come only from public Spotify data, so what shows up depends on what Spotify makes visible on the profile.
                      </p>
                    </div>
                    <a href={publicInsights.profileUrl} target="_blank" rel="noreferrer" className="pixel-chip inline-flex items-center gap-2 text-[var(--theme-text)] transition hover:text-[#2d0d46]">
                      Open Spotify profile
                    </a>
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="glass-panel rounded-[34px] p-6 text-[var(--theme-text)]">
                    <div className="flex items-center gap-3">
                      <div className="icon-bubble h-10 w-10 text-[var(--theme-accent)]">
                        <UserRound className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="section-kicker">Recent artists</p>
                        <h3 className="mt-1 font-display text-2xl uppercase tracking-[0.08em] text-[var(--theme-title)]">Public profile activity</h3>
                      </div>
                    </div>
                    <div className="mt-5 space-y-3">
                      {publicInsights.recentArtistsVisible ? publicInsights.recentArtists.map((artist) => (
                        <a
                          key={artist.id}
                          href={artist.spotifyUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="desktop-card flex items-center justify-between gap-4 p-4 transition hover:border-cyan/30"
                        >
                          <p className="font-display text-xl uppercase tracking-[0.08em] text-[var(--theme-title)]">{artist.name}</p>
                          <span className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--theme-muted)]">artist</span>
                        </a>
                      )) : (
                        <div className="desktop-card p-4 text-sm leading-7 text-[var(--theme-body)]">
                          Spotify is not exposing recently played artists on this public profile right now, or the profile page did not include that section.
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="glass-panel rounded-[34px] p-6 text-[var(--theme-text)]">
                    <div className="flex items-center gap-3">
                      <div className="icon-bubble h-10 w-10 text-[var(--theme-highlight)]">
                        <LibraryBig className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="section-kicker">Public playlists</p>
                        <h3 className="mt-1 font-display text-2xl uppercase tracking-[0.08em] text-[var(--theme-title)]">Playlist vibe read</h3>
                      </div>
                    </div>
                    <div className="mt-5 space-y-3">
                      {publicInsights.playlistInsights.length > 0 ? publicInsights.playlistInsights.map((playlist) => (
                        <div key={playlist.id ?? playlist.name} className="desktop-card p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="font-display text-xl uppercase tracking-[0.08em] text-[var(--theme-title)]">{playlist.name}</p>
                              <p className="mt-2 text-sm text-[var(--theme-body)]">{playlist.mood}</p>
                            </div>
                            {playlist.trackCount ? <span className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--theme-muted)]">{playlist.trackCount} tracks</span> : null}
                          </div>
                          <div className="mt-3 space-y-2 text-sm leading-6 text-[var(--theme-body)]">
                            <p>Genres: {playlist.topGenresSummary ?? playlist.diversity}</p>
                            <p>Pattern: {playlist.listeningCadence ?? playlist.overlap}</p>
                          </div>
                        </div>
                      )) : publicInsights.publicPlaylists.length > 0 ? publicInsights.publicPlaylists.map((playlist) => (
                        <div key={playlist.id} className="desktop-card p-4">
                          <p className="font-display text-xl uppercase tracking-[0.08em] text-[var(--theme-title)]">{playlist.name}</p>
                          <p className="mt-2 text-sm text-[var(--theme-body)]">{playlist.tracks.total} visible tracks</p>
                        </div>
                      )) : (
                        <div className="desktop-card p-4 text-sm leading-7 text-[var(--theme-body)]">
                          No public playlists were visible from this Spotify profile.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="glass-panel rounded-[34px] p-6 text-[var(--theme-text)]">
                <div className="flex items-center gap-3">
                  <div className="icon-bubble h-10 w-10 text-[var(--theme-highlight)]">
                    <Sparkles className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="section-kicker">Public data unavailable</p>
                    <h2 className="mt-1 font-display text-2xl uppercase tracking-[0.08em] text-[var(--theme-title)]">SoundScope couldn&apos;t load public Spotify sections for this profile.</h2>
                  </div>
                </div>
                <p className="mt-5 max-w-3xl text-sm leading-7 text-[var(--theme-body)]">
                  The account is still valid, but Spotify may not be exposing enough public profile data for this link right now.
                </p>
              </div>
            )}

            <div className="desktop-card p-4 text-sm leading-7 text-[var(--theme-body)]">
              <Sparkles className="mb-2 h-4 w-4 text-[var(--theme-highlight)]" />
              Public-profile insights are best-effort and depend on what Spotify exposes publicly.
            </div>
          </div>
        </section>
      </main>
    );
  }

  let activeSession: AuthorizedSession;

  try {
    activeSession = await getAuthorizedSession(session);
  } catch (error) {
    if (isSessionRefreshFailure(error)) {
      redirect("/login?error=session_refresh_failed");
    }

    throw error;
  }

  const selectedRange = normalizeRange(range);
  const selectedTopRange = normalizeTopRange(topRange);
  const selectedTopFrom = normalizeDate(topFrom);
  const selectedTopTo = normalizeDate(topTo);
  const selectedHeroRange = dashboardRangeToTopListRange(selectedRange);

  let insights;
  let topLists;
  let heroTopLists;
  let dashboardError: string | null = null;

  const [cachedSnapshots, cachedPlaylistInsights] = await Promise.all([
    settleCacheLoad("dashboard cache", () => getSharedDashboardCacheSnapshots(activeSession.spotifyUserId)),
    settleCacheLoad("playlist insights", () => getDashboardPlaylistInsights(activeSession.spotifyUserId)),
  ]);

  if (cachedSnapshots.value && cachedSnapshots.value.length > 0) {
    insights = (await getDashboardInsightsFromSnapshots(cachedSnapshots.value, selectedRange)) ?? undefined;
    topLists = (await getSpotifyTopListsFromSnapshots(cachedSnapshots.value, selectedTopRange, undefined, selectedTopFrom, selectedTopTo)) ?? undefined;
    heroTopLists = (await getSpotifyTopListsFromSnapshots(cachedSnapshots.value, selectedHeroRange)) ?? undefined;
  }

  if (insights) {
    insights = {
      ...insights,
      playlistInsights: cachedPlaylistInsights.value ?? [],
    };
  }

  const cacheErrors = [cachedSnapshots.error, cachedPlaylistInsights.error].filter((value): value is string => Boolean(value));
  const missingCachedSections = [!insights ? "insights" : null, !topLists ? "top lists" : null, !heroTopLists ? "hero top lists" : null].filter(
    (value): value is string => Boolean(value),
  );

  if (cacheErrors.length > 0) {
    dashboardError = `Cached dashboard data could not be fully loaded right now, so SoundScope is showing the latest stored sections it could find. (${cacheErrors.join("; ")})`;
  } else if (missingCachedSections.length > 0) {
    dashboardError = `Cached dashboard data is missing ${missingCachedSections.join(", ")}. Use Refresh snapshot to update the dashboard.`;
  }

  return (
    <main className="relative overflow-hidden pb-10">
      <div className="space-y-4 px-6 pt-6 md:px-10">
        {refreshed ? <Notice tone="cyan">Spotify snapshot refreshed successfully.</Notice> : null}
        {refreshErrorFlag ? <Notice tone="coral">Snapshot refresh failed. The dashboard is still using your previous cached data when available.</Notice> : null}
        {dashboardError ? <Notice tone="gold">{dashboardError}</Notice> : null}
      </div>

      <DashboardView
        mode="authenticated"
        insights={insights ?? undefined}
        selectedRange={selectedRange}
        topLists={topLists ?? undefined}
        heroTopLists={heroTopLists ?? undefined}
        selectedTopRange={selectedTopRange}
        selectedTopFrom={selectedTopFrom}
        selectedTopTo={selectedTopTo}
        sidebar={<NowPlayingPanel />}
        rediscoveryPagePath="/dashboard/rediscovery"
      />

      <div className="px-6 pb-12 md:px-10">
        <div className="mx-auto max-w-7xl space-y-4">
          <SpotifyComplianceNote />
          <Link href="/" className="pixel-chip inline-flex items-center gap-2 text-[var(--theme-text)] transition hover:text-[#2d0d46]">
            <Disc3 className="h-4 w-4" /> Back to home
          </Link>
        </div>
      </div>
    </main>
  );
}







