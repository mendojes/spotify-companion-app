import { getDatabase, hasMongoConfig } from "@/lib/mongodb";
import { getDashboardAnalysisDetailFromHistory, getDashboardInsightsFromSnapshots, getSharedDashboardCacheSnapshots } from "@/lib/spotify-dashboard";
import { getCachedValue, invalidateCachedValue } from "@/lib/runtime-cache";
import { getPlaylistPageDataFromHistory, PlaylistPageData } from "@/lib/spotify-playlists";
import { FULL_TOP_LIST_LIMIT, getSpotifyTopListsFromHistory } from "@/lib/spotify-toplists";
import { DashboardAnalysisDetail, DashboardInsights, DashboardRange, PlaylistSortOption, TopListRange, TopListsData } from "@/lib/types";

const DASHBOARD_SECTION_RUNTIME_TTL_MS = 1000 * 30;
const DASHBOARD_RANGE_VALUES: DashboardRange[] = ["week", "month", "all"];
const TOP_LIST_RANGE_VALUES: Exclude<TopListRange, "custom">[] = ["week", "month", "year", "all"];
const PLAYLIST_SORT_VALUES: PlaylistSortOption[] = ["created_desc", "created_asc", "last_listened_desc", "last_listened_asc"];

const TOP_LISTS_CACHE_COLLECTION = "dashboard_top_lists_cache";
const ANALYSIS_CACHE_COLLECTION = "dashboard_analysis_cache";
const REDISCOVERY_CACHE_COLLECTION = "dashboard_rediscovery_cache";
const PLAYLISTS_CACHE_COLLECTION = "dashboard_playlists_cache";

type AnalysisSectionKey = `${DashboardRange}:trend` | `${DashboardRange}:heatmap`;
type RediscoverySectionData = Pick<DashboardInsights, "forgottenFavorites" | "quietSavedTracks" | "cachedAt" | "range" | "sourceLabel">;

type StoredTopListsCache = {
  spotifyUserId: string;
  range: Exclude<TopListRange, "custom">;
  updatedAt: string;
  data: TopListsData;
};

type StoredAnalysisCache = {
  spotifyUserId: string;
  key: AnalysisSectionKey;
  updatedAt: string;
  data: DashboardAnalysisDetail;
};

type StoredRediscoveryCache = {
  spotifyUserId: string;
  range: DashboardRange;
  updatedAt: string;
  data: RediscoverySectionData;
};

type StoredPlaylistsCache = {
  spotifyUserId: string;
  sort: PlaylistSortOption;
  updatedAt: string;
  data: PlaylistPageData;
};

function logSectionTiming(spotifyUserId: string, section: string, step: string, startedAt: number) {
  console.log(`[dashboard-section] user=${spotifyUserId} section=${section} step=${step} elapsedMs=${Date.now() - startedAt}`);
}

function sectionRuntimeKey(spotifyUserId: string, section: string, suffix: string) {
  return `dashboard-section:${spotifyUserId}:${section}:${suffix}`;
}

async function readStoredTopListsCache(spotifyUserId: string, range: Exclude<TopListRange, "custom">) {
  if (!hasMongoConfig()) {
    return null;
  }

  try {
    const db = await getDatabase();
    if (!db) {
      return null;
    }

    return db.collection<StoredTopListsCache>(TOP_LISTS_CACHE_COLLECTION).findOne({ spotifyUserId, range });
  } catch {
    return null;
  }
}

async function readStoredAnalysisCache(spotifyUserId: string, key: AnalysisSectionKey) {
  if (!hasMongoConfig()) {
    return null;
  }

  try {
    const db = await getDatabase();
    if (!db) {
      return null;
    }

    return db.collection<StoredAnalysisCache>(ANALYSIS_CACHE_COLLECTION).findOne({ spotifyUserId, key });
  } catch {
    return null;
  }
}

async function readStoredRediscoveryCache(spotifyUserId: string, range: DashboardRange) {
  if (!hasMongoConfig()) {
    return null;
  }

  try {
    const db = await getDatabase();
    if (!db) {
      return null;
    }

    return db.collection<StoredRediscoveryCache>(REDISCOVERY_CACHE_COLLECTION).findOne({ spotifyUserId, range });
  } catch {
    return null;
  }
}

