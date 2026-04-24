import { getDatabase, hasMongoConfig } from "@/lib/mongodb";
import { getDashboardInsightsFromSnapshots, getSharedDashboardCacheSnapshots } from "@/lib/spotify-dashboard";
import { invalidateDashboardPlaylistPreviewCache, getDashboardPlaylistInsightPreview } from "@/lib/spotify-playlists";
import { getCachedValue, invalidateCachedValue } from "@/lib/runtime-cache";
import { getSpotifyTopListsFromHistoryData, getTopListHistoryData, invalidateTopListHistoryCache } from "@/lib/spotify-toplists";
import { DashboardInsights, DashboardRange, TopListRange, TopListsData } from "@/lib/types";

const DASHBOARD_OVERVIEW_TTL_MS = 1000 * 30;
const DASHBOARD_OVERVIEW_COLLECTION = "dashboard_overview_cache";
const DASHBOARD_RANGE_VALUES: DashboardRange[] = ["week", "month", "all"];
const TOP_LIST_RANGE_VALUES: Exclude<TopListRange, "custom">[] = ["week", "month", "year", "all"];

type DashboardOverviewData = {
  insights: DashboardInsights | null;
  topLists: TopListsData | null;
  heroTopLists: TopListsData | null;
};

type StoredDashboardOverviewCache = {
  spotifyUserId: string;
  updatedAt: string;
  insightsByRange: Partial<Record<DashboardRange, DashboardInsights>>;
  topListsByRange: Partial<Record<Exclude<TopListRange, "custom">, TopListsData>>;
  heroTopListsByRange: Partial<Record<DashboardRange, TopListsData>>;
};

function logOverviewTiming(spotifyUserId: string, step: string, startedAt: number) {
  console.log(`[dashboard] user=${spotifyUserId} step=${step} elapsedMs=${Date.now() - startedAt}`);
}

function overviewCacheKey(
  spotifyUserId: string,
  selectedRange: DashboardRange,
  selectedTopRange: TopListRange,
  selectedHeroRange: TopListRange,
  selectedTopFrom?: string,
  selectedTopTo?: string,
) {
  return [
    "dashboard-overview",
    spotifyUserId,
    selectedRange,
    selectedTopRange,
    selectedHeroRange,
    selectedTopFrom ?? "",
    selectedTopTo ?? "",
  ].join(":");
}

function heroRangeToTopRange(range: DashboardRange): Exclude<TopListRange, "custom" | "year"> {
  if (range === "month") {
    return "month";
  }

  if (range === "all") {
    return "all";
  }

  return "week";
}

async function readStoredDashboardOverviewCache(spotifyUserId: string): Promise<StoredDashboardOverviewCache | null> {
  if (!hasMongoConfig()) {
    return null;
  }

  try {
    const db = await getDatabase();
    if (!db) {
      return null;
    }

    return db.collection<StoredDashboardOverviewCache>(DASHBOARD_OVERVIEW_COLLECTION).findOne({ spotifyUserId });
  } catch {
    return null;
  }
}

function resolveStoredOverview(
  stored: StoredDashboardOverviewCache | null,
  selectedRange: DashboardRange,
  selectedTopRange: TopListRange,
  selectedHeroRange: TopListRange,
  selectedTopFrom?: string,
  selectedTopTo?: string,
): DashboardOverviewData | null {
  if (!stored) {
    return null;
  }

  const insights = stored.insightsByRange[selectedRange] ?? null;
  const topLists = !selectedTopFrom && !selectedTopTo && selectedTopRange !== "custom"
    ? stored.topListsByRange[selectedTopRange] ?? null
    : null;
  const heroTopLists = selectedHeroRange !== "custom"
    ? stored.heroTopListsByRange[selectedRange] ?? stored.topListsByRange[selectedHeroRange] ?? null
    : null;

  if (!insights) {
    return null;
  }

  return {
    insights,
    topLists,
    heroTopLists,
  };
}

