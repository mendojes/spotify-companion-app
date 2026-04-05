import Link from "next/link";
import { Disc3, LogOut, RefreshCcw, Settings2, Sparkles, Users } from "lucide-react";
import { redirect } from "next/navigation";
import { DashboardView } from "@/components/dashboard-view";
import { NowPlayingPanel } from "@/components/now-playing-panel";
import { SpotifyComplianceNote } from "@/components/spotify-compliance-note";
import { ThemeToggle } from "@/components/theme-toggle";
import { getAuthorizedSession, refreshSession, requireSession } from "@/lib/auth";
import { syncConnectedUserSession } from "@/lib/connected-users";
import { getDashboardInsightsFromSnapshots, getDashboardInsightsLive, getSharedDashboardCacheSnapshots } from "@/lib/spotify-dashboard";
import { getSpotifyTopListsFromSnapshots, getSpotifyTopListsLive } from "@/lib/spotify-toplists";
import { DashboardRange, TopListRange } from "@/lib/types";

type DashboardPageProps = {
  searchParams: Promise<{ range?: string; topRange?: string; topFrom?: string; topTo?: string; refreshed?: string; refresh_error?: string }>;
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

  return "Unknown Spotify error";
}

function isSpotifyUnauthorized(error: unknown) {
  const message = getErrorMessage(error);
  return message.includes("Spotify request failed: 401") || message.includes("Spotify token refresh failed: 401");
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

function topListsNeedEnrichment(topLists?: { artists: Array<{ genres: string[] }>; albums: Array<unknown> }) {
  if (!topLists) {
    return true;
  }

  return topLists.artists.some((artist) => artist.genres.length === 0) || topLists.albums.length < 5;
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

  let activeSession = await getAuthorizedSession(session);

  try {
    await syncConnectedUserSession(activeSession);
  } catch {
    // Keep dashboard access working even if connected-user persistence is temporarily unavailable.
  }

  const { range, topRange, topFrom, topTo, refreshed, refresh_error: refreshErrorFlag } = await searchParams;
  const selectedRange = normalizeRange(range);
  const selectedTopRange = normalizeTopRange(topRange);
  const selectedTopFrom = normalizeDate(topFrom);
  const selectedTopTo = normalizeDate(topTo);
  const selectedHeroRange = dashboardRangeToTopListRange(selectedRange);

  let insights;
  let topLists;
  let heroTopLists;
  let dashboardError: string | null = null;
  let topListsError: string | null = null;

  async function loadLiveDashboardData() {
    return Promise.all([
      getDashboardInsightsLive(activeSession.accessToken, activeSession.spotifyUserId, selectedRange),
      getSpotifyTopListsLive(activeSession.accessToken, selectedTopRange, undefined, selectedTopFrom, selectedTopTo),
      getSpotifyTopListsLive(activeSession.accessToken, selectedHeroRange),
    ]);
  }

  const cachedSnapshots = await settleCacheLoad("dashboard cache", () => getSharedDashboardCacheSnapshots(activeSession.spotifyUserId, activeSession.accessToken));

  if (cachedSnapshots.value && cachedSnapshots.value.length > 0) {
    insights = (await getDashboardInsightsFromSnapshots(cachedSnapshots.value, selectedRange)) ?? undefined;
    topLists = (await getSpotifyTopListsFromSnapshots(cachedSnapshots.value, selectedTopRange, undefined, selectedTopFrom, selectedTopTo)) ?? undefined;
    heroTopLists = (await getSpotifyTopListsFromSnapshots(cachedSnapshots.value, selectedHeroRange)) ?? undefined;
  }

  const cacheErrors = [cachedSnapshots.error].filter((value): value is string => Boolean(value));
  const incompleteTopLists = topListsNeedEnrichment(topLists);
  const incompleteHeroTopLists = topListsNeedEnrichment(heroTopLists);
  const missingCachedSections = [!insights ? "insights" : null, !topLists ? "top lists" : null, !heroTopLists ? "hero top lists" : null].filter(
    (value): value is string => Boolean(value),
  );
  const neededLiveFallback = missingCachedSections.length > 0 || incompleteTopLists || incompleteHeroTopLists;

  if (neededLiveFallback) {
    try {
      const [liveInsights, liveTopLists, liveHeroTopLists] = await loadLiveDashboardData();
      insights ??= liveInsights;
      if (!topLists || incompleteTopLists) {
        topLists = liveTopLists;
      }
      if (!heroTopLists || incompleteHeroTopLists) {
        heroTopLists = liveHeroTopLists;
      }

      if (cacheErrors.length > 0) {
        dashboardError = `Some cached dashboard data could not be loaded, so SoundScope is filling the gaps from live Spotify data for this page load. (${cacheErrors.join("; ")})`;
      } else {
        const reasons = [
          ...missingCachedSections,
          incompleteTopLists ? "top-list metadata" : null,
          incompleteHeroTopLists ? "hero top-list metadata" : null,
        ].filter((value): value is string => Boolean(value));
        dashboardError = `Cached dashboard data is incomplete for ${reasons.join(", ")}, so SoundScope is filling those sections from live Spotify data for this page load.`;
      }
    } catch (liveError) {
      if (isSpotifyUnauthorized(liveError)) {
        try {
          activeSession = await refreshSession(activeSession);
          try {
            await syncConnectedUserSession(activeSession);
          } catch {
            // Ignore persistence failure during retry refresh as well.
          }

          const [liveInsights, liveTopLists, liveHeroTopLists] = await loadLiveDashboardData();
          insights ??= liveInsights;
          if (!topLists || incompleteTopLists) {
            topLists = liveTopLists;
          }
          if (!heroTopLists || incompleteHeroTopLists) {
            heroTopLists = liveHeroTopLists;
          }

          dashboardError = cacheErrors.length > 0 || missingCachedSections.length > 0
            ? `Cached dashboard data could not fully load, and Spotify required a token refresh before the live fallback could fill the remaining sections. (${cacheErrors.join("; ") || missingCachedSections.join(", ")})`
            : "Spotify required a token refresh before the dashboard could finish loading.";
        } catch (refreshRetryError) {
          dashboardError = `Cached dashboard data could not be loaded right now, and the live Spotify fallback also failed after retrying your session token, so the dashboard is showing preview fallback sections. (${getErrorMessage(refreshRetryError)})`;
        }
      } else {
        dashboardError = `Cached dashboard data could not be loaded right now, and the live Spotify fallback also failed, so the dashboard is showing preview fallback sections. (${getErrorMessage(liveError)})`;
      }
    }
  }

  return (
    <main className="city-pop-shell relative overflow-hidden pb-10">
      <nav className="sticky top-0 z-40 border-b-[3px] border-[rgba(44,12,70,0.9)] bg-[rgba(255,240,253,0.74)] px-6 py-4 backdrop-blur-2xl md:px-10">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="neon-outline flex h-14 w-14 items-center justify-center rounded-[20px] border-[3px] border-[rgba(44,12,70,0.9)] bg-[linear-gradient(135deg,#fff8ff,#ff97e8_44%,#87f2ff)] font-display text-lg font-bold uppercase tracking-[0.18em] text-[#2d0d46]">
              SS
            </div>
            <div>
              <p className="font-display text-2xl uppercase tracking-[0.14em] text-[var(--theme-title)] md:text-3xl">SoundScope</p>
              <p className="font-mono text-lg uppercase tracking-[0.24em] text-[var(--theme-muted)]">pastel listening desktop</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <ThemeToggle />
            <Link href="/social" className="pixel-chip inline-flex items-center gap-2 text-[var(--theme-text)] transition hover:text-[#2d0d46]">
              <Users className="h-4 w-4" /> Social
            </Link>
            <Link href="/settings" className="pixel-chip inline-flex items-center gap-2 text-[var(--theme-text)] transition hover:text-[#2d0d46]">
              <Settings2 className="h-4 w-4" /> Settings
            </Link>
            <Link href="/privacy" className="pixel-chip inline-flex items-center gap-2 text-[var(--theme-text)] transition hover:text-[#2d0d46]">
              <Sparkles className="h-4 w-4" /> Privacy
            </Link>
            <a href={`/api/dashboard/refresh?range=${selectedRange}`} className="pixel-chip inline-flex items-center gap-2 text-[var(--theme-text)] transition hover:text-[#2d0d46]">
              <RefreshCcw className="h-4 w-4" /> Refresh snapshot
            </a>
            <div className="hidden desktop-card px-4 py-2 text-right md:block">
              <p className="text-sm text-[var(--theme-title)]">{activeSession.displayName}</p>
            </div>
            <a href="/api/auth/logout" className="pixel-chip inline-flex items-center gap-2 text-[var(--theme-text)] transition hover:text-[#2d0d46]">
              <LogOut className="h-4 w-4" /> Log out
            </a>
          </div>
        </div>
      </nav>

      <div className="px-6 pt-5 md:px-10">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 text-[var(--theme-text)]">
          <div className="sticker-badge inline-flex items-center gap-2 px-4 py-2 font-mono text-sm uppercase tracking-[0.16em]">
            <Disc3 className="h-4 w-4 text-[var(--theme-accent)]" /> live archive
          </div>
          <div className="sticker-badge inline-flex items-center gap-2 px-4 py-2 font-mono text-sm uppercase tracking-[0.16em]">
            <Sparkles className="h-4 w-4 text-[var(--theme-highlight)]" /> image-first mode
          </div>
        </div>
      </div>

      <div className="space-y-4 px-6 pt-6 md:px-10">
        {refreshed ? <Notice tone="cyan">Spotify snapshot refreshed successfully.</Notice> : null}
        {refreshErrorFlag ? <Notice tone="coral">Snapshot refresh failed. The dashboard is still using your previous cached data when available.</Notice> : null}
        {dashboardError ? <Notice tone="gold">{dashboardError}</Notice> : null}
        {topListsError ? <Notice tone="gold">{topListsError}</Notice> : null}
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