async function readStoredPlaylistsCache(spotifyUserId: string, sort: PlaylistSortOption) {
  if (!hasMongoConfig()) {
    return null;
  }

  try {
    const db = await getDatabase();
    if (!db) {
      return null;
    }

    return db.collection<StoredPlaylistsCache>(PLAYLISTS_CACHE_COLLECTION).findOne({ spotifyUserId, sort });
  } catch {
    return null;
  }
}

export function invalidateDashboardSectionRuntimeCache(spotifyUserId: string) {
  TOP_LIST_RANGE_VALUES.forEach((range) => invalidateCachedValue(sectionRuntimeKey(spotifyUserId, "top-lists", range)));
  DASHBOARD_RANGE_VALUES.forEach((range) => {
    invalidateCachedValue(sectionRuntimeKey(spotifyUserId, "analysis", `${range}:trend`));
    invalidateCachedValue(sectionRuntimeKey(spotifyUserId, "analysis", `${range}:heatmap`));
    invalidateCachedValue(sectionRuntimeKey(spotifyUserId, "rediscovery", range));
  });
  PLAYLIST_SORT_VALUES.forEach((sort) => invalidateCachedValue(sectionRuntimeKey(spotifyUserId, "playlists", sort)));
}

export async function writeStoredDashboardSectionCache(spotifyUserId: string, accessToken?: string) {
  if (!hasMongoConfig()) {
    return;
  }

  const snapshots = await getSharedDashboardCacheSnapshots(spotifyUserId);
  const [topListsEntries, analysisEntries, rediscoveryEntries, playlistsEntries] = await Promise.all([
    Promise.all(
      TOP_LIST_RANGE_VALUES.map(async (range) => [
        range,
        await getSpotifyTopListsFromHistory(spotifyUserId, range, FULL_TOP_LIST_LIMIT, undefined, undefined, accessToken),
      ] as const),
    ),
    Promise.all(
      DASHBOARD_RANGE_VALUES.flatMap((range) => ([
        (async () => [`${range}:trend` as const, await getDashboardAnalysisDetailFromHistory(spotifyUserId, range, { section: "trend" })] as const)(),
        (async () => [`${range}:heatmap` as const, await getDashboardAnalysisDetailFromHistory(spotifyUserId, range, { section: "heatmap" })] as const)(),
      ])),
    ),
    Promise.all(
      DASHBOARD_RANGE_VALUES.map(async (range) => {
        const insights = snapshots.length > 0
          ? await getDashboardInsightsFromSnapshots(snapshots, range, accessToken, spotifyUserId)
          : null;

        return [
          range,
          insights
            ? {
              forgottenFavorites: insights.forgottenFavorites,
              quietSavedTracks: insights.quietSavedTracks,
              cachedAt: insights.cachedAt,
              range: insights.range,
              sourceLabel: insights.sourceLabel,
            }
            : undefined,
        ] as const;
      }),
    ),
    Promise.all(
      PLAYLIST_SORT_VALUES.map(async (sort) => [sort, await getPlaylistPageDataFromHistory(spotifyUserId, sort)] as const),
    ),
  ]);

  try {
    const db = await getDatabase();
    if (!db) {
      return;
    }

    const updatedAt = new Date().toISOString();

    await Promise.all([
      topListsEntries.length > 0
        ? db.collection<StoredTopListsCache>(TOP_LISTS_CACHE_COLLECTION).bulkWrite(
          topListsEntries
            .filter((entry): entry is readonly [Exclude<TopListRange, "custom">, TopListsData] => Boolean(entry[1]))
            .map(([range, data]) => ({
              updateOne: {
                filter: { spotifyUserId, range },
                update: { $set: { spotifyUserId, range, updatedAt, data } },
                upsert: true,
              },
            })),
          { ordered: false },
        )
        : Promise.resolve(),
      analysisEntries.length > 0
        ? db.collection<StoredAnalysisCache>(ANALYSIS_CACHE_COLLECTION).bulkWrite(
          analysisEntries
            .filter((entry): entry is readonly [AnalysisSectionKey, DashboardAnalysisDetail] => Boolean(entry[1]))
            .map(([key, data]) => ({
              updateOne: {
                filter: { spotifyUserId, key },
                update: { $set: { spotifyUserId, key, updatedAt, data } },
                upsert: true,
              },
            })),
          { ordered: false },
        )
        : Promise.resolve(),
      rediscoveryEntries.length > 0
        ? db.collection<StoredRediscoveryCache>(REDISCOVERY_CACHE_COLLECTION).bulkWrite(
          rediscoveryEntries
            .reduce<Array<{ range: DashboardRange; data: RediscoverySectionData }>>((acc, [range, data]) => {
              if (data) {
                acc.push({ range, data });
              }

              return acc;
            }, [])
            .map(({ range, data }) => ({
              updateOne: {
                filter: { spotifyUserId, range },
                update: { $set: { spotifyUserId, range, updatedAt, data } },
                upsert: true,
              },
            })),
          { ordered: false },
        )
        : Promise.resolve(),
      playlistsEntries.length > 0
        ? db.collection<StoredPlaylistsCache>(PLAYLISTS_CACHE_COLLECTION).bulkWrite(
          playlistsEntries
            .filter((entry): entry is readonly [PlaylistSortOption, PlaylistPageData] => Boolean(entry[1]))
            .map(([sort, data]) => ({
              updateOne: {
                filter: { spotifyUserId, sort },
                update: { $set: { spotifyUserId, sort, updatedAt, data } },
                upsert: true,
              },
            })),
          { ordered: false },
        )
        : Promise.resolve(),
    ]);
  } catch {
    return;
  }
}

