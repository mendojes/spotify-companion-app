import { getDatabase, hasMongoConfig } from "@/lib/mongodb";
import { getDashboardAnalysisDetailFromHistory, getDashboardInsightsFromSnapshots, getSharedDashboardCacheSnapshots } from "@/lib/spotify-dashboard";
import { getCachedValue, invalidateCachedValue } from "@/lib/runtime-cache";
import { getPlaylistPageDataFromHistory, PlaylistPageData } from "@/lib/spotify-playlists";
import { FULL_TOP_LIST_LIMIT, getSpotifyTopListsFromHistory, getStoredOrBuildIncrementalAllTimeTopLists, getTopListHistoryData, hydrateTopListsDataMetadata, normalizeTopListsDataRanking } from "@/lib/spotify-toplists";
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

type StoredArtistMetadataRecord = {
  artistId: string;
  genres: string[];
  imageUrl?: string;
};

type DashboardSectionCacheOptions = {
  accessToken?: string;
  onProgress?: (detail: string) => void | Promise<void>;
  includeRediscovery?: boolean;
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

function hydrateTopListsDataArtistsWithStoredMetadata(
  topLists: TopListsData,
  metadataByArtistId: Map<string, StoredArtistMetadataRecord>,
) {
  let changed = false;

  const artists = topLists.artists.map((artist) => {
    const metadata = artist.id ? metadataByArtistId.get(artist.id) : undefined;
    if (!metadata) {
      return artist;
    }

    const nextImageUrl = artist.imageUrl ?? metadata.imageUrl;
    const nextGenres = artist.genres.length > 0 ? artist.genres : metadata.genres;
    const artistChanged =
      nextImageUrl !== artist.imageUrl ||
      nextGenres.length !== artist.genres.length ||
      nextGenres.some((genre, index) => genre !== artist.genres[index]);

    if (!artistChanged) {
      return artist;
    }

    changed = true;
    return {
      ...artist,
      imageUrl: nextImageUrl,
      genres: nextGenres,
    };
  });

  return changed
    ? {
      ...topLists,
      artists,
    }
    : topLists;
}

async function getStoredArtistMetadataMap(artistIds: string[]) {
  const uniqueArtistIds = [...new Set(artistIds.filter(Boolean))];
  if (uniqueArtistIds.length === 0) {
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

async function writeStoredPlaylistsCacheEntries(spotifyUserId: string, updatedAt: string) {
  const playlistsEntries = await Promise.all(
    PLAYLIST_SORT_VALUES.map(async (sort) => [sort, await getPlaylistPageDataFromHistory(spotifyUserId, sort)] as const),
  );

  if (playlistsEntries.length === 0) {
    return;
  }

  const db = await getDatabase();
  if (!db) {
    return;
  }

  await db.collection<StoredPlaylistsCache>(PLAYLISTS_CACHE_COLLECTION).bulkWrite(
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
  );
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

async function writeStoredTopListsCacheEntries(
  spotifyUserId: string,
  entries: Array<readonly [Exclude<TopListRange, "custom">, TopListsData | null]>,
  updatedAt: string,
) {
  if (entries.length === 0) {
    return;
  }

  const db = await getDatabase();
  if (!db) {
    return;
  }

  await db.collection<StoredTopListsCache>(TOP_LISTS_CACHE_COLLECTION).bulkWrite(
    entries
      .filter((entry): entry is readonly [Exclude<TopListRange, "custom">, TopListsData] => Boolean(entry[1]))
      .map(([range, data]) => ({
        updateOne: {
          filter: { spotifyUserId, range },
          update: { $set: { spotifyUserId, range, updatedAt, data } },
          upsert: true,
        },
      })),
    { ordered: false },
  );
}

async function writeStoredAnalysisCacheEntries(
  spotifyUserId: string,
  entries: Array<readonly [AnalysisSectionKey, DashboardAnalysisDetail | null]>,
  updatedAt: string,
) {
  if (entries.length === 0) {
    return;
  }

  const db = await getDatabase();
  if (!db) {
    return;
  }

  await db.collection<StoredAnalysisCache>(ANALYSIS_CACHE_COLLECTION).bulkWrite(
    entries
      .filter((entry): entry is readonly [AnalysisSectionKey, DashboardAnalysisDetail] => Boolean(entry[1]))
      .map(([key, data]) => ({
        updateOne: {
          filter: { spotifyUserId, key },
          update: { $set: { spotifyUserId, key, updatedAt, data } },
          upsert: true,
        },
      })),
    { ordered: false },
  );
}

async function writeStoredRediscoveryCacheEntries(
  spotifyUserId: string,
  entries: Array<readonly [DashboardRange, RediscoverySectionData | undefined]>,
  updatedAt: string,
) {
  if (entries.length === 0) {
    return;
  }

  const db = await getDatabase();
  if (!db) {
    return;
  }

  await db.collection<StoredRediscoveryCache>(REDISCOVERY_CACHE_COLLECTION).bulkWrite(
    entries
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
  );
}

export async function writeStoredDashboardSectionCache(
  spotifyUserId: string,
  accessTokenOrOptions?: string | DashboardSectionCacheOptions,
  maybeOptions?: DashboardSectionCacheOptions,
) {
  if (!hasMongoConfig()) {
    return;
  }

  const options = typeof accessTokenOrOptions === "string"
    ? { ...maybeOptions, accessToken: accessTokenOrOptions }
    : accessTokenOrOptions;
  const reportProgress = async (detail: string) => {
    await options?.onProgress?.(detail);
  };

  const snapshotsStartedAt = Date.now();
  await reportProgress("Loading shared dashboard snapshots");
  const snapshots = await getSharedDashboardCacheSnapshots(spotifyUserId);
  logSectionTiming(spotifyUserId, "section-cache", "load-snapshots", snapshotsStartedAt);

  const topListsStartedAt = Date.now();
  await reportProgress("Building top-list caches from stored listening history");
  const topListsEntries = await Promise.all(
    TOP_LIST_RANGE_VALUES.map(async (range) => [
      range,
      range === "all"
        ? await getStoredOrBuildIncrementalAllTimeTopLists(
          spotifyUserId,
          FULL_TOP_LIST_LIMIT,
          options?.accessToken,
          { allowCatalogLookup: false },
        )
        : await getSpotifyTopListsFromHistory(
          spotifyUserId,
          range,
          FULL_TOP_LIST_LIMIT,
          undefined,
          undefined,
          options?.accessToken,
          { allowCatalogLookup: false },
        ),
    ] as const),
  );
  logSectionTiming(spotifyUserId, "section-cache", "build-top-lists", topListsStartedAt);

  const updatedAt = new Date().toISOString();
  const writeTopListsStartedAt = Date.now();
  await reportProgress("Writing top-list caches");
  await writeStoredTopListsCacheEntries(spotifyUserId, topListsEntries, updatedAt);
  logSectionTiming(spotifyUserId, "section-cache", "write-top-lists", writeTopListsStartedAt);

  const analysisStartedAt = Date.now();
  await reportProgress("Building analysis section caches");
  const analysisEntries = await Promise.all(
    DASHBOARD_RANGE_VALUES.flatMap((range) => ([
      (async () => [`${range}:trend` as const, await getDashboardAnalysisDetailFromHistory(spotifyUserId, range, { section: "trend" })] as const)(),
      (async () => [`${range}:heatmap` as const, await getDashboardAnalysisDetailFromHistory(spotifyUserId, range, { section: "heatmap" })] as const)(),
    ])),
  );
  logSectionTiming(spotifyUserId, "section-cache", "build-analysis", analysisStartedAt);

  const writeAnalysisStartedAt = Date.now();
  await reportProgress("Writing analysis section caches");
  await writeStoredAnalysisCacheEntries(spotifyUserId, analysisEntries, updatedAt);
  logSectionTiming(spotifyUserId, "section-cache", "write-analysis", writeAnalysisStartedAt);

  if (options?.includeRediscovery === false) {
    await reportProgress("Skipping rediscovery section cache rebuild for this pass");
    return;
  }

  const rediscoveryStartedAt = Date.now();
  await reportProgress("Building rediscovery section caches");
  const rediscoveryEntries = await Promise.all(
    DASHBOARD_RANGE_VALUES.map(async (range) => {
      const insights = snapshots.length > 0
        ? await getDashboardInsightsFromSnapshots(
          snapshots,
          range,
          undefined,
          spotifyUserId,
          {
            includeLivePlaylistInsights: false,
            includePublicTagFallback: false,
            includeArtistGenreBackfill: false,
          },
        )
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
  );
  logSectionTiming(spotifyUserId, "section-cache", "build-rediscovery", rediscoveryStartedAt);

  const writeRediscoveryStartedAt = Date.now();
  await reportProgress("Writing rediscovery section caches");
  await writeStoredRediscoveryCacheEntries(spotifyUserId, rediscoveryEntries, updatedAt);
  logSectionTiming(spotifyUserId, "section-cache", "write-rediscovery", writeRediscoveryStartedAt);
}

export async function writeStoredPlaylistsSectionCache(spotifyUserId: string) {
  if (!hasMongoConfig()) {
    return;
  }

  try {
    const updatedAt = new Date().toISOString();
    await writeStoredPlaylistsCacheEntries(spotifyUserId, updatedAt);
  } catch {
    return;
  }
}

export async function hydrateStoredTopListsSectionMetadata(spotifyUserId: string, accessToken?: string) {
  if (!hasMongoConfig()) {
    return;
  }

  try {
    const db = await getDatabase();
    if (!db) {
      return;
    }

    const docs = await db.collection<StoredTopListsCache>(TOP_LISTS_CACHE_COLLECTION).find({ spotifyUserId }).toArray();
    const topListHistory = await getTopListHistoryData(spotifyUserId).catch(() => ({ snapshots: [], recentPlays: [] }));
    const artistIds = docs.flatMap((doc) => doc.data.artists.map((artist) => artist.id)).filter(Boolean);
    const metadataByArtistId = await getStoredArtistMetadataMap(artistIds);

    if (metadataByArtistId.size === 0 && topListHistory.snapshots.length === 0 && topListHistory.recentPlays.length === 0) {
      return;
    }

    const operations = await docs.reduce<Promise<Array<{
      updateOne: {
        filter: { spotifyUserId: string; range: Exclude<TopListRange, "custom"> };
        update: { $set: { updatedAt: string; data: TopListsData } };
      };
    }>>>(async (accPromise, doc) => {
      const acc = await accPromise;
      const artistHydratedData = hydrateTopListsDataArtistsWithStoredMetadata(normalizeTopListsDataRanking(doc.data), metadataByArtistId);
      const hydratedData = await hydrateTopListsDataMetadata(
        artistHydratedData,
        topListHistory.recentPlays,
        topListHistory.snapshots,
        accessToken,
        { allowCatalogLookup: false },
      ).catch(() => artistHydratedData);
      const changed = JSON.stringify(hydratedData) !== JSON.stringify(doc.data);
      if (!changed) {
        return acc;
      }

      acc.push({
        updateOne: {
          filter: { spotifyUserId, range: doc.range },
          update: {
            $set: {
              updatedAt: new Date().toISOString(),
              data: hydratedData,
            },
          },
        },
      });
      return acc;
    }, Promise.resolve([]));

    if (operations.length > 0) {
      await db.collection<StoredTopListsCache>(TOP_LISTS_CACHE_COLLECTION).bulkWrite(operations, { ordered: false });
    }
  } catch {
    return;
  }
}

export { hydrateTopListsDataArtistsWithStoredMetadata };

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
    return stored?.data ? normalizeTopListsDataRanking(stored.data) : null;
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
