import { getDatabase, hasMongoConfig } from "@/lib/mongodb";
import { getStoredTopListsSection, hydrateTopListsDataArtistsWithStoredMetadata } from "@/lib/dashboard-section-cache";
import { getDashboardInsightsFromSnapshots, getSharedDashboardCacheSnapshots } from "@/lib/spotify-dashboard";
import { invalidateDashboardPlaylistPreviewCache, getDashboardPlaylistInsightPreview } from "@/lib/spotify-playlists";
import { getCachedValue, invalidateCachedValue } from "@/lib/runtime-cache";
import { getSpotifyTopListsFromHistory, getSpotifyTopListsFromHistoryData, getTopListHistoryData, hydrateTopListsDataMetadata, invalidateTopListHistoryCache, normalizeTopListsDataRanking } from "@/lib/spotify-toplists";
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

type StoredArtistMetadataRecord = {
  artistId: string;
  genres: string[];
  imageUrl?: string;
};

function logOverviewTiming(spotifyUserId: string, step: string, startedAt: number) {
  console.log(`[dashboard] user=${spotifyUserId} step=${step} elapsedMs=${Date.now() - startedAt}`);
}

function logOverviewWriteTiming(spotifyUserId: string, step: string, startedAt: number) {
  console.log(`[dashboard-overview-write] user=${spotifyUserId} step=${step} elapsedMs=${Date.now() - startedAt}`);
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

async function getStoredArtistMetadataMapForOverview(artistIds: string[]) {
  const uniqueArtistIds = [...new Set(artistIds.filter(Boolean))];
  if (!hasMongoConfig() || uniqueArtistIds.length === 0) {
    return new Map<string, StoredArtistMetadataRecord>();
  }

  const db = await getDatabase();
  if (!db) {
    return new Map<string, StoredArtistMetadataRecord>();
  }

  const records = await db
    .collection<StoredArtistMetadataRecord>("spotify_artist_metadata")
    .find({ artistId: { $in: uniqueArtistIds } })
    .toArray();

  return new Map(records.map((record) => [record.artistId, record]));
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
    ? (stored.topListsByRange[selectedTopRange] ? normalizeTopListsDataRanking(stored.topListsByRange[selectedTopRange] as TopListsData) : null)
    : null;
  const heroTopLists = selectedHeroRange !== "custom"
    ? (
      stored.heroTopListsByRange[selectedRange]
        ? normalizeTopListsDataRanking(stored.heroTopListsByRange[selectedRange] as TopListsData)
        : stored.topListsByRange[selectedHeroRange]
          ? normalizeTopListsDataRanking(stored.topListsByRange[selectedHeroRange] as TopListsData)
          : null
    )
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

function hasCompleteStoredOverview(
  storedOverview: DashboardOverviewData | null,
  selectedTopRange: TopListRange,
  selectedTopFrom?: string,
  selectedTopTo?: string,
) {
  if (!storedOverview?.insights) {
    return false;
  }

  const needsCustomTopLists = selectedTopRange === "custom" || Boolean(selectedTopFrom || selectedTopTo);
  const hasTopLists = needsCustomTopLists ? true : Boolean(storedOverview.topLists);

  return hasTopLists && Boolean(storedOverview.heroTopLists);
}

export async function writeStoredDashboardOverviewCache(
  spotifyUserId: string,
  accessToken?: string,
  prioritizedRange?: DashboardRange,
  options?: { allowLiveEnrichment?: boolean },
) {
  if (!hasMongoConfig()) {
    return;
  }

  const totalStart = Date.now();
  const existingStart = Date.now();
  const existingStored = await readStoredDashboardOverviewCache(spotifyUserId);
  logOverviewWriteTiming(spotifyUserId, "read-existing", existingStart);
  const snapshotsStart = Date.now();
  const snapshotRange = prioritizedRange && options?.allowLiveEnrichment === false ? prioritizedRange : "all";
  const snapshots = await getSharedDashboardCacheSnapshots(spotifyUserId, snapshotRange);
  logOverviewWriteTiming(spotifyUserId, "load-snapshots", snapshotsStart);
  const rangesToBuild = prioritizedRange ? [prioritizedRange] : DASHBOARD_RANGE_VALUES;
  const topRangesToBuild = prioritizedRange
    ? [...new Set<TopListRange>(["week", heroRangeToTopRange(prioritizedRange)])].filter((range): range is Exclude<TopListRange, "custom"> => range !== "custom")
    : TOP_LIST_RANGE_VALUES;
  const historyPreviewStart = Date.now();
  const [topListHistory, playlistPreview] = await Promise.all([
    getTopListHistoryData(spotifyUserId),
    getDashboardPlaylistInsightPreview(spotifyUserId),
  ]);
  logOverviewWriteTiming(spotifyUserId, "history-preview", historyPreviewStart);

  const insightsStart = Date.now();
  const insightsByRangeEntries = await Promise.all(
    rangesToBuild.map(async (range) => {
      const rangeAccessToken =
        options?.allowLiveEnrichment !== false && accessToken && prioritizedRange === range
          ? accessToken
          : undefined;
      const insights = snapshots.length > 0
        ? await getDashboardInsightsFromSnapshots(
          snapshots,
          range,
          rangeAccessToken,
          spotifyUserId,
          {
            includeLivePlaylistInsights: false,
            includePublicTagFallback: false,
            includeArtistGenreBackfill: options?.allowLiveEnrichment !== false,
          },
        )
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
  logOverviewWriteTiming(spotifyUserId, "insights", insightsStart);

  const topListsStart = Date.now();
  const topListsByRangeEntries = await Promise.all(
    topRangesToBuild.map(async (range) => [
      range,
      await getSpotifyTopListsFromHistoryData(topListHistory, range),
    ] as const),
  );
  logOverviewWriteTiming(spotifyUserId, "top-lists", topListsStart);

  const nextInsightsByRange = Object.fromEntries(
    insightsByRangeEntries.filter((entry): entry is readonly [DashboardRange, DashboardInsights] => Boolean(entry[1])),
  ) as Partial<Record<DashboardRange, DashboardInsights>>;
  const nextTopListsByRange = Object.fromEntries(
    topListsByRangeEntries.filter((entry): entry is readonly [Exclude<TopListRange, "custom">, TopListsData] => Boolean(entry[1])),
  ) as Partial<Record<Exclude<TopListRange, "custom">, TopListsData>>;
  const insightsByRange = {
    ...(existingStored?.insightsByRange ?? {}),
    ...nextInsightsByRange,
  } satisfies Partial<Record<DashboardRange, DashboardInsights>>;
  const topListsByRange = {
    ...(existingStored?.topListsByRange ?? {}),
    ...nextTopListsByRange,
  } satisfies Partial<Record<Exclude<TopListRange, "custom">, TopListsData>>;
  const heroTopListsByRange = {
    ...(existingStored?.heroTopListsByRange ?? {}),
    ...Object.fromEntries(
      rangesToBuild
        .map((range) => [range, topListsByRange[heroRangeToTopRange(range)]])
        .filter((entry): entry is [DashboardRange, TopListsData] => Boolean(entry[1])),
    ),
  } satisfies Partial<Record<DashboardRange, TopListsData>>;

  try {
    const writeStart = Date.now();
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
    logOverviewWriteTiming(spotifyUserId, "write-cache", writeStart);
    logOverviewWriteTiming(spotifyUserId, "total", totalStart);
  } catch {
    return;
  }
}

export async function hydrateStoredDashboardOverviewTopListMetadata(spotifyUserId: string) {
  if (!hasMongoConfig()) {
    return;
  }

  try {
    const db = await getDatabase();
    if (!db) {
      return;
    }

    const stored = await readStoredDashboardOverviewCache(spotifyUserId);
    if (!stored) {
      return;
    }
    const topListHistory = await getTopListHistoryData(spotifyUserId).catch(() => ({ snapshots: [], recentPlays: [] }));

    const artistIds = [
      ...Object.values(stored.topListsByRange ?? {}).flatMap((topLists) => topLists?.artists.map((artist) => artist.id) ?? []),
      ...Object.values(stored.heroTopListsByRange ?? {}).flatMap((topLists) => topLists?.artists.map((artist) => artist.id) ?? []),
    ].filter(Boolean);
    const metadataByArtistId = await getStoredArtistMetadataMapForOverview(artistIds);

    if (metadataByArtistId.size === 0) {
      return;
    }

    let changed = false;
    const topListsByRange = Object.fromEntries(
      await Promise.all(Object.entries(stored.topListsByRange ?? {}).map(async ([range, topLists]) => {
        if (!topLists) {
          return [range, topLists];
        }

        const artistHydrated = hydrateTopListsDataArtistsWithStoredMetadata(normalizeTopListsDataRanking(topLists), metadataByArtistId);
        const hydrated = await hydrateTopListsDataMetadata(artistHydrated, topListHistory.recentPlays, topListHistory.snapshots).catch(() => artistHydrated);
        if (hydrated !== topLists) {
          changed = true;
        }
        return [range, hydrated];
      })),
    ) as StoredDashboardOverviewCache["topListsByRange"];
    const heroTopListsByRange = Object.fromEntries(
      await Promise.all(Object.entries(stored.heroTopListsByRange ?? {}).map(async ([range, topLists]) => {
        if (!topLists) {
          return [range, topLists];
        }

        const artistHydrated = hydrateTopListsDataArtistsWithStoredMetadata(normalizeTopListsDataRanking(topLists), metadataByArtistId);
        const hydrated = await hydrateTopListsDataMetadata(artistHydrated, topListHistory.recentPlays, topListHistory.snapshots).catch(() => artistHydrated);
        if (hydrated !== topLists) {
          changed = true;
        }
        return [range, hydrated];
      })),
    ) as StoredDashboardOverviewCache["heroTopListsByRange"];

    if (!changed) {
      return;
    }

    await db.collection<StoredDashboardOverviewCache>(DASHBOARD_OVERVIEW_COLLECTION).updateOne(
      { spotifyUserId },
      {
        $set: {
          updatedAt: new Date().toISOString(),
          topListsByRange,
          heroTopListsByRange,
        },
      },
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
  accessToken?: string,
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
    const [sectionTopLists, sectionHeroTopLists] = await Promise.all([
      selectedTopRange === "custom" || selectedTopFrom || selectedTopTo
        ? Promise.resolve(null)
        : getStoredTopListsSection(spotifyUserId, selectedTopRange).catch(() => null),
      selectedHeroRange === "custom"
        ? Promise.resolve(null)
        : getStoredTopListsSection(spotifyUserId, selectedHeroRange).catch(() => null),
    ]);
    const mergedStoredOverview = storedOverview
      ? {
        ...storedOverview,
        topLists: sectionTopLists ?? storedOverview.topLists,
        heroTopLists: sectionHeroTopLists ?? storedOverview.heroTopLists,
      }
      : null;
    logOverviewTiming(spotifyUserId, "overview-stored-cache", storedStart);

    if (mergedStoredOverview && hasCompleteStoredOverview(mergedStoredOverview, selectedTopRange, selectedTopFrom, selectedTopTo)) {
      logOverviewTiming(spotifyUserId, "overview-total", totalStart);
      return mergedStoredOverview;
    }

    const historyStart = Date.now();
    const [topListHistory, playlistPreview] = await Promise.all([
      getTopListHistoryData(spotifyUserId),
      getDashboardPlaylistInsightPreview(spotifyUserId),
    ]);
    logOverviewTiming(spotifyUserId, "overview-history-preview", historyStart);

    const topListsStart = Date.now();
    const [dynamicTopLists, dynamicHeroTopLists] = await Promise.all([
      mergedStoredOverview?.topLists
        ? Promise.resolve(mergedStoredOverview.topLists)
        : selectedTopRange === "custom"
          ? Promise.resolve(null)
          : getSpotifyTopListsFromHistoryData(topListHistory, selectedTopRange, undefined, selectedTopFrom, selectedTopTo),
      mergedStoredOverview?.heroTopLists
        ? Promise.resolve(mergedStoredOverview.heroTopLists)
        : getSpotifyTopListsFromHistoryData(topListHistory, selectedHeroRange),
    ]);
    logOverviewTiming(spotifyUserId, "overview-top-lists", topListsStart);
    logOverviewTiming(spotifyUserId, "overview-total", totalStart);

    return {
      insights: mergedStoredOverview?.insights
        ? {
          ...mergedStoredOverview.insights,
          playlistInsights: mergedStoredOverview.insights.playlistInsights.length > 0 ? mergedStoredOverview.insights.playlistInsights : playlistPreview,
        }
        : null,
      topLists: dynamicTopLists,
      heroTopLists: dynamicHeroTopLists,
    };
  });
}
