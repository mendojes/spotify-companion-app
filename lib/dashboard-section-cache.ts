import { getDatabase, hasMongoConfig } from "@/lib/mongodb";
import { getDashboardAnalysisDetailFromHistory, getDashboardInsightsFromSnapshots, getSharedDashboardCacheSnapshots } from "@/lib/spotify-dashboard";
import { getCachedValue, invalidateCachedValue } from "@/lib/runtime-cache";
import { getPlaylistPageDataFromHistory, PlaylistPageData } from "@/lib/spotify-playlists";
import { FULL_TOP_LIST_LIMIT, getSpotifyTopListsFromHistory } from "@/lib/spotify-toplists";
import { DashboardAnalysisDetail, DashboardInsights, DashboardRange, PlaylistSortOption, TopListRange, TopListsData } from "@/lib/types";

const DASHBOARD_SECTION_CACHE_COLLECTION = "dashboard_section_cache";
const DASHBOARD_SECTION_RUNTIME_TTL_MS = 1000 * 30;
const DASHBOARD_RANGE_VALUES: DashboardRange[] = ["week", "month", "all"];
const TOP_LIST_RANGE_VALUES: Exclude<TopListRange, "custom">[] = ["week", "month", "year", "all"];
const PLAYLIST_SORT_VALUES: PlaylistSortOption[] = ["created_desc", "created_asc", "last_listened_desc", "last_listened_asc"];

type AnalysisSectionKey = `${DashboardRange}:trend` | `${DashboardRange}:heatmap`;

type RediscoverySectionData = Pick<DashboardInsights, "forgottenFavorites" | "quietSavedTracks" | "cachedAt" | "range" | "sourceLabel">;

type StoredDashboardSectionCache = {
  spotifyUserId: string;
  updatedAt: string;
  topListsByRange: Partial<Record<Exclude<TopListRange, "custom">, TopListsData>>;
  analysisByKey: Partial<Record<AnalysisSectionKey, DashboardAnalysisDetail>>;
  rediscoveryByRange: Partial<Record<DashboardRange, RediscoverySectionData>>;
  playlistsBySort: Partial<Record<PlaylistSortOption, PlaylistPageData>>;
};

function logSectionTiming(spotifyUserId: string, section: string, step: string, startedAt: number) {
  console.log(`[dashboard-section] user=${spotifyUserId} section=${section} step=${step} elapsedMs=${Date.now() - startedAt}`);
}

function sectionRuntimeKey(spotifyUserId: string, section: string) {
  return `dashboard-section:${spotifyUserId}:${section}`;
}

async function readStoredDashboardSectionCache(spotifyUserId: string): Promise<StoredDashboardSectionCache | null> {
  if (!hasMongoConfig()) {
    return null;
  }

  try {
    const db = await getDatabase();
    if (!db) {
      return null;
    }

    return db.collection<StoredDashboardSectionCache>(DASHBOARD_SECTION_CACHE_COLLECTION).findOne({ spotifyUserId });
  } catch {
    return null;
  }
}

export function invalidateDashboardSectionRuntimeCache(spotifyUserId: string) {
  invalidateCachedValue(sectionRuntimeKey(spotifyUserId, "top-lists"));
  invalidateCachedValue(sectionRuntimeKey(spotifyUserId, "analysis"));
  invalidateCachedValue(sectionRuntimeKey(spotifyUserId, "rediscovery"));
  invalidateCachedValue(sectionRuntimeKey(spotifyUserId, "playlists"));
}

