import { getDashboardInsightsFromSnapshots, getSharedDashboardCacheSnapshots } from "@/lib/spotify-dashboard";
import { getDashboardPlaylistInsightPreview } from "@/lib/spotify-playlists";
import { getCachedValue } from "@/lib/runtime-cache";
import { getSpotifyTopListsFromHistoryData, getTopListHistoryData } from "@/lib/spotify-toplists";
import { DashboardInsights, DashboardRange, TopListRange, TopListsData } from "@/lib/types";

const DASHBOARD_OVERVIEW_TTL_MS = 1000 * 30;

type DashboardOverviewData = {
  insights: DashboardInsights | null;
  topLists: TopListsData | null;
  heroTopLists: TopListsData | null;
};

function logOverviewTiming(spotifyUserId: string, step: string, startedAt: number) {
  console.log(`[dashboard] user=${spotifyUserId} step=${step} elapsedMs=${Date.now() - startedAt}`);
}

export async function getDashboardOverviewData(
  spotifyUserId: string,
  selectedRange: DashboardRange,
  selectedTopRange: TopListRange,
  selectedHeroRange: TopListRange,
  selectedTopFrom?: string,
  selectedTopTo?: string,
): Promise<DashboardOverviewData> {
  const cacheKey = [
    "dashboard-overview",
    spotifyUserId,
    selectedRange,
    selectedTopRange,
    selectedHeroRange,
    selectedTopFrom ?? "",
    selectedTopTo ?? "",
  ].join(":");

  return getCachedValue(cacheKey, DASHBOARD_OVERVIEW_TTL_MS, async () => {
    const totalStart = Date.now();

    const snapshotsStart = Date.now();
    const snapshots = await getSharedDashboardCacheSnapshots(spotifyUserId);
    logOverviewTiming(spotifyUserId, "overview-snapshots", snapshotsStart);

    const historyStart = Date.now();
    const [topListHistory, playlistPreview] = await Promise.all([
      getTopListHistoryData(spotifyUserId),
      getDashboardPlaylistInsightPreview(spotifyUserId),
    ]);
    logOverviewTiming(spotifyUserId, "overview-history-preview", historyStart);

    const insightsStart = Date.now();
    const baseInsights = snapshots.length > 0
      ? await getDashboardInsightsFromSnapshots(snapshots, selectedRange, undefined, spotifyUserId)
      : null;
    const insights = baseInsights
      ? {
        ...baseInsights,
        playlistInsights: playlistPreview,
      }
      : null;
    logOverviewTiming(spotifyUserId, "overview-insights", insightsStart);

    const topListsStart = Date.now();
    const [topLists, heroTopLists] = await Promise.all([
      getSpotifyTopListsFromHistoryData(topListHistory, selectedTopRange, undefined, selectedTopFrom, selectedTopTo),
      getSpotifyTopListsFromHistoryData(topListHistory, selectedHeroRange),
    ]);
    logOverviewTiming(spotifyUserId, "overview-top-lists", topListsStart);
    logOverviewTiming(spotifyUserId, "overview-total", totalStart);

    return {
      insights,
      topLists,
      heroTopLists,
    };
  });
}
