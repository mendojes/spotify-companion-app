import Link from "next/link";
import { Disc3 } from "lucide-react";
import { redirect } from "next/navigation";
import { DashboardView } from "@/components/dashboard-view";
import { NowPlayingPanel } from "@/components/now-playing-panel";
import { SpotifyComplianceNote } from "@/components/spotify-compliance-note";
import { AuthorizedSession, getAuthorizedSession, isSessionRefreshFailure, requireSession } from "@/lib/auth";
import { getDashboardInsightsFromSnapshots, getSharedDashboardCacheSnapshots } from "@/lib/spotify-dashboard";
import { getDashboardPlaylistInsights } from "@/lib/spotify-playlists";
import { getSpotifyTopListsFromSnapshots } from "@/lib/spotify-toplists";
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

  let activeSession: AuthorizedSession;

  try {
    activeSession = await getAuthorizedSession(session);
  } catch (error) {
    if (isSessionRefreshFailure(error)) {
      redirect("/login?error=session_refresh_failed");
    }

    throw error;
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