export async function writeStoredDashboardSectionCache(spotifyUserId: string) {
  if (!hasMongoConfig()) {
    return;
  }

  const snapshots = await getSharedDashboardCacheSnapshots(spotifyUserId);

  const [topListsEntries, analysisEntries, rediscoveryEntries, playlistsEntries] = await Promise.all([
    Promise.all(
      TOP_LIST_RANGE_VALUES.map(async (range) => [range, await getSpotifyTopListsFromHistory(spotifyUserId, range, FULL_TOP_LIST_LIMIT)] as const),
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
          ? await getDashboardInsightsFromSnapshots(snapshots, range, undefined, spotifyUserId)
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

  const topListsByRange = Object.fromEntries(
    topListsEntries.filter((entry): entry is readonly [Exclude<TopListRange, "custom">, TopListsData] => Boolean(entry[1])),
  ) as Partial<Record<Exclude<TopListRange, "custom">, TopListsData>>;
  const analysisByKey = Object.fromEntries(
    analysisEntries.filter((entry): entry is readonly [AnalysisSectionKey, DashboardAnalysisDetail] => Boolean(entry[1])),
  ) as Partial<Record<AnalysisSectionKey, DashboardAnalysisDetail>>;
  const rediscoveryByRange = rediscoveryEntries.reduce<Partial<Record<DashboardRange, RediscoverySectionData>>>((acc, [range, value]) => {
    if (value) {
      acc[range] = value;
    }

    return acc;
  }, {});
  const playlistsBySort = Object.fromEntries(
    playlistsEntries.filter((entry): entry is readonly [PlaylistSortOption, PlaylistPageData] => Boolean(entry[1])),
  ) as Partial<Record<PlaylistSortOption, PlaylistPageData>>;

  try {
    const db = await getDatabase();
    if (!db) {
      return;
    }

    await db.collection<StoredDashboardSectionCache>(DASHBOARD_SECTION_CACHE_COLLECTION).updateOne(
      { spotifyUserId },
      {
        $set: {
          spotifyUserId,
          updatedAt: new Date().toISOString(),
          topListsByRange,
          analysisByKey,
          rediscoveryByRange,
          playlistsBySort,
        },
      },
      { upsert: true },
    );
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
  const result = await getCachedValue(sectionRuntimeKey(spotifyUserId, "top-lists"), DASHBOARD_SECTION_RUNTIME_TTL_MS, async () => {
    const readStartedAt = Date.now();
    const stored = await readStoredDashboardSectionCache(spotifyUserId);
    logSectionTiming(spotifyUserId, "top-lists", "read-stored-cache", readStartedAt);
    return stored?.topListsByRange ?? {};
  }).then((entries) => (entries as Partial<Record<Exclude<TopListRange, "custom">, TopListsData>>)[range] ?? null);
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
  const result = await getCachedValue(sectionRuntimeKey(spotifyUserId, "analysis"), DASHBOARD_SECTION_RUNTIME_TTL_MS, async () => {
    const readStartedAt = Date.now();
    const stored = await readStoredDashboardSectionCache(spotifyUserId);
    logSectionTiming(spotifyUserId, "analysis", "read-stored-cache", readStartedAt);
    return stored?.analysisByKey ?? {};
  }).then((entries) => (entries as Partial<Record<AnalysisSectionKey, DashboardAnalysisDetail>>)[key] ?? null);
  logSectionTiming(spotifyUserId, "analysis", result ? "cache-hit" : "cache-miss", startedAt);
  return result;
}

export async function getStoredRediscoverySection(spotifyUserId: string, range: DashboardRange) {
  const startedAt = Date.now();
  const result = await getCachedValue(sectionRuntimeKey(spotifyUserId, "rediscovery"), DASHBOARD_SECTION_RUNTIME_TTL_MS, async () => {
    const readStartedAt = Date.now();
    const stored = await readStoredDashboardSectionCache(spotifyUserId);
    logSectionTiming(spotifyUserId, "rediscovery", "read-stored-cache", readStartedAt);
    return stored?.rediscoveryByRange ?? {};
  }).then((entries) => (entries as Partial<Record<DashboardRange, RediscoverySectionData>>)[range] ?? null);
  logSectionTiming(spotifyUserId, "rediscovery", result ? "cache-hit" : "cache-miss", startedAt);
  return result;
}

export async function getStoredPlaylistsSection(spotifyUserId: string, sort: PlaylistSortOption) {
  const startedAt = Date.now();
  const result = await getCachedValue(sectionRuntimeKey(spotifyUserId, "playlists"), DASHBOARD_SECTION_RUNTIME_TTL_MS, async () => {
    const readStartedAt = Date.now();
    const stored = await readStoredDashboardSectionCache(spotifyUserId);
    logSectionTiming(spotifyUserId, "playlists", "read-stored-cache", readStartedAt);
    return stored?.playlistsBySort ?? {};
  }).then((entries) => (entries as Partial<Record<PlaylistSortOption, PlaylistPageData>>)[sort] ?? null);
  logSectionTiming(spotifyUserId, "playlists", result ? "cache-hit" : "cache-miss", startedAt);
  return result;
}