export async function writeStoredDashboardOverviewCache(spotifyUserId: string) {
  if (!hasMongoConfig()) {
    return;
  }

  const snapshots = await getSharedDashboardCacheSnapshots(spotifyUserId);
  const [topListHistory, playlistPreview] = await Promise.all([
    getTopListHistoryData(spotifyUserId),
    getDashboardPlaylistInsightPreview(spotifyUserId),
  ]);

  const insightsByRangeEntries = await Promise.all(
    DASHBOARD_RANGE_VALUES.map(async (range) => {
      const insights = snapshots.length > 0
        ? await getDashboardInsightsFromSnapshots(snapshots, range, undefined, spotifyUserId)
        : null;

      return [
        range,
        insights
          ? {
            ...insights,
            playlistInsights: playlistPreview,
          }
          : undefined,
      ] as const;
    }),
  );

  const topListsByRangeEntries = await Promise.all(
    TOP_LIST_RANGE_VALUES.map(async (range) => [range, await getSpotifyTopListsFromHistoryData(topListHistory, range)] as const),
  );

  const insightsByRange = Object.fromEntries(
    insightsByRangeEntries.filter((entry): entry is readonly [DashboardRange, DashboardInsights] => Boolean(entry[1])),
  ) as Partial<Record<DashboardRange, DashboardInsights>>;
  const topListsByRange = Object.fromEntries(
    topListsByRangeEntries.filter((entry): entry is readonly [Exclude<TopListRange, "custom">, TopListsData] => Boolean(entry[1])),
  ) as Partial<Record<Exclude<TopListRange, "custom">, TopListsData>>;
  const heroTopListsByRange = Object.fromEntries(
    DASHBOARD_RANGE_VALUES.map((range) => [range, topListsByRange[heroRangeToTopRange(range)]]).filter((entry): entry is [DashboardRange, TopListsData] => Boolean(entry[1])),
  ) as Partial<Record<DashboardRange, TopListsData>>;

  try {
    const db = await getDatabase();
    if (!db) {
      return;
    }

    await db.collection<StoredDashboardOverviewCache>(DASHBOARD_OVERVIEW_COLLECTION).updateOne(
      { spotifyUserId },
      {
        $set: {
          spotifyUserId,
          updatedAt: new Date().toISOString(),
          insightsByRange,
          topListsByRange,
          heroTopListsByRange,
        },
      },
      { upsert: true },
    );
  } catch {
    return;
  }
}

export function invalidateDashboardOverviewRuntimeCache(spotifyUserId: string) {
  DASHBOARD_RANGE_VALUES.forEach((range) => {
    const heroRange = heroRangeToTopRange(range);

    TOP_LIST_RANGE_VALUES.forEach((topRange) => {
      invalidateCachedValue(overviewCacheKey(spotifyUserId, range, topRange, heroRange));
    });
  });

  invalidateTopListHistoryCache(spotifyUserId);
  invalidateDashboardPlaylistPreviewCache(spotifyUserId);
}

export async function getDashboardOverviewData(
  spotifyUserId: string,
  selectedRange: DashboardRange,
  selectedTopRange: TopListRange,
  selectedHeroRange: TopListRange,
  selectedTopFrom?: string,
  selectedTopTo?: string,
): Promise<DashboardOverviewData> {
  const cacheKey = overviewCacheKey(spotifyUserId, selectedRange, selectedTopRange, selectedHeroRange, selectedTopFrom, selectedTopTo);

  return getCachedValue(cacheKey, DASHBOARD_OVERVIEW_TTL_MS, async () => {
    const totalStart = Date.now();

    const storedStart = Date.now();
    const stored = await readStoredDashboardOverviewCache(spotifyUserId);
    const storedOverview = resolveStoredOverview(
      stored,
      selectedRange,
      selectedTopRange,
      selectedHeroRange,
      selectedTopFrom,
      selectedTopTo,
    );
    logOverviewTiming(spotifyUserId, "overview-stored-cache", storedStart);

    if (storedOverview && storedOverview.topLists && storedOverview.heroTopLists) {
      logOverviewTiming(spotifyUserId, "overview-total", totalStart);
      return storedOverview;
    }

    const snapshotsStart = Date.now();
    const snapshots = await getSharedDashboardCacheSnapshots(spotifyUserId);
    logOverviewTiming(spotifyUserId, "overview-snapshots", snapshotsStart);

    const historyStart = Date.now();
    const [topListHistory, playlistPreview] = await Promise.all([
      getTopListHistoryData(spotifyUserId),
      getDashboardPlaylistInsightPreview(spotifyUserId),
    ]);
    logOverviewTiming(spotifyUserId, "overview-history-preview", historyStart);

    const insights = storedOverview?.insights ?? (snapshots.length > 0
      ? await getDashboardInsightsFromSnapshots(snapshots, selectedRange, undefined, spotifyUserId)
      : null);

    const topListsStart = Date.now();
    const [dynamicTopLists, dynamicHeroTopLists] = await Promise.all([
      storedOverview?.topLists
        ? Promise.resolve(storedOverview.topLists)
        : getSpotifyTopListsFromHistoryData(topListHistory, selectedTopRange, undefined, selectedTopFrom, selectedTopTo),
      storedOverview?.heroTopLists
        ? Promise.resolve(storedOverview.heroTopLists)
        : getSpotifyTopListsFromHistoryData(topListHistory, selectedHeroRange),
    ]);
    logOverviewTiming(spotifyUserId, "overview-top-lists", topListsStart);
    logOverviewTiming(spotifyUserId, "overview-total", totalStart);

    return {
      insights: insights
        ? {
          ...insights,
          playlistInsights: insights.playlistInsights.length > 0 ? insights.playlistInsights : playlistPreview,
        }
        : null,
      topLists: dynamicTopLists,
      heroTopLists: dynamicHeroTopLists,
    };
  });
}