export async function getStoredTopListsSection(spotifyUserId: string, range: TopListRange, from?: string, to?: string) {
  if (range === "custom" || from || to) {
    console.log(`[dashboard-section] user=${spotifyUserId} section=top-lists step=skip-cache reason=custom-window`);
    return null;
  }

  const startedAt = Date.now();
  const result = await getCachedValue(sectionRuntimeKey(spotifyUserId, "top-lists", range), DASHBOARD_SECTION_RUNTIME_TTL_MS, async () => {
    const readStartedAt = Date.now();
    const stored = await readStoredTopListsCache(spotifyUserId, range);
    logSectionTiming(spotifyUserId, "top-lists", "read-stored-cache", readStartedAt);
    return stored?.data ?? null;
  });
  logSectionTiming(spotifyUserId, "top-lists", result ? "cache-hit" : "cache-miss", startedAt);
  return result;
}

export async function getStoredAnalysisSection(
  spotifyUserId: string,
  range: DashboardRange,
  section: "trend" | "heatmap",
  options?: { label?: string; mood?: string; period?: string; day?: string; from?: string; to?: string },
) {
  if (options?.label || options?.mood || options?.period || options?.day || options?.from || options?.to) {
    console.log(`[dashboard-section] user=${spotifyUserId} section=analysis step=skip-cache reason=custom-filter`);
    return null;
  }

  const key = `${range}:${section}` as AnalysisSectionKey;
  const startedAt = Date.now();
  const result = await getCachedValue(sectionRuntimeKey(spotifyUserId, "analysis", key), DASHBOARD_SECTION_RUNTIME_TTL_MS, async () => {
    const readStartedAt = Date.now();
    const stored = await readStoredAnalysisCache(spotifyUserId, key);
    logSectionTiming(spotifyUserId, "analysis", "read-stored-cache", readStartedAt);
    return stored?.data ?? null;
  });
  logSectionTiming(spotifyUserId, "analysis", result ? "cache-hit" : "cache-miss", startedAt);
  return result;
}

export async function getStoredRediscoverySection(spotifyUserId: string, range: DashboardRange) {
  const startedAt = Date.now();
  const result = await getCachedValue(sectionRuntimeKey(spotifyUserId, "rediscovery", range), DASHBOARD_SECTION_RUNTIME_TTL_MS, async () => {
    const readStartedAt = Date.now();
    const stored = await readStoredRediscoveryCache(spotifyUserId, range);
    logSectionTiming(spotifyUserId, "rediscovery", "read-stored-cache", readStartedAt);
    return stored?.data ?? null;
  });
  logSectionTiming(spotifyUserId, "rediscovery", result ? "cache-hit" : "cache-miss", startedAt);
  return result;
}

export async function getStoredPlaylistsSection(spotifyUserId: string, sort: PlaylistSortOption) {
  const startedAt = Date.now();
  const result = await getCachedValue(sectionRuntimeKey(spotifyUserId, "playlists", sort), DASHBOARD_SECTION_RUNTIME_TTL_MS, async () => {
    const readStartedAt = Date.now();
    const stored = await readStoredPlaylistsCache(spotifyUserId, sort);
    logSectionTiming(spotifyUserId, "playlists", "read-stored-cache", readStartedAt);
    return stored?.data ?? null;
  });
  logSectionTiming(spotifyUserId, "playlists", result ? "cache-hit" : "cache-miss", startedAt);
  return result;
}
