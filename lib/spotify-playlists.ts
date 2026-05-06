import { getCurrentPlaybackSource, getStoredRecentPlays, syncRecentPlays } from "@/lib/spotify-activity";
import { getSpotifyClientCredentialsToken, spotifyFetch } from "@/lib/spotify";
import { FULL_TOP_LIST_LIMIT, getSpotifyTopListsFromHistory } from "@/lib/spotify-toplists";
import { getDatabase, hasMongoConfig } from "@/lib/mongodb";
import { deriveGenreBasedMoodInsightsFromSummaries } from "@/lib/moods";
import { getCachedValue, invalidateCachedValue } from "@/lib/runtime-cache";
import {
  PlaylistArtistSummary,
  PlaylistDetail,
  PlaylistGenreSummary,
  PlaylistInsight,
  PlaylistSortOption,
  PlaylistTrackSummary,
  PlaylistUnavailableTrackSummary,
  PlaylistListenTimelinePoint,
  SpotifyArtist,
  SpotifyAudioFeature,
  SpotifyAudioFeaturesResponse,
  SpotifyPlaylist,
  SpotifyPlaylistsResponse,
  SpotifyPlaylistTrackItem,
  SpotifyPlaylistTracksResponse,
  SpotifyTrack,
  StoredRecentPlay,
} from "@/lib/types";
import { PST_TIME_ZONE } from "@/lib/time";

const PLAYLIST_PAGE_LIMIT = 50;
const DASHBOARD_PLAYLIST_COUNT = 3;
const PLAYLIST_ANALYSIS_CONCURRENCY = 3;
const PLAYLIST_INSIGHTS_TTL_MS = 1000 * 60 * 5;
const PLAYLIST_RECENT_SYNC_TTL_MS = 1000 * 60 * 5;
const PLAYLIST_INSIGHTS_COLLECTION = "spotify_playlist_insights";
const PLAYLIST_DETAIL_CACHE_COLLECTION = "spotify_playlist_detail_cache";
const PLAYLIST_LIBRARY_COLLECTION = "spotify_playlist_library";
const PLAYLIST_TRACK_CACHE_COLLECTION = "spotify_playlist_track_cache";
const PLAYLIST_TRACK_SYNC_COLLECTION = "spotify_playlist_track_sync";
const ARTIST_METADATA_COLLECTION = "spotify_artist_metadata";
const PUBLIC_PLAYLIST_DETAIL_STAGE_COLLECTION = "public_playlist_detail_stage";
const PLAYLIST_DETAIL_REFRESH_LIMIT = 6;
const MUSICBRAINZ_USER_AGENT = "SoundScope/0.1 ( playlist genre fallback )";
const PLAYLIST_PUBLIC_TAG_FETCH_LIMIT = 30;
const PLAYLIST_ARTIST_METADATA_LIMIT = 150;
const PLAYLIST_AUDIO_FEATURE_SAMPLE_LIMIT = 200;
const PLAYLIST_LARGE_SYNC_THRESHOLD = 1000;
const PLAYLIST_SYNC_PAGE_SIZE = 100;
const PLAYLIST_LARGE_SYNC_PAGES_PER_REQUEST = 8;
const PUBLIC_SPOTIFY_WEB_TIMEOUT_MS = 10_000;
const DASHBOARD_PLAYLIST_PREVIEW_TTL_MS = 1000 * 30;

const lastGoodPlaylistInsights = new Map<string, PlaylistInsight[]>();
const publicPlaylistHtmlCache = new Map<string, string | null>();

function logPlaylistTiming(spotifyUserId: string, playlistId: string | undefined, step: string, startedAt: number, extra?: string) {
  const playlistLabel = playlistId ?? "unknown";
  const suffix = extra ? ` ${extra}` : "";
  console.log(`[playlist-cache] user=${spotifyUserId} playlist=${playlistLabel} step=${step} elapsedMs=${Date.now() - startedAt}${suffix}`);
}

type PlaylistTrackWithMeta = {
  addedAt?: string;
  addedById?: string;
  track: SpotifyTrack;
};

type Identifiable = { id?: string };

type CachedPlaylistDetail = PlaylistDetail & {
  spotifyUserId: string;
  updatedAt: string;
};
type StoredPlaylistInsights = {
  spotifyUserId: string;
  updatedAt: string;
  playlistInsights: PlaylistInsight[];
};

type StoredPlaylistLibraryItem = SpotifyPlaylist & {
  spotifyUserId: string;
  updatedAt: string;
};

type StoredPlaylistTrackCacheItem = {
  spotifyUserId: string;
  playlistId: string;
  position: number;
  addedAt?: string;
  addedById?: string;
  track?: SpotifyTrack;
  trackId?: string;
  title?: string;
  artistNames?: string[];
  albumName?: string;
  imageUrl?: string;
  classification?: "analyzable" | "local" | "unavailable" | "partial" | "unknown";
  reason?: string;
  updatedAt: string;
};

type StoredPlaylistTrackSyncState = {
  spotifyUserId: string;
  playlistId: string;
  totalTracks?: number;
  fetchedCount: number;
  nextOffset: number;
  completed: boolean;
  updatedAt: string;
  lastError?: string;
};

type TrackAffinity = {
  playCount: number;
  lastPlayedAt?: string;
};

type NormalizedStoredPlaylistTrackCacheRecord = Omit<
  StoredPlaylistTrackCacheItem,
  "spotifyUserId" | "playlistId" | "position" | "updatedAt"
>;

export type PlaylistTrackDiagnostics = {
  totalItems: number;
  fetchedItems: number;
  analyzableTracks: number;
  rejectedItems: number;
  localItems: number;
  unavailableItems: number;
  partialItems: number;
  unknownItems: number;
  completed: boolean;
  lastError?: string;
  unavailableTracks: PlaylistUnavailableTrackSummary[];
};

type StoredArtistMetadata = {
  artistId: string;
  name: string;
  genres: string[];
  imageUrl?: string;
  popularity: number;
  updatedAt: string;
};

function normalizeArtistCacheKey(value: string) {
  return value.trim().toLocaleLowerCase();
}

async function writeMusicBrainzGenresToPermanentArtistCache(
  tracks: SpotifyTrack[],
  artistTags: Map<string, string[]>,
) {
  if (!hasMongoConfig() || artistTags.size === 0) {
    return;
  }

  const db = await getDatabase();
  if (!db) {
    return;
  }

  const artistIdsByNormalizedName = new Map<string, { artistId: string; name: string }>();

  for (const track of tracks) {
    for (const artist of track.artists ?? []) {
      if (!artist?.id || !artist?.name) {
        continue;
      }

      const key = normalizeArtistCacheKey(artist.name);

      if (!artistIdsByNormalizedName.has(key)) {
        artistIdsByNormalizedName.set(key, {
          artistId: artist.id,
          name: artist.name,
        });
      }
    }
  }

  const matchedArtists = [...artistTags.entries()]
    .map(([artistName, genres]) => {
      const match = artistIdsByNormalizedName.get(normalizeArtistCacheKey(artistName));

      if (!match || genres.length === 0) {
        return null;
      }

      return {
        artistId: match.artistId,
        name: match.name,
        genres: [...new Set(genres.map((genre) => genre.trim()).filter(Boolean))],
      };
    })
    .filter(
      (
        value,
      ): value is {
        artistId: string;
        name: string;
        genres: string[];
      } => Boolean(value),
    );

  if (matchedArtists.length === 0) {
    return;
  }

  const existingRecords = await db
    .collection<StoredArtistMetadata>(ARTIST_METADATA_COLLECTION)
    .find({
      artistId: { $in: matchedArtists.map((artist) => artist.artistId) },
    })
    .toArray();

  const existingByArtistId = new Map(existingRecords.map((record) => [record.artistId, record]));

  const operations = matchedArtists.flatMap((artist) => {
    const existing = existingByArtistId.get(artist.artistId);
    const existingGenres = existing?.genres ?? [];

    if (existing && existingGenres.length > 0) {
      return [];
    }

    return [
      {
        updateOne: {
          filter: { artistId: artist.artistId },
          update: {
            $set: {
              artistId: artist.artistId,
              name: existing?.name ?? artist.name,
              genres: artist.genres,
              updatedAt: new Date().toISOString(),
            },
            $setOnInsert: {
              imageUrl: existing?.imageUrl,
              popularity: existing?.popularity ?? 0,
            },
          },
          upsert: true,
        },
      },
    ];
  });

  if (operations.length === 0) {
    return;
  }

  await db
    .collection<StoredArtistMetadata>(ARTIST_METADATA_COLLECTION)
    .bulkWrite(operations, { ordered: false })
    .catch(() => undefined);
}

export type PublicPlaylistDetailStageState = {
  spotifyUserId: string;
  playlistId: string;
  stage: "idle" | "tracks" | "artists" | "finalizing" | "completed" | "failed";
  phase: string;
  trackCount: number;
  artistsResolved: number;
  artistsTotal: number;
  updatedAt?: string;
  error?: string;
};

type StoredPublicPlaylistDetailStageState = PublicPlaylistDetailStageState & {
  id: string;
};

type SpotifyTracksResponse = {
  tracks: Array<SpotifyTrack | null>;
};

export type PlaylistLibraryStatus = {
  playlistCount: number;
  lastSyncedAt?: string;
};

export type PlaylistPageData = {
  playlists: PlaylistInsight[];
  playlistCount: number;
  lastSyncedAt?: string;
};

function isUsablePlaylistTrack(track: unknown): track is SpotifyTrack {
  if (!track || typeof track !== "object") {
    return false;
  }

  const candidate = track as Partial<SpotifyTrack>;
  return Boolean(
    candidate.id &&
    candidate.name &&
    candidate.album?.name &&
    Array.isArray(candidate.artists) &&
    candidate.artists.length > 0,
  );
}

function normalizeStoredPlaylistTrackRecordFromTrackItem(item: SpotifyPlaylistTrackItem): NormalizedStoredPlaylistTrackCacheRecord {
  const rawTrack = item.track ?? item.item;

  if (isUsablePlaylistTrack(rawTrack)) {
    return {
      addedAt: item.added_at,
      addedById: item.added_by?.id,
      track: rawTrack,
      trackId: rawTrack.id,
      title: rawTrack.name,
      artistNames: rawTrack.artists.map((artist) => artist.name).filter(Boolean),
      albumName: rawTrack.album?.name,
      imageUrl: rawTrack.album?.images?.[0]?.url,
      classification: "analyzable",
      reason: rawTrack.is_playable === false ? "Spotify marked this track as unavailable to play." : undefined,
    };
  }

  if (!rawTrack || typeof rawTrack !== "object") {
    return {
      addedAt: item.added_at,
      addedById: item.added_by?.id,
      classification: "unavailable",
      reason: "Spotify no longer returned metadata for this playlist item.",
      title: "Unavailable track",
      artistNames: [],
      albumName: "Unknown release",
    };
  }

  const candidate = rawTrack as Partial<SpotifyTrack> & { is_local?: boolean; is_playable?: boolean | null };
  const artistNames = Array.isArray(candidate.artists)
    ? candidate.artists.map((artist) => artist?.name).filter((name): name is string => Boolean(name))
    : [];
  const title = candidate.name?.trim() || (candidate.is_local ? "Local file" : "Unavailable track");
  const albumName = candidate.album?.name?.trim() || "Unknown release";
  const baseRecord = {
    addedAt: item.added_at,
    addedById: item.added_by?.id,
    trackId: candidate.id,
    title,
    artistNames,
    albumName,
    imageUrl: candidate.album?.images?.[0]?.url,
  } satisfies Omit<NormalizedStoredPlaylistTrackCacheRecord, "classification" | "reason" | "track">;

  if (candidate.is_local) {
    return {
      ...baseRecord,
      classification: "local",
      reason: "This playlist item is a local file and does not have full Spotify metadata.",
    };
  }

  if (candidate.is_playable === false) {
    return {
      ...baseRecord,
      classification: "unavailable",
      reason: "Spotify returned this track as unavailable.",
    };
  }

  return {
    ...baseRecord,
    classification: candidate.id || artistNames.length > 0 ? "partial" : "unknown",
    reason: "Spotify returned incomplete metadata for this playlist item.",
  };
}

function normalizeStoredPlaylistTrackRecordFromTrack(trackItem: PlaylistTrackWithMeta): NormalizedStoredPlaylistTrackCacheRecord {
  return {
    addedAt: trackItem.addedAt,
    addedById: trackItem.addedById,
    track: trackItem.track,
    trackId: trackItem.track.id,
    title: trackItem.track.name,
    artistNames: trackItem.track.artists.map((artist) => artist.name).filter(Boolean),
    albumName: trackItem.track.album?.name,
    imageUrl: trackItem.track.album?.images?.[0]?.url,
    classification: "analyzable",
  };
}

function isPlaylistDetailIncomplete(detail: PlaylistDetail | CachedPlaylistDetail) {
  return (
    detail.trackCount <= 0 ||
    detail.uniqueArtistCount <= 0 ||
    detail.mood.toLowerCase().includes("analysis pending") ||
    detail.topGenres.length === 0
  );
}

function normalizePlaylist(playlist: Partial<SpotifyPlaylist> | null | undefined): SpotifyPlaylist | null {
  if (!playlist?.id || !playlist.name) {
    return null;
  }

  const playlistItems = playlist.items as { total?: number; href?: string } | undefined;
  const trackTotal = typeof playlist.tracks?.total === "number"
    ? playlist.tracks.total
    : typeof playlistItems?.total === "number"
      ? playlistItems.total
      : 0;
  const trackHref = playlist.tracks?.href ?? playlistItems?.href;

  return {
    id: playlist.id,
    name: playlist.name,
    images: Array.isArray(playlist.images) ? playlist.images.filter((image) => Boolean(image?.url)) : undefined,
    tracks: {
      total: trackTotal,
      href: trackHref,
    },
    owner: playlist.owner?.display_name || playlist.owner?.id
      ? {
        id: playlist.owner?.id,
        display_name: playlist.owner?.display_name,
      }
      : undefined,
  };
}

async function getStoredPlaylistLibraryRecords(spotifyUserId: string) {
  if (!hasMongoConfig()) {
    return [] as StoredPlaylistLibraryItem[];
  }

  try {
    const db = await getDatabase();
    if (!db) {
      return [] as StoredPlaylistLibraryItem[];
    }

    return await db
      .collection<StoredPlaylistLibraryItem>(PLAYLIST_LIBRARY_COLLECTION)
      .find({ spotifyUserId })
      .sort({ updatedAt: -1, name: 1 })
      .toArray();
  } catch {
    return [] as StoredPlaylistLibraryItem[];
  }
}

export async function getStoredPlaylistLibrary(spotifyUserId: string) {
  const records = await getStoredPlaylistLibraryRecords(spotifyUserId);
  return records
    .map((playlist) => normalizePlaylist(playlist))
    .filter((playlist): playlist is SpotifyPlaylist => Boolean(playlist));
}

export async function storePublicPlaylistAnalysisResult(
  spotifyUserId: string,
  detail: PlaylistDetail,
) {
  await writeCachedPlaylistDetails(spotifyUserId, [detail]);

  const existingInsights = await getStoredPlaylistInsights(spotifyUserId).catch(
    () => [] as PlaylistInsight[],
  );

  const nextInsight: PlaylistInsight = {
    id: detail.id,
    name: detail.name,
    imageUrl: detail.imageUrl,
    trackCount: detail.trackCount,
    createdAt: detail.createdAt,
    lastListenedAt: detail.lastListenedAt,
    mood: detail.mood,
    topGenresSummary:
      detail.topGenres.length > 0
        ? detail.topGenres.slice(0, 3).map((genre) => genre.genre).join(", ")
        : detail.diversity,
    diversity: detail.diversity,
    listeningCadence: detail.listeningCadence,
    overlap: detail.overlap,
  };

  const mergedInsightsById = new Map<string, PlaylistInsight>();

  for (const insight of existingInsights) {
    if (insight.id) {
      mergedInsightsById.set(insight.id, insight);
    }
  }

  mergedInsightsById.set(nextInsight.id!, nextInsight);

  await writeStoredPlaylistInsights(spotifyUserId, [...mergedInsightsById.values()]);
  invalidatePlaylistInsightsCache(spotifyUserId);
}

export async function getPlaylistLibraryStatus(spotifyUserId: string): Promise<PlaylistLibraryStatus> {
  if (!hasMongoConfig()) {
    return { playlistCount: 0 };
  }

  try {
    const db = await getDatabase();
    if (!db) {
      return { playlistCount: 0 };
    }

    const [playlistCount, latestRecord] = await Promise.all([
      db.collection<StoredPlaylistLibraryItem>(PLAYLIST_LIBRARY_COLLECTION).countDocuments({ spotifyUserId }),
      db.collection<StoredPlaylistLibraryItem>(PLAYLIST_LIBRARY_COLLECTION)
        .find({ spotifyUserId })
        .sort({ updatedAt: -1 })
        .limit(1)
        .project({ updatedAt: 1 })
        .next(),
    ]);

    return {
      playlistCount,
      lastSyncedAt: latestRecord?.updatedAt,
    };
  } catch {
    return { playlistCount: 0 };
  }
}

async function writeStoredPlaylistLibrary(spotifyUserId: string, playlists: SpotifyPlaylist[]) {
  const normalizedPlaylists = playlists
    .map((playlist) => normalizePlaylist(playlist))
    .filter((playlist): playlist is SpotifyPlaylist => Boolean(playlist));

  if (!hasMongoConfig() || normalizedPlaylists.length === 0) {
    return;
  }

  try {
    const db = await getDatabase();
    if (!db) {
      return;
    }

    const updatedAt = new Date().toISOString();

    await db.collection<StoredPlaylistLibraryItem>(PLAYLIST_LIBRARY_COLLECTION).bulkWrite(
      normalizedPlaylists.map((playlist) => ({
        updateOne: {
          filter: { spotifyUserId, id: playlist.id },
          update: {
            $set: {
              ...playlist,
              spotifyUserId,
              updatedAt,
            },
          },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  } catch {
    return;
  }
}

async function upsertStoredPlaylist(spotifyUserId: string, playlist: SpotifyPlaylist) {
  const normalizedPlaylist = normalizePlaylist(playlist);

  if (!hasMongoConfig() || !normalizedPlaylist) {
    return;
  }

  try {
    const db = await getDatabase();
    if (!db) {
      return;
    }

    await db.collection<StoredPlaylistLibraryItem>(PLAYLIST_LIBRARY_COLLECTION).updateOne(
      { spotifyUserId, id: normalizedPlaylist.id },
      {
        $set: {
          ...normalizedPlaylist,
          spotifyUserId,
          updatedAt: new Date().toISOString(),
        },
      },
      { upsert: true },
    );
  } catch {
    return;
  }
}

async function getPlaylistLibrary(accessToken: string, spotifyUserId: string, options?: { allowStoredFallback?: boolean }) {
  const storedPlaylists = await getStoredPlaylistLibrary(spotifyUserId);

  try {
    const livePlaylists = await fetchAllPlaylists(accessToken);
    if (livePlaylists.length > 0) {
      await writeStoredPlaylistLibrary(spotifyUserId, livePlaylists);
      return livePlaylists;
    }
  } catch {
    if (options?.allowStoredFallback ?? true) {
      return storedPlaylists;
    }

    throw new Error("Could not fetch playlist library from Spotify.");
  }

  return storedPlaylists;
}

async function getStoredPlaylistInsights(spotifyUserId: string) {
  if (!hasMongoConfig()) {
    return [] as PlaylistInsight[];
  }

  try {
    const db = await getDatabase();
    if (!db) {
      return [] as PlaylistInsight[];
    }

    const cached = await db.collection<StoredPlaylistInsights>(PLAYLIST_INSIGHTS_COLLECTION).findOne({ spotifyUserId });
    return cached?.playlistInsights ?? [];
  } catch {
    return [] as PlaylistInsight[];
  }
}

async function writeStoredPlaylistInsights(spotifyUserId: string, playlistInsights: PlaylistInsight[]) {
  if (!hasMongoConfig() || playlistInsights.length === 0) {
    return;
  }

  try {
    const db = await getDatabase();
    if (!db) {
      return;
    }

    await db.collection<StoredPlaylistInsights>(PLAYLIST_INSIGHTS_COLLECTION).updateOne(
      { spotifyUserId },
      {
        $set: {
          spotifyUserId,
          updatedAt: new Date().toISOString(),
          playlistInsights,
        },
      },
      { upsert: true },
    );
  } catch {
    return;
  }
}

export async function seedStoredPublicPlaylistSnapshot(
  spotifyUserId: string,
  playlists: SpotifyPlaylist[],
  playlistInsights: PlaylistInsight[] = [],
) {
  const normalizedPlaylists = uniqueById(
    playlists
      .map((playlist) => normalizePlaylist(playlist))
      .filter((playlist): playlist is SpotifyPlaylist => Boolean(playlist)),
  );

  if (normalizedPlaylists.length === 0) {
    return;
  }

  const insightById = new Map(
    uniqueById(playlistInsights.filter((playlist): playlist is PlaylistInsight & { id: string } => Boolean(playlist?.id)))
      .map((playlist) => [playlist.id, playlist]),
  );

  const seededInsights = normalizedPlaylists.map((playlist) => {
    const existingInsight = insightById.get(playlist.id);

    if (existingInsight) {
      return existingInsight;
    }

    return {
      ...toBasicInsight(playlist, []),
      listeningCadence: "Public playlist snapshot only",
    } satisfies PlaylistInsight;
  });

  await Promise.all([
    writeStoredPlaylistLibrary(spotifyUserId, normalizedPlaylists),
    writeStoredPlaylistInsights(spotifyUserId, seededInsights),
  ]);
}

function reorderPlaylistInsightsFromRecentPlay(
  playlistInsights: PlaylistInsight[],
  recentPlays: StoredRecentPlay[],
) {
  if (playlistInsights.length === 0 || recentPlays.length === 0) {
    return { playlistInsights, changed: false };
  }

  const latestPlaylistPlay = recentPlays.find((play) => Boolean(play.playlistId));
  if (!latestPlaylistPlay?.playlistId) {
    return { playlistInsights, changed: false };
  }

  const currentTopPlaylistId = playlistInsights[0]?.id;
  if (currentTopPlaylistId === latestPlaylistPlay.playlistId) {
    return { playlistInsights, changed: false };
  }

  const matchingInsight = playlistInsights.find((playlist) => playlist.id === latestPlaylistPlay.playlistId);
  if (!matchingInsight) {
    return { playlistInsights, changed: false };
  }

  const reordered = [
    {
      ...matchingInsight,
      lastListenedAt: latestPlaylistPlay.playedAt,
    },
    ...playlistInsights.filter((playlist) => playlist.id !== latestPlaylistPlay.playlistId),
  ];

  return { playlistInsights: reordered, changed: true };
}

function hydrateStoredInsightsFromCachedDetails(
  storedInsights: PlaylistInsight[],
  storedPlaylists: SpotifyPlaylist[],
  cachedDetails: CachedPlaylistDetail[],
  recentPlays: StoredRecentPlay[],
) {
  const cachedDetailMap = new Map(cachedDetails.map((detail) => [detail.id, detail]));
  const cachedInsights = storedPlaylists.length > 0
    ? buildCachedPlaylistInsights(storedPlaylists, cachedDetails, recentPlays, "last_listened_desc")
    : [];

  const hydratedStoredInsights = storedInsights.map((insight) => {
    if (!insight.id) {
      return insight;
    }

    const cachedDetail = cachedDetailMap.get(insight.id);
    if (!cachedDetail || isPlaylistDetailIncomplete(cachedDetail)) {
      return insight;
    }

    return {
      ...toInsight(cachedDetail, recentPlays),
      lastListenedAt: insight.lastListenedAt ?? cachedDetail.lastListenedAt,
    };
  });

  return uniqueById([...hydratedStoredInsights, ...cachedInsights]);
}

export async function getDashboardPlaylistInsights(spotifyUserId: string): Promise<PlaylistInsight[]> {
  const [storedInsights, recentPlays, storedPlaylists, cachedDetails] = await Promise.all([
    getStoredPlaylistInsights(spotifyUserId),
    getStoredRecentPlays(spotifyUserId).catch(() => [] as StoredRecentPlay[]),
    getStoredPlaylistLibrary(spotifyUserId).catch(() => [] as SpotifyPlaylist[]),
    getCachedPlaylistDetails(spotifyUserId).catch(() => [] as CachedPlaylistDetail[]),
  ]);

  const hydratedInsights = hydrateStoredInsightsFromCachedDetails(storedInsights, storedPlaylists, cachedDetails, recentPlays);
  const sourceInsights = hydratedInsights.length > 0 ? hydratedInsights : storedInsights;
  const { playlistInsights, changed } = reorderPlaylistInsightsFromRecentPlay(sourceInsights, recentPlays);
  const hydratedChanged = JSON.stringify(sourceInsights) !== JSON.stringify(storedInsights);

  if ((changed || hydratedChanged) && playlistInsights.length > 0) {
    await writeStoredPlaylistInsights(spotifyUserId, playlistInsights);
  }

  return playlistInsights;
}

export async function getDashboardPlaylistInsightPreview(spotifyUserId: string): Promise<PlaylistInsight[]> {
  return getCachedValue(`dashboard-playlist-preview:${spotifyUserId}`, DASHBOARD_PLAYLIST_PREVIEW_TTL_MS, async () => {
    const [storedInsights, storedPlaylists, cachedDetails, recentPlays] = await Promise.all([
      getStoredPlaylistInsights(spotifyUserId).catch(() => [] as PlaylistInsight[]),
      getStoredPlaylistLibrary(spotifyUserId).catch(() => [] as SpotifyPlaylist[]),
      getCachedPlaylistDetails(spotifyUserId).catch(() => [] as CachedPlaylistDetail[]),
      getStoredRecentPlays(spotifyUserId).catch(() => [] as StoredRecentPlay[]),
    ]);

    const hydratedInsights = hydrateStoredInsightsFromCachedDetails(storedInsights, storedPlaylists, cachedDetails, recentPlays);
    const sourceInsights = hydratedInsights.length > 0 ? hydratedInsights : storedInsights;
    const { playlistInsights } = reorderPlaylistInsightsFromRecentPlay(sourceInsights, recentPlays);
    return sortPlaylistInsights(uniqueById(playlistInsights), "last_listened_desc").slice(0, DASHBOARD_PLAYLIST_COUNT);
  });
}

export function invalidateDashboardPlaylistPreviewCache(spotifyUserId: string) {
  invalidateCachedValue(`dashboard-playlist-preview:${spotifyUserId}`);
}

export async function promoteRecentlyPlayedPlaylist(
  spotifyUserId: string,
  playlist: { id: string; name?: string; imageUrl?: string },
  playedAt = new Date().toISOString(),
): Promise<PlaylistInsight[]> {
  if (!playlist.id) {
    return [] as PlaylistInsight[];
  }

  const [storedInsights, storedLibrary, cachedDetails] = await Promise.all([
    getStoredPlaylistInsights(spotifyUserId),
    getStoredPlaylistLibrary(spotifyUserId),
    getCachedPlaylistDetails(spotifyUserId, [playlist.id]),
  ]);

  const currentTopPlaylistId = storedInsights[0]?.id;
  const existingInsight = storedInsights.find((entry) => entry.id === playlist.id);
  const cachedDetail = cachedDetails.find((detail) => detail.id === playlist.id);
  const storedPlaylist = storedLibrary.find((entry) => entry.id === playlist.id);

  const baseInsight = existingInsight
    ?? (cachedDetail && !isPlaylistDetailIncomplete(cachedDetail) ? toInsight(cachedDetail) : null)
    ?? (storedPlaylist ? toBasicInsight(storedPlaylist) : null)
    ?? {
      id: playlist.id,
      name: playlist.name ?? "Spotify playlist",
      mood: "Analysis pending",
      diversity: "Playlist cached, deeper analysis loading",
      overlap: "Open the playlist after more syncs",
      topGenresSummary: "Loading top genres",
      listeningCadence: "Refreshing recent playlist",
      imageUrl: playlist.imageUrl,
    };

  const nextInsight: PlaylistInsight = {
    ...baseInsight,
    id: playlist.id,
    name: playlist.name ?? baseInsight.name,
    imageUrl: playlist.imageUrl ?? baseInsight.imageUrl,
    lastListenedAt: playedAt,
  };

  const nextInsights = [
    nextInsight,
    ...storedInsights.filter((entry) => entry.id !== playlist.id),
  ].slice(0, Math.max(DASHBOARD_PLAYLIST_COUNT, storedInsights.length || DASHBOARD_PLAYLIST_COUNT));

  if (currentTopPlaylistId !== playlist.id || !existingInsight || existingInsight.lastListenedAt !== playedAt) {
    await writeStoredPlaylistInsights(spotifyUserId, nextInsights);
    invalidateCachedValue(`playlist-insights:${spotifyUserId}`);
  }

  return nextInsights;
}

async function getCachedPlaylistDetails(spotifyUserId: string, playlistIds?: string[]) {
  if (!hasMongoConfig()) {
    return [] as CachedPlaylistDetail[];
  }

  try {
    const db = await getDatabase();
    if (!db) {
      return [] as CachedPlaylistDetail[];
    }

    const query = playlistIds && playlistIds.length > 0
      ? { spotifyUserId, id: { $in: playlistIds } }
      : { spotifyUserId };

    return db.collection<CachedPlaylistDetail>(PLAYLIST_DETAIL_CACHE_COLLECTION).find(query).toArray();
  } catch {
    return [] as CachedPlaylistDetail[];
  }
}

async function getStoredPlaylistTrackSyncState(spotifyUserId: string, playlistId: string) {
  if (!hasMongoConfig()) {
    return null as StoredPlaylistTrackSyncState | null;
  }

  try {
    const db = await getDatabase();
    if (!db) {
      return null as StoredPlaylistTrackSyncState | null;
    }

    return await db.collection<StoredPlaylistTrackSyncState>(PLAYLIST_TRACK_SYNC_COLLECTION).findOne({ spotifyUserId, playlistId });
  } catch {
    return null as StoredPlaylistTrackSyncState | null;
  }
}

export async function getStoredPlaylistTrackItems(spotifyUserId: string, playlistId: string) {
  if (!hasMongoConfig()) {
    return [] as PlaylistTrackWithMeta[];
  }

  try {
    const db = await getDatabase();
    if (!db) {
      return [] as PlaylistTrackWithMeta[];
    }

    const records = await db
      .collection<StoredPlaylistTrackCacheItem>(PLAYLIST_TRACK_CACHE_COLLECTION)
      .find({ spotifyUserId, playlistId })
      .sort({ position: 1 })
      .toArray();

    return records
      .map((record): PlaylistTrackWithMeta | null => (
        record.classification === "analyzable" && isUsablePlaylistTrack(record.track)
          ? { addedAt: record.addedAt, addedById: record.addedById, track: record.track }
          : null
      ))
      .filter((record): record is PlaylistTrackWithMeta => Boolean(record));
  } catch {
    return [] as PlaylistTrackWithMeta[];
  }
}

export async function getStoredPlaylistTrackDiagnostics(
  spotifyUserId: string,
  playlistId: string,
  fallbackTotalItems = 0,
): Promise<PlaylistTrackDiagnostics> {
  const empty = {
    totalItems: fallbackTotalItems,
    fetchedItems: 0,
    analyzableTracks: 0,
    rejectedItems: 0,
    localItems: 0,
    unavailableItems: 0,
    partialItems: 0,
    unknownItems: 0,
    completed: false,
    unavailableTracks: [],
  } satisfies PlaylistTrackDiagnostics;

  if (!hasMongoConfig()) {
    return empty;
  }

  try {
    const db = await getDatabase();
    if (!db) {
      return empty;
    }

    const [records, syncState] = await Promise.all([
      db
        .collection<StoredPlaylistTrackCacheItem>(PLAYLIST_TRACK_CACHE_COLLECTION)
        .find({ spotifyUserId, playlistId })
        .sort({ position: 1 })
        .toArray(),
      db.collection<StoredPlaylistTrackSyncState>(PLAYLIST_TRACK_SYNC_COLLECTION).findOne({ spotifyUserId, playlistId }),
    ]);

    let analyzableTracks = 0;
    let localItems = 0;
    let unavailableItems = 0;
    let partialItems = 0;
    let unknownItems = 0;
    const unavailableTracks: PlaylistUnavailableTrackSummary[] = [];

    for (const record of records) {
      const classification = record.classification ?? (isUsablePlaylistTrack(record.track) ? "analyzable" : "unknown");

      if (classification === "analyzable") {
        analyzableTracks += 1;
        continue;
      }

      if (classification === "local") {
        localItems += 1;
        continue;
      }

      if (classification === "unavailable") {
        unavailableItems += 1;
        unavailableTracks.push({
          position: record.position + 1,
          title: record.title || "Unavailable track",
          artist: record.artistNames?.join(", ") || "Unknown artist",
          album: record.albumName || "Unknown release",
          reason: record.reason || "Spotify no longer returned metadata for this playlist item.",
          imageUrl: record.imageUrl,
        });
        continue;
      }

      if (classification === "partial") {
        partialItems += 1;
        continue;
      }

      unknownItems += 1;
    }

    const fetchedItems = Math.max(syncState?.fetchedCount ?? 0, records.length);
    const totalItems = Math.max(syncState?.totalTracks ?? 0, fallbackTotalItems, records.length);
    const rejectedItems = Math.max(0, fetchedItems - analyzableTracks);

    return {
      totalItems,
      fetchedItems,
      analyzableTracks,
      rejectedItems,
      localItems,
      unavailableItems,
      partialItems,
      unknownItems,
      completed: syncState?.completed ?? false,
      lastError: syncState?.lastError,
      unavailableTracks,
    };
  } catch {
    return empty;
  }
}

async function writeStoredPlaylistTrackPage(
  spotifyUserId: string,
  playlistId: string,
  trackItems: NormalizedStoredPlaylistTrackCacheRecord[],
  offset: number,
  totalTracks: number,
  options: { completed: boolean; nextOffset: number; lastError?: string },
) {
  if (!hasMongoConfig()) {
    return;
  }

  try {
    const db = await getDatabase();
    if (!db) {
      return;
    }

    const updatedAt = new Date().toISOString();

    if (trackItems.length > 0) {
      await db.collection<StoredPlaylistTrackCacheItem>(PLAYLIST_TRACK_CACHE_COLLECTION).bulkWrite(
        trackItems.map((item, index) => ({
          updateOne: {
            filter: { spotifyUserId, playlistId, position: offset + index },
            update: {
              $set: {
                spotifyUserId,
                playlistId,
                position: offset + index,
                ...item,
                updatedAt,
              },
            },
            upsert: true,
          },
        })),
        { ordered: false },
      );
    }

    await db.collection<StoredPlaylistTrackSyncState>(PLAYLIST_TRACK_SYNC_COLLECTION).updateOne(
      { spotifyUserId, playlistId },
      {
        $set: {
          spotifyUserId,
          playlistId,
          totalTracks,
          fetchedCount: Math.min(totalTracks, options.nextOffset),
          nextOffset: options.nextOffset,
          completed: options.completed,
          updatedAt,
          lastError: options.lastError,
        },
      },
      { upsert: true },
    );
  } catch {
    return;
  }
}

async function writeStoredPlaylistTrackSnapshot(
  spotifyUserId: string,
  playlistId: string,
  trackItems: PlaylistTrackWithMeta[],
  totalTracks: number,
) {
  await writeStoredPlaylistTrackSnapshotRecords(
    spotifyUserId,
    playlistId,
    trackItems.map(normalizeStoredPlaylistTrackRecordFromTrack),
    totalTracks,
  );
}

async function writeStoredPlaylistTrackSnapshotRecords(
  spotifyUserId: string,
  playlistId: string,
  trackItems: NormalizedStoredPlaylistTrackCacheRecord[],
  totalTracks: number,
) {
  await writeStoredPlaylistTrackPage(
    spotifyUserId,
    playlistId,
    trackItems,
    0,
    totalTracks,
    {
      completed: true,
    nextOffset: trackItems.length,
    },
  );
}

async function writeCachedPlaylistDetails(spotifyUserId: string, details: PlaylistDetail[]) {
  if (!hasMongoConfig() || details.length === 0) {
    return;
  }

  try {
    const db = await getDatabase();
    if (!db) {
      return;
    }

    await db.collection<CachedPlaylistDetail>(PLAYLIST_DETAIL_CACHE_COLLECTION).bulkWrite(
      details.map((detail) => ({
        updateOne: {
          filter: { spotifyUserId, id: detail.id },
          update: {
            $set: {
              ...detail,
              spotifyUserId,
              updatedAt: new Date().toISOString(),
            },
          },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  } catch {
    return;
  }
}

function toBasicInsight(playlist: SpotifyPlaylist, recentPlays: StoredRecentPlay[] = []): PlaylistInsight {
  return {
    id: playlist.id,
    name: playlist.name,
    imageUrl: playlist.images?.[0]?.url,
    trackCount: playlist.tracks?.total ?? 0,
    mood: "Analysis pending",
    diversity: "Playlist cached, deeper analysis loading",
    overlap: "Open the playlist after more syncs",
    topGenresSummary: "Loading top genres",
    listeningCadence: getPlaylistListeningCadence(playlist.id, recentPlays),
    lastListenedAt: deriveLastListenedAt(playlist.id, recentPlays),
  };
}
function uniqueById<T extends Identifiable>(items: T[]) {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const item of items) {
    if (!item.id || seen.has(item.id)) {
      continue;
    }

    seen.add(item.id);
    result.push(item);
  }

  return result;
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/(?:&|\$)#x27;/gi, "'")
    .replace(/(?:&|\$)#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&rsquo;/g, "’")
    .replace(/&lsquo;/g, "‘")
    .replace(/&rdquo;/g, "”")
    .replace(/&ldquo;/g, "“")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      try {
        return String.fromCodePoint(Number.parseInt(hex, 16));
      } catch {
        return "";
      }
    })
    .replace(/&#(\d+);/g, (_, code) => {
      try {
        return String.fromCodePoint(Number.parseInt(code, 10));
      } catch {
        return "";
      }
    })
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

async function fetchPublicPlaylistPageHtml(playlistId: string) {
  if (publicPlaylistHtmlCache.has(playlistId)) {
    return publicPlaylistHtmlCache.get(playlistId) ?? null;
  }

  try {
    const response = await fetch(`https://open.spotify.com/playlist/${playlistId}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 SoundScope",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(PUBLIC_SPOTIFY_WEB_TIMEOUT_MS),
    });

    const html = response.ok ? await response.text() : null;
    publicPlaylistHtmlCache.set(playlistId, html);
    return html;
  } catch {
    publicPlaylistHtmlCache.set(playlistId, null);
    return null;
  }
}

function scrapePlaylistTrackCountFromHtml(html: string) {
  const metaCount = html.match(/<meta\s+name="music:song_count"\s+content="(\d+)"/i)?.[1];
  if (metaCount) {
    return Number.parseInt(metaCount, 10);
  }

  const descriptionCount = html.match(/<meta\s+property="og:description"\s+content="[^"]*·\s*(\d+)\s+items"/i)?.[1];
  if (descriptionCount) {
    return Number.parseInt(descriptionCount, 10);
  }

  return 0;
}

function scrapePlaylistTrackItemsFromHtml(html: string) {
  const chunks = html.split('data-testid="track-row"').slice(1);

  return chunks
    .map((chunk): PlaylistTrackWithMeta | null => {
      const trackId = chunk.match(/href="\/track\/([A-Za-z0-9]{22})"/)?.[1];
      const title = chunk.match(/data-encore-id="listRowTitle"[^>]*><span[^>]*>([^<]+)<\/span>/)?.[1];
      const imageUrl = chunk.match(/<img[^>]+src="([^"]+)"/)?.[1];
      const artists = [...chunk.matchAll(/href="\/artist\/([A-Za-z0-9]{22})"[^>]*>([^<]+)<\/a>/g)]
        .map((match) => ({
          id: match[1],
          name: decodeHtmlEntities(match[2] ?? "").trim(),
        }))
        .filter((artist) => artist.name.length > 0);

      if (!trackId || !title || artists.length === 0) {
        return null;
      }

      const normalizedTitle = decodeHtmlEntities(title).trim();

      if (!normalizedTitle) {
        return null;
      }

      return {
        track: {
          id: trackId,
          name: normalizedTitle,
          popularity: 0,
          duration_ms: 0,
          album: {
            id: `public-playlist-track:${trackId}`,
            name: "Album metadata unavailable",
            images: imageUrl ? [{ url: imageUrl }] : undefined,
          },
          artists,
        },
      };
    })
    .filter((item): item is PlaylistTrackWithMeta => item !== null);
}

async function fetchTracksByIds(accessToken: string, trackIds: string[]) {
  if (trackIds.length === 0) {
    return [] as SpotifyTrack[];
  }

  const tracks: SpotifyTrack[] = [];

  for (let index = 0; index < trackIds.length; index += 50) {
    const chunk = trackIds.slice(index, index + 50);
    const response = await spotifyFetch<SpotifyTracksResponse>(`/tracks?ids=${chunk.join(",")}`, accessToken, { allowRetry: true });
    tracks.push(...(response.tracks ?? []).filter((track): track is SpotifyTrack => Boolean(track && isUsablePlaylistTrack(track))));
  }

  return tracks;
}

async function fetchPublicPlaylistTrackItems(accessToken: string, playlistId: string) {
  const html = await fetchPublicPlaylistPageHtml(playlistId);

  if (!html) {
    return [] as PlaylistTrackWithMeta[];
  }

  const scrapedTrackItems = scrapePlaylistTrackItemsFromHtml(html);
  if (scrapedTrackItems.length === 0) {
    return [] as PlaylistTrackWithMeta[];
  }

  try {
    const hydratedTracks = await fetchTracksByIds(accessToken, scrapedTrackItems.map((item) => item.track.id));
    if (hydratedTracks.length > 0) {
      const trackMap = new Map(hydratedTracks.map((track) => [track.id, track]));
      return scrapedTrackItems.map((item) => ({
        ...item,
        track: trackMap.get(item.track.id) ?? item.track,
      }));
    }
  } catch {
    // Fall back to track rows from the public playlist page.
  }

  return scrapedTrackItems;
}

async function fetchPlaylistsPage(accessToken: string, offset = 0) {
  return spotifyFetch<SpotifyPlaylistsResponse>(`/me/playlists?limit=${PLAYLIST_PAGE_LIMIT}&offset=${offset}`, accessToken);
}

async function fetchPlaylistById(accessToken: string, playlistId: string) {
  const playlist = await spotifyFetch<SpotifyPlaylist>(`/playlists/${playlistId}`, accessToken);

  if ((playlist.tracks?.total ?? 0) > 0) {
    return playlist;
  }

  const html = await fetchPublicPlaylistPageHtml(playlistId);
  if (!html) {
    return playlist;
  }

  const trackCount = scrapePlaylistTrackCountFromHtml(html);
  if (trackCount <= 0) {
    return playlist;
  }

  return {
    ...playlist,
    tracks: {
      total: trackCount,
      href: playlist.tracks?.href,
    },
  };
}

async function fetchAllPlaylists(accessToken: string) {
  const playlists: SpotifyPlaylist[] = [];
  let offset = 0;

  while (true) {
    const page = await fetchPlaylistsPage(accessToken, offset);
    playlists.push(...page.items
      .map((playlist) => normalizePlaylist(playlist))
      .filter((playlist): playlist is SpotifyPlaylist => Boolean(playlist)));

    if (!page.next || page.items.length === 0) {
      break;
    }

    offset += page.items.length;
  }

  return uniqueById(playlists);
}

async function fetchPlaylistTrackItems(accessToken: string, playlistId: string) {
  const snapshot = await fetchPlaylistTrackSnapshot(accessToken, playlistId);
  return snapshot.trackItems;
}

async function fetchPlaylistTrackSnapshot(accessToken: string, playlistId: string) {
  const tracks: PlaylistTrackWithMeta[] = [];
  const cacheRecords: NormalizedStoredPlaylistTrackCacheRecord[] = [];
  let offset = 0;
  let shouldUsePublicFallback = false;
  let fetchedItems = 0;

  while (true) {
    let response: SpotifyPlaylistTracksResponse;
    try {
      response = await spotifyFetch<SpotifyPlaylistTracksResponse>(
        `/playlists/${playlistId}/items?limit=100&offset=${offset}`,
        accessToken,
      );
    } catch {
      if (tracks.length > 0) {
        break;
      }

      shouldUsePublicFallback = true;
      break;
    }

    const pageRecords = response.items.map(normalizeStoredPlaylistTrackRecordFromTrackItem);
    const pageTracks = pageRecords
      .map((record): PlaylistTrackWithMeta | null => (
        record.classification === "analyzable" && isUsablePlaylistTrack(record.track)
          ? { addedAt: record.addedAt, addedById: record.addedById, track: record.track }
          : null
      ))
      .filter((item): item is PlaylistTrackWithMeta => item !== null);

    cacheRecords.push(...pageRecords);
    tracks.push(...pageTracks);
    fetchedItems += response.items.length;

    if (!response.next || response.items.length === 0) {
      break;
    }

    offset += response.items.length;
  }

  if (tracks.length > 0) {
    return {
      trackItems: tracks,
      cacheRecords,
      fetchedItems,
    };
  }

  if (shouldUsePublicFallback) {
    const publicTrackItems = await fetchPublicPlaylistTrackItems(accessToken, playlistId);
    return {
      trackItems: publicTrackItems,
      cacheRecords: publicTrackItems.map(normalizeStoredPlaylistTrackRecordFromTrack),
      fetchedItems: publicTrackItems.length,
    };
  }

  const publicTrackItems = await fetchPublicPlaylistTrackItems(accessToken, playlistId);
  return {
    trackItems: publicTrackItems,
    cacheRecords: publicTrackItems.map(normalizeStoredPlaylistTrackRecordFromTrack),
    fetchedItems: publicTrackItems.length,
  };
}

async function syncPlaylistTrackCache(
  accessToken: string,
  spotifyUserId: string,
  playlist: SpotifyPlaylist,
  options?: { maxPages?: number },
) {
  const totalTracks = playlist.tracks?.total ?? 0;
  if (totalTracks <= 0) {
    return {
      completed: true,
      fetchedCount: 0,
      nextOffset: 0,
    };
  }

  const maxPages = options?.maxPages ?? PLAYLIST_LARGE_SYNC_PAGES_PER_REQUEST;
  const syncState = await getStoredPlaylistTrackSyncState(spotifyUserId, playlist.id);
  let offset = syncState?.completed ? 0 : (syncState?.nextOffset ?? 0);
  let fetchedCount = syncState?.completed ? totalTracks : (syncState?.fetchedCount ?? 0);
  let completed = syncState?.completed ?? false;
  let pagesFetched = 0;

  while (pagesFetched < maxPages && offset < totalTracks) {
    try {
      const response = await spotifyFetch<SpotifyPlaylistTracksResponse>(
        `/playlists/${playlist.id}/items?limit=${PLAYLIST_SYNC_PAGE_SIZE}&offset=${offset}`,
        accessToken,
      );

      const trackItems = response.items.map(normalizeStoredPlaylistTrackRecordFromTrackItem);

      const nextOffset = offset + response.items.length;
      completed = !response.next || response.items.length === 0 || nextOffset >= totalTracks;
      fetchedCount = Math.max(fetchedCount, nextOffset);

      await writeStoredPlaylistTrackPage(
        spotifyUserId,
        playlist.id,
        trackItems,
        offset,
        totalTracks,
        {
          completed,
          nextOffset: completed ? 0 : nextOffset,
        },
      );

      if (completed || response.items.length === 0) {
        break;
      }

      offset = nextOffset;
      pagesFetched += 1;
    } catch (error) {
      await writeStoredPlaylistTrackPage(
        spotifyUserId,
        playlist.id,
        [],
        offset,
        totalTracks,
        {
          completed: false,
          nextOffset: offset,
          lastError: error instanceof Error ? error.message : String(error),
        },
      );
      break;
    }
  }

  return {
    completed,
    fetchedCount,
    nextOffset: completed ? 0 : offset,
    totalTracks,
  };
}

function toStoredArtistMetadata(artist: SpotifyArtist): StoredArtistMetadata | null {
  if (!artist?.id || !artist.name) {
    return null;
  }

  return {
    artistId: artist.id,
    name: artist.name,
    genres: Array.isArray(artist.genres) ? artist.genres : [],
    imageUrl: artist.images?.[0]?.url,
    popularity: artist.popularity ?? 0,
    updatedAt: new Date().toISOString(),
  };
}

function toSpotifyArtistFromStoredMetadata(artist: StoredArtistMetadata): SpotifyArtist {
  return {
    id: artist.artistId,
    name: artist.name,
    genres: artist.genres ?? [],
    popularity: artist.popularity ?? 0,
    images: artist.imageUrl ? [{ url: artist.imageUrl }] : undefined,
  };
}

async function getStoredArtistMetadataByIdsForPlaylistAnalysis(artistIds: string[]) {
  const uniqueArtistIds = [...new Set(artistIds.filter(Boolean))];

  if (!hasMongoConfig() || uniqueArtistIds.length === 0) {
    return [] as SpotifyArtist[];
  }

  try {
    const db = await getDatabase();
    if (!db) {
      return [] as SpotifyArtist[];
    }

    const records = await db
      .collection<StoredArtistMetadata>(ARTIST_METADATA_COLLECTION)
      .find({ artistId: { $in: uniqueArtistIds } })
      .toArray();

    return records.map(toSpotifyArtistFromStoredMetadata);
  } catch {
    return [] as SpotifyArtist[];
  }
}

async function getMissingStoredArtistMetadataIdsForPlaylistAnalysis(artistIds: string[]) {
  const uniqueArtistIds = [...new Set(artistIds.filter(Boolean))];

  if (!hasMongoConfig() || uniqueArtistIds.length === 0) {
    return [] as string[];
  }

  try {
    const db = await getDatabase();
    if (!db) {
      return uniqueArtistIds;
    }

    const records = await db
      .collection<StoredArtistMetadata>(ARTIST_METADATA_COLLECTION)
      .find({ artistId: { $in: uniqueArtistIds } })
      .project<{ artistId: string }>({ artistId: 1 })
      .toArray();

    const storedIds = new Set(records.map((record) => record.artistId));
    return uniqueArtistIds.filter((artistId) => !storedIds.has(artistId));
  } catch {
    return uniqueArtistIds;
  }
}

async function writeStoredArtistMetadataForPlaylistAnalysis(artists: SpotifyArtist[]) {
  const metadata = artists
    .map((artist) => toStoredArtistMetadata(artist))
    .filter((artist): artist is StoredArtistMetadata => Boolean(artist));

  if (!hasMongoConfig() || metadata.length === 0) {
    return;
  }

  try {
    const db = await getDatabase();
    if (!db) {
      return;
    }

    await db.collection<StoredArtistMetadata>(ARTIST_METADATA_COLLECTION).bulkWrite(
      metadata.map((artist) => ({
        updateOne: {
          filter: { artistId: artist.artistId },
          update: { $set: artist },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  } catch {
    return;
  }
}

async function fetchArtists(accessToken: string, artistIds: string[]) {
  const uniqueArtistIds = [...new Set(artistIds)];

  if (uniqueArtistIds.length === 0) {
    return [] as SpotifyArtist[];
  }

  const artistChunks = Array.from(
    { length: Math.ceil(uniqueArtistIds.length / 50) },
    (_, index) => uniqueArtistIds.slice(index * 50, index * 50 + 50),
  );

  try {
    const responses = await Promise.all(
      artistChunks.map((chunk) => spotifyFetch<{ artists: SpotifyArtist[] }>(`/artists?ids=${chunk.join(",")}`, accessToken)),
    );
    return responses.flatMap((response) => response.artists ?? []);
  } catch {
    try {
      const clientToken = await getSpotifyClientCredentialsToken();
      const responses = await Promise.all(
        artistChunks.map((chunk) =>
          spotifyFetch<{ artists: SpotifyArtist[] }>(`/artists?ids=${chunk.join(",")}`, clientToken, { allowRetry: true }),
        ),
      );
      return responses.flatMap((response) => response.artists ?? []);
    } catch {
      return [] as SpotifyArtist[];
    }
  }
}

function getTopArtistIdsByFrequency(tracks: SpotifyTrack[], limit = PLAYLIST_ARTIST_METADATA_LIMIT) {
  const artistCounts = new Map<string, number>();

  tracks.forEach((track) => {
    track.artists.forEach((artist) => {
      if (!artist.id) {
        return;
      }

      artistCounts.set(artist.id, (artistCounts.get(artist.id) ?? 0) + 1);
    });
  });

  return [...artistCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([artistId]) => artistId);
}

async function fetchAudioFeatures(accessToken: string, tracks: SpotifyTrack[]) {
  const trackIds = uniqueById(tracks).map((track) => track.id).slice(0, PLAYLIST_AUDIO_FEATURE_SAMPLE_LIMIT);

  if (trackIds.length === 0) {
    return [] as SpotifyAudioFeature[];
  }

  try {
    const trackChunks = Array.from(
      { length: Math.ceil(trackIds.length / 50) },
      (_, index) => trackIds.slice(index * 50, index * 50 + 50),
    );
    const responses = await Promise.all(
      trackChunks.map((chunk) => spotifyFetch<SpotifyAudioFeaturesResponse>(`/audio-features?ids=${chunk.join(",")}`, accessToken)),
    );
    return responses.flatMap((response) =>
      response.audio_features.filter((feature): feature is SpotifyAudioFeature => Boolean(feature)),
    );
  } catch {
    return [] as SpotifyAudioFeature[];
  }
}

function getDominantMood(features: SpotifyAudioFeature[]) {
  if (features.length === 0) {
    return null;
  }

  const buckets = {
    energetic: 0,
    chill: 0,
    moody: 0,
    joyful: 0,
    focus: 0,
  };

  features.forEach((feature) => {
    if (feature.energy >= 0.72 || feature.tempo >= 124) buckets.energetic += 1;
    if (feature.energy < 0.45 && feature.acousticness >= 0.35) buckets.chill += 1;
    if (feature.valence < 0.4 && feature.energy < 0.65) buckets.moody += 1;
    if (feature.valence >= 0.62 && feature.danceability >= 0.55) buckets.joyful += 1;
    if (feature.instrumentalness >= 0.35 || feature.speechiness < 0.05) buckets.focus += 1;
  });

  const [mood, count] = Object.entries(buckets).sort((a, b) => b[1] - a[1])[0];
  return `${mood.charAt(0).toUpperCase() + mood.slice(1)} leaning (${Math.round((count / features.length) * 100)}% match)`;
}

function getFallbackMood(tracks: SpotifyTrack[]) {
  if (tracks.length === 0) return "Not enough tracks yet";

  const popularAverage = tracks.reduce((sum, track) => sum + track.popularity, 0) / tracks.length;
  if (popularAverage >= 75) return "Big-pop energy mix";
  if (popularAverage >= 60) return "Steady mood pocket";
  return "Deep-cut leaning set";
}

function buildGenreSummary(artists: SpotifyArtist[]): PlaylistGenreSummary[] {
  const genreCounts = new Map<string, number>();

  artists.forEach((artist) => {
    artist.genres.forEach((genre) => {
      genreCounts.set(genre, (genreCounts.get(genre) ?? 0) + 1);
    });
  });

  return [...genreCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([genre, count]) => ({ genre, count }));
}

function buildGenreSummaryFromArtistTags(tracks: SpotifyTrack[], artistTags: Map<string, string[]>) {
  const genreCounts = new Map<string, number>();

  tracks.forEach((track) => {
    const trackGenres = new Set<string>();

    track.artists.forEach((artist) => {
      (artistTags.get(artist.name.toLowerCase()) ?? []).forEach((genre) => trackGenres.add(genre));
    });

    trackGenres.forEach((genre) => {
      genreCounts.set(genre, (genreCounts.get(genre) ?? 0) + 1);
    });
  });

  return [...genreCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([genre, count]) => ({ genre, count }));
}

function buildGenreSummaryFromArtistGenreMap(tracks: SpotifyTrack[], artistGenres: Map<string, string[]>) {
  const genreCounts = new Map<string, number>();

  tracks.forEach((track) => {
    const trackGenres = new Set<string>();

    track.artists.forEach((artist) => {
      (artistGenres.get(artist.name.toLowerCase()) ?? []).forEach((genre) => trackGenres.add(genre));
    });

    trackGenres.forEach((genre) => {
      genreCounts.set(genre, (genreCounts.get(genre) ?? 0) + 1);
    });
  });

  return [...genreCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([genre, count]) => ({ genre, count }));
}

async function fetchMusicBrainzArtistTags(artistNames: string[]) {
  const uniqueNames = [...new Set(artistNames.map((name) => name.trim()).filter(Boolean))].slice(0, PLAYLIST_PUBLIC_TAG_FETCH_LIMIT);
  const tagMap = new Map<string, string[]>();

  await Promise.all(uniqueNames.map(async (artistName) => {
    try {
      const response = await fetch(`https://musicbrainz.org/ws/2/artist/?query=${encodeURIComponent(artistName)}&fmt=json&limit=1`, {
        headers: {
          "User-Agent": MUSICBRAINZ_USER_AGENT,
        },
        cache: "no-store",
      });

      if (!response.ok) {
        return;
      }

      const payload = await response.json() as {
        artists?: Array<{ score?: number | string; tags?: Array<{ name?: string }> }>;
      };
      const match = payload.artists?.[0];
      const score = Number(match?.score ?? 0);
      const tags = (match?.tags ?? [])
        .map((tag) => tag.name?.trim().toLowerCase() ?? "")
        .filter((tag) => tag.length > 2)
        .slice(0, 5);

      if (score >= 80 && tags.length > 0) {
        tagMap.set(artistName.toLowerCase(), tags);
      }
    } catch {
      return;
    }
  }));

  return tagMap;
}

function buildGenreSummaryFromTextFallback(tracks: SpotifyTrack[]): PlaylistGenreSummary[] {
  const text = tracks
    .flatMap((track) => [
      track.name,
      track.album?.name,
      ...track.artists.map((artist) => artist.name),
    ])
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const genreScores = new Map<string, number>();

  function add(genre: string, score: number) {
    genreScores.set(genre, (genreScores.get(genre) ?? 0) + score);
  }

  if (/(lo[-\s]?fi|jhfly|flovry|kendall miles|i eat plants|tender spring|chillhop|beats?)/i.test(text)) {
    add("lo-fi beats", tracks.length);
    add("instrumental hip hop", Math.max(1, Math.round(tracks.length * 0.7)));
  }

  if (/(dream|memory|warm|soft|sleep|ambient|hazy|sequence|drift)/i.test(text)) {
    add("ambient chill", Math.max(1, Math.round(tracks.length * 0.6)));
  }

  if (/(jazz|bossa|soul|groove|keys|piano)/i.test(text)) {
    add("jazz-influenced", Math.max(1, Math.round(tracks.length * 0.5)));
  }

  if (genreScores.size === 0 && tracks.length > 0) {
    add("public playlist deep cuts", tracks.length);
  }

  return [...genreScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([genre, count]) => ({ genre, count }));
}

function normalizeArtistName(value: string) {
  return value.trim().toLowerCase();
}

async function fetchSpotifyArtistGenresBySearch(artistNames: string[]) {
  const uniqueNames = [...new Set(artistNames.map((name) => name.trim()).filter(Boolean))].slice(0, PLAYLIST_PUBLIC_TAG_FETCH_LIMIT);
  const genreMap = new Map<string, string[]>();

  if (uniqueNames.length === 0) {
    return genreMap;
  }

  try {
    const clientToken = await getSpotifyClientCredentialsToken();

    await Promise.all(uniqueNames.map(async (artistName) => {
      try {
        const response = await spotifyFetch<{
          artists?: {
            items?: Array<{ name?: string; genres?: string[] }>;
          };
        }>(`/search?q=${encodeURIComponent(artistName)}&type=artist&limit=1`, clientToken, { allowRetry: false });

        const match = response.artists?.items?.[0];
        const normalizedRequested = normalizeArtistName(artistName);
        const normalizedMatched = normalizeArtistName(match?.name ?? "");
        const genres = Array.isArray(match?.genres) ? match.genres.filter(Boolean) : [];

        if (genres.length === 0) {
          return;
        }

        if (
          normalizedMatched === normalizedRequested ||
          normalizedMatched.includes(normalizedRequested) ||
          normalizedRequested.includes(normalizedMatched)
        ) {
          genreMap.set(normalizedRequested, genres);
        }
      } catch {
        return;
      }
    }));
  } catch {
    return genreMap;
  }

  return genreMap;
}

function getTopArtistNamesByFrequency(tracks: SpotifyTrack[], limit = PLAYLIST_PUBLIC_TAG_FETCH_LIMIT) {
  const artistCounts = new Map<string, number>();

  tracks.forEach((track) => {
    track.artists.forEach((artist) => {
      const name = artist.name.trim();
      if (!name) {
        return;
      }

      artistCounts.set(name, (artistCounts.get(name) ?? 0) + 1);
    });
  });

  return [...artistCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name]) => name);
}

function formatTopGenresSummary(topGenres: PlaylistGenreSummary[]) {
  if (topGenres.length === 0) {
    return "Genre metadata is sparse here";
  }

  const names = topGenres.slice(0, 3).map((genre) => genre.genre);

  if (names.length === 1) {
    return names[0];
  }

  if (names.length === 2) {
    return `${names[0]} and ${names[1]}`;
  }

  return `${names[0]}, ${names[1]}, and ${names[2]}`;
}

function getGenreDiversity(artists: SpotifyArtist[], trackCount: number) {
  const topGenres = buildGenreSummary(artists);
  const uniqueGenres = topGenres.length === 0 ? 0 : new Set(artists.flatMap((artist) => artist.genres)).size;
  const topGenreCount = topGenres[0]?.count ?? 0;
  const topGenreShare = artists.length > 0 ? Math.round((topGenreCount / artists.length) * 100) : 0;

  if (uniqueGenres >= 10) return `Wide palette, ${uniqueGenres} genres in ${trackCount} tracks`;
  if (uniqueGenres >= 5) return `Balanced mix, top lane only ${topGenreShare}%`;
  if (uniqueGenres > 0) return `Focused palette, ${uniqueGenres} core genres`;
  return "Genre metadata is sparse here";
}

function getGenreDiversityFromTopGenres(topGenres: PlaylistGenreSummary[], trackCount: number) {
  const uniqueGenres = topGenres.length;
  const topGenreCount = topGenres[0]?.count ?? 0;
  const topGenreShare = trackCount > 0 ? Math.round((topGenreCount / trackCount) * 100) : 0;

  if (uniqueGenres >= 5) return `Wide palette, ${uniqueGenres} genre signals across ${trackCount} tracks`;
  if (uniqueGenres >= 3) return `Balanced mix, top lane around ${topGenreShare}%`;
  if (uniqueGenres > 0) return `Focused palette, ${uniqueGenres} core genres`;
  return "Genre metadata is sparse here";
}

function getPlaylistListeningCadence(playlistId: string, recentPlays: StoredRecentPlay[]) {
  const playlistPlays = recentPlays.filter((play) => play.playlistId === playlistId);

  if (playlistPlays.length === 0) {
    return "No tracked playlist plays yet";
  }

  const activeDays = new Set(playlistPlays.map((play) => play.playedAt.slice(0, 10))).size;
  const thisWeekCount = playlistPlays.filter((play) => Date.now() - new Date(play.playedAt).getTime() <= 7 * 24 * 60 * 60 * 1000).length;

  if (playlistPlays.length === 1) {
    return thisWeekCount === 1 ? "1 tracked play this week" : "1 tracked play in recent history";
  }

  const playLabel = `${playlistPlays.length} tracked plays across ${activeDays} day${activeDays === 1 ? "" : "s"}`;

  if (thisWeekCount > 0) {
    return `${playLabel}, ${thisWeekCount} this week`;
  }

  return `${playLabel} in recent history`;
}

function buildArtistSummary(tracks: SpotifyTrack[]): PlaylistArtistSummary[] {
  const artistCounts = new Map<string, number>();

  tracks.forEach((track) => {
    track.artists.forEach((artist) => {
      artistCounts.set(artist.name, (artistCounts.get(artist.name) ?? 0) + 1);
    });
  });

  return [...artistCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([artist, count]) => ({ artist, count }));
}

function getRedundancy(tracks: SpotifyTrack[]) {
  const artistCounts = new Map<string, number>();
  const albumCounts = new Map<string, number>();

  tracks.forEach((track) => {
    const primaryArtist = track.artists[0]?.name ?? "Unknown Artist";
    const albumKey = track.album.id ?? track.album.name;
    artistCounts.set(primaryArtist, (artistCounts.get(primaryArtist) ?? 0) + 1);
    albumCounts.set(albumKey, (albumCounts.get(albumKey) ?? 0) + 1);
  });

  const repeatedArtistTracks = [...artistCounts.values()].filter((count) => count > 1).reduce((sum, count) => sum + count, 0);
  const repeatedAlbumTracks = [...albumCounts.values()].filter((count) => count > 1).reduce((sum, count) => sum + count, 0);
  const artistShare = tracks.length > 0 ? Math.round((repeatedArtistTracks / tracks.length) * 100) : 0;
  const albumShare = tracks.length > 0 ? Math.round((repeatedAlbumTracks / tracks.length) * 100) : 0;

  if (artistShare <= 25 && albumShare <= 25) return "Low overlap, healthy rotation";
  if (artistShare >= 50 || albumShare >= 50) return `High repeat load, ${Math.max(artistShare, albumShare)}% overlap pocket`;
  return `Moderate overlap, ${artistShare}% artist repeat`;
}

function buildRepeatedTracks(tracks: SpotifyTrack[]): PlaylistTrackSummary[] {
  const counts = new Map<string, { count: number; track: SpotifyTrack }>();

  tracks.forEach((track) => {
    const existing = counts.get(track.id) ?? { count: 0, track };
    existing.count += 1;
    counts.set(track.id, existing);
  });

  return [...counts.values()]
    .filter((entry) => entry.count > 1)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .map(({ track }) => ({
      id: track.id,
      title: track.name,
      artist: track.artists.map((artist) => artist.name).join(", "),
      album: track.album.name,
      imageUrl: track.album.images?.[0]?.url,
    }));
}

function buildSampleTracks(tracks: SpotifyTrack[]): PlaylistTrackSummary[] {
  return uniqueById(tracks)
    .slice(0, 6)
    .map((track) => ({
      id: track.id,
      title: track.name,
      artist: track.artists.map((artist) => artist.name).join(", "),
      album: track.album.name,
      imageUrl: track.album.images?.[0]?.url,
    }));
}

function buildTopTracks(
  tracks: SpotifyTrack[],
  allTimeTrackAffinity = new Map<string, TrackAffinity>(),
  mode: "history" | "popularity" = "history",
): PlaylistTrackSummary[] {
  return uniqueById(tracks)
    .sort((a, b) => {
      if (mode === "popularity") {
        return b.popularity - a.popularity || a.name.localeCompare(b.name);
      }

      const aAffinity = allTimeTrackAffinity.get(a.id);
      const bAffinity = allTimeTrackAffinity.get(b.id);

      if (aAffinity && bAffinity) {
        return bAffinity.playCount - aAffinity.playCount || (bAffinity.lastPlayedAt ?? "").localeCompare(aAffinity.lastPlayedAt ?? "");
      }

      if (aAffinity) {
        return -1;
      }

      if (bAffinity) {
        return 1;
      }

      return b.popularity - a.popularity || a.name.localeCompare(b.name);
    })
    .slice(0, 8)
    .map((track) => ({
      id: track.id,
      title: track.name,
      artist: track.artists.map((artist) => artist.name).join(", "),
      album: track.album.name,
      imageUrl: track.album.images?.[0]?.url,
    }));
}

async function getAllTimeArtistGenreMap(spotifyUserId: string) {
  try {
    const topLists = await getSpotifyTopListsFromHistory(spotifyUserId, "all", FULL_TOP_LIST_LIMIT);
    return new Map(
      (topLists?.artists ?? [])
        .filter((artist) => artist.genres.length > 0)
        .map((artist) => [artist.name.toLowerCase(), artist.genres]),
    );
  } catch {
    return new Map<string, string[]>();
  }
}

async function getAllTimeTrackAffinityMap(spotifyUserId: string) {
  try {
    const recentPlays = await getStoredRecentPlays(spotifyUserId);
    const affinity = new Map<string, TrackAffinity>();

    recentPlays.forEach((play) => {
      const current = affinity.get(play.trackId) ?? { playCount: 0, lastPlayedAt: undefined };
      current.playCount += 1;
      if (!current.lastPlayedAt || play.playedAt > current.lastPlayedAt) {
        current.lastPlayedAt = play.playedAt;
      }
      affinity.set(play.trackId, current);
    });

    return affinity;
  } catch {
    return new Map<string, TrackAffinity>();
  }
}

function buildListenTimeline(playlistId: string, recentPlays: StoredRecentPlay[]): PlaylistListenTimelinePoint[] {
  const counts = new Map<string, number>();

  recentPlays
    .filter((play) => play.playlistId === playlistId)
    .forEach((play) => {
      const dayKey = play.playedAt.slice(0, 10);
      counts.set(dayKey, (counts.get(dayKey) ?? 0) + 1);
    });

  return [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-14)
    .map(([day, listens]) => ({
      label: new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: PST_TIME_ZONE }).format(new Date(`${day}T00:00:00.000Z`)),
      playedAt: `${day}T00:00:00.000Z`,
      listens,
    }));
}

function deriveCreatedAt(trackItems: PlaylistTrackWithMeta[]) {
  const timestamps = trackItems
    .map((item) => item.addedAt)
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value));

  if (timestamps.length === 0) {
    return undefined;
  }

  return new Date(Math.min(...timestamps)).toISOString();
}

function deriveLastListenedAt(playlistId: string, recentPlays: StoredRecentPlay[]) {
  if (recentPlays.length === 0) {
    return undefined;
  }

  return recentPlays.find((item) => item.playlistId === playlistId)?.playedAt;
}

function sortPlaylistInsights(playlists: PlaylistInsight[], sort: PlaylistSortOption) {
  const resolveValue = (value: string | undefined, missing: number) => {
    const parsed = value ? new Date(value).getTime() : Number.NaN;
    return Number.isFinite(parsed) ? parsed : missing;
  };

  return [...playlists].sort((a, b) => {
    if (sort === "created_asc") {
      return resolveValue(a.createdAt, Number.POSITIVE_INFINITY) - resolveValue(b.createdAt, Number.POSITIVE_INFINITY);
    }

    if (sort === "last_listened_desc") {
      return resolveValue(b.lastListenedAt, Number.NEGATIVE_INFINITY) - resolveValue(a.lastListenedAt, Number.NEGATIVE_INFINITY);
    }

    if (sort === "last_listened_asc") {
      return resolveValue(a.lastListenedAt, Number.POSITIVE_INFINITY) - resolveValue(b.lastListenedAt, Number.POSITIVE_INFINITY);
    }

    return resolveValue(b.createdAt, Number.NEGATIVE_INFINITY) - resolveValue(a.createdAt, Number.NEGATIVE_INFINITY);
  });
}

async function analyzePlaylist(
  accessToken: string,
  playlist: SpotifyPlaylist,
  recentPlays: StoredRecentPlay[] = [],
  allTimeTrackAffinity = new Map<string, TrackAffinity>(),
  allTimeArtistGenres = new Map<string, string[]>(),
  topTrackMode: "history" | "popularity" = "history",
): Promise<PlaylistDetail | null> {
  let trackItems: PlaylistTrackWithMeta[];
  try {
    trackItems = await fetchPlaylistTrackItems(accessToken, playlist.id);
  } catch {
    trackItems = [];
  }

  if (trackItems.length === 0) {
    return null;
  }

  return analyzePlaylistFromTrackItems(
    playlist,
    trackItems,
    recentPlays,
    allTimeTrackAffinity,
    allTimeArtistGenres,
    accessToken,
    topTrackMode,
  );
}

async function analyzePlaylistFromTrackItems(
  playlist: SpotifyPlaylist,
  trackItems: PlaylistTrackWithMeta[],
  recentPlays: StoredRecentPlay[] = [],
  allTimeTrackAffinity = new Map<string, TrackAffinity>(),
  allTimeArtistGenres = new Map<string, string[]>(),
  accessToken?: string,
  topTrackMode: "history" | "popularity" = "history",
): Promise<PlaylistDetail | null> {
  if (trackItems.length === 0) {
    return null;
  }

  const tracks = trackItems.map((item) => item.track);
  const artistIds = getTopArtistIdsByFrequency(tracks);
  const [artists, features] = await Promise.all([
    accessToken
      ? fetchArtists(accessToken, artistIds).catch(() => [] as SpotifyArtist[])
      : getStoredArtistMetadataByIdsForPlaylistAnalysis(artistIds).catch(() => [] as SpotifyArtist[]),
    accessToken ? fetchAudioFeatures(accessToken, tracks).catch(() => [] as SpotifyAudioFeature[]) : Promise.resolve([] as SpotifyAudioFeature[]),
  ]);

  const uniqueArtists = new Set(tracks.flatMap((track) => track.artists.map((artist) => artist.name)));
  const uniqueAlbums = new Set(tracks.map((track) => track.album.id ?? track.album.name));

  let topGenres = buildGenreSummary(artists);

  if (topGenres.length === 0 && allTimeArtistGenres.size > 0) {
    topGenres = buildGenreSummaryFromArtistGenreMap(tracks, allTimeArtistGenres);
  }

  if (topGenres.length === 0 && accessToken) {
    const spotifySearchGenres = await fetchSpotifyArtistGenresBySearch(
      getTopArtistNamesByFrequency(tracks),
    ).catch(() => new Map<string, string[]>());

    if (spotifySearchGenres.size > 0) {
      topGenres = buildGenreSummaryFromArtistGenreMap(tracks, spotifySearchGenres);
    }
  }

if (topGenres.length === 0) {
  const artistTags = await fetchMusicBrainzArtistTags(
    getTopArtistNamesByFrequency(tracks),
  ).catch(() => new Map<string, string[]>());

  if (artistTags.size > 0) {
    await writeMusicBrainzGenresToPermanentArtistCache(tracks, artistTags).catch(() => undefined);
    topGenres = buildGenreSummaryFromArtistTags(tracks, artistTags);
  }

  if (topGenres.length === 0) {
    topGenres = buildGenreSummaryFromTextFallback(tracks);
  }
}
  const sampleTracks = buildSampleTracks(tracks);
  const topTracks = buildTopTracks(tracks, allTimeTrackAffinity, topTrackMode);

  return {
    id: playlist.id,
    name: playlist.name,
    imageUrl: playlist.images?.[0]?.url ?? tracks[0]?.album.images?.[0]?.url,
    ownerName: playlist.owner?.display_name,
    trackCount: tracks.length,
    uniqueArtistCount: uniqueArtists.size,
    uniqueAlbumCount: uniqueAlbums.size,
    mood: getDominantMood(features) ?? getFallbackMood(tracks),
    diversity: topGenres.length > 0
      ? (artists.length > 0 ? getGenreDiversity(artists, tracks.length) : getGenreDiversityFromTopGenres(topGenres, tracks.length))
      : getGenreDiversity(artists, tracks.length),
    overlap: getRedundancy(tracks),
    listeningCadence: getPlaylistListeningCadence(playlist.id, recentPlays),
    createdAt: deriveCreatedAt(trackItems),
    lastListenedAt: deriveLastListenedAt(playlist.id, recentPlays),
    topGenres,
    topArtists: buildArtistSummary(tracks),
    repeatedTracks: buildRepeatedTracks(tracks),
    sampleTracks,
    topTracks,
    listenTimeline: buildListenTimeline(playlist.id, recentPlays),
  };
}

async function analyzeManyPlaylists(
  accessToken: string,
  playlists: SpotifyPlaylist[],
  recentPlays: StoredRecentPlay[] = [],
  allTimeTrackAffinity = new Map<string, TrackAffinity>(),
  allTimeArtistGenres = new Map<string, string[]>(),
) {
  const results: PlaylistDetail[] = [];

  for (let index = 0; index < playlists.length; index += PLAYLIST_ANALYSIS_CONCURRENCY) {
    const batch = playlists.slice(index, index + PLAYLIST_ANALYSIS_CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map((playlist) => analyzePlaylist(accessToken, playlist, recentPlays, allTimeTrackAffinity, allTimeArtistGenres)),
    );
    results.push(...batchResults.filter((detail): detail is PlaylistDetail => Boolean(detail)));
  }

  return results;
}

function toInsight(detail: PlaylistDetail, recentPlays: StoredRecentPlay[] = []): PlaylistInsight {
  return {
    id: detail.id,
    name: detail.name,
    mood: detail.mood,
    diversity: detail.diversity,
    overlap: detail.overlap,
    topGenresSummary: formatTopGenresSummary(detail.topGenres),
    listeningCadence: getPlaylistListeningCadence(detail.id, recentPlays),
    imageUrl: detail.imageUrl,
    trackCount: detail.trackCount,
    createdAt: detail.createdAt,
    lastListenedAt: detail.lastListenedAt,
  };
}

async function getRecentHistory(accessToken: string, spotifyUserId: string) {
  const storedRecent = await getStoredRecentPlays(spotifyUserId).catch(() => [] as StoredRecentPlay[]);
  const storedPlaylistPlays = storedRecent.filter((play) => Boolean(play.playlistId));

  const syncedRecent = await getCachedValue(
    `playlist-recent-sync:${spotifyUserId}`,
    PLAYLIST_RECENT_SYNC_TTL_MS,
    () => syncRecentPlays(accessToken, spotifyUserId).catch(() => storedRecent),
  ).catch(() => storedRecent as StoredRecentPlay[]);

  const preferredRecent = storedPlaylistPlays.length > 0 ? storedRecent : syncedRecent;

  return uniqueById(
    [...preferredRecent, ...storedRecent].map((play) => ({
      id: `${play.trackId}:${play.playedAt}`,
      ...play,
    })),
  ).map(({ id: _id, ...play }) => play);
}

function getRecentPlaylistCandidates(recentPlays: StoredRecentPlay[], currentPlaylistId?: string, fallbackPlaylistIds: string[] = []) {
  const seen = new Set<string>();
  const playlistIds: string[] = [];

  if (currentPlaylistId) {
    seen.add(currentPlaylistId);
    playlistIds.push(currentPlaylistId);
  }

  for (const play of recentPlays) {
    if (!play.playlistId || seen.has(play.playlistId)) {
      continue;
    }

    seen.add(play.playlistId);
    playlistIds.push(play.playlistId);

    if (playlistIds.length >= DASHBOARD_PLAYLIST_COUNT) {
      return playlistIds;
    }
  }

  for (const playlistId of fallbackPlaylistIds) {
    if (!playlistId || seen.has(playlistId)) {
      continue;
    }

    seen.add(playlistId);
    playlistIds.push(playlistId);

    if (playlistIds.length >= DASHBOARD_PLAYLIST_COUNT) {
      break;
    }
  }

  return playlistIds;
}

function playlistFromPlaybackSource(
  currentPlaybackSource: Awaited<ReturnType<typeof getCurrentPlaybackSource>> | undefined,
  fallbackTrackCount = 0,
): SpotifyPlaylist | null {
  if (!currentPlaybackSource || currentPlaybackSource.type !== "playlist" || !currentPlaybackSource.playlistId) {
    return null;
  }

  return {
    id: currentPlaybackSource.playlistId,
    name: currentPlaybackSource.label || "Spotify playlist",
    images: currentPlaybackSource.imageUrl ? [{ url: currentPlaybackSource.imageUrl }] : undefined,
    tracks: {
      total: fallbackTrackCount,
    },
  };
}

function getPrimaryMoodLabel(detail: Pick<PlaylistDetail, "topGenres">) {
  const moodInsights = deriveGenreBasedMoodInsightsFromSummaries(detail.topGenres);
  return [...moodInsights.moodData].sort((a, b) => b.share - a.share)[0]?.mood ?? "Bright Pulse";
}

export async function getPublicPlaylistInsights(accessToken: string, playlists: SpotifyPlaylist[], limit = DASHBOARD_PLAYLIST_COUNT): Promise<PlaylistInsight[]> {
  if (playlists.length === 0) {
    return [] as PlaylistInsight[];
  }

  const details = await analyzeManyPlaylists(accessToken, playlists.slice(0, limit), []);

  if (details.length > 0) {
    return uniqueById(details.map((detail) => ({
      ...toInsight(detail, []),
      mood: getPrimaryMoodLabel(detail),
      listeningCadence: "Public playlist snapshot only",
      lastListenedAt: undefined,
    })));
  }

  return playlists.slice(0, limit).map((playlist) => ({
    ...toBasicInsight(playlist, []),
    listeningCadence: "Public playlist snapshot only",
  }));
}

export async function getPublicPlaylistDetail(accessToken: string, playlistId: string): Promise<PlaylistDetail | null> {
  try {
    const playlist = await fetchPlaylistById(accessToken, playlistId);
    const detail = await analyzePlaylist(accessToken, playlist, [], new Map<string, TrackAffinity>(), new Map<string, string[]>(), "popularity");

    if (detail) {
      return {
        ...detail,
        mood: getPrimaryMoodLabel(detail),
        listeningCadence: "Public playlist snapshot only",
        lastListenedAt: undefined,
        listenTimeline: [],
      };
    }

    return {
      ...toBasicInsight(playlist, []),
      id: playlist.id,
      trackCount: playlist.tracks?.total ?? 0,
      ownerName: playlist.owner?.display_name,
      uniqueArtistCount: 0,
      uniqueAlbumCount: 0,
      listeningCadence: "Public playlist snapshot only",
      topGenres: [],
      topArtists: [],
      repeatedTracks: [],
      sampleTracks: [],
      topTracks: [],
      listenTimeline: [],
    };
  } catch {
    return null;
  }
}

function buildCachedPlaylistInsights(
  playlists: SpotifyPlaylist[],
  cachedDetails: CachedPlaylistDetail[],
  recentPlays: StoredRecentPlay[],
  sort: PlaylistSortOption = "last_listened_desc",
) {
  const cachedDetailMap = new Map(cachedDetails.map((detail) => [detail.id, detail]));

  return sortPlaylistInsights(
    uniqueById(
      playlists.map((playlist) => {
        const detail = cachedDetailMap.get(playlist.id);
        return detail && !isPlaylistDetailIncomplete(detail) ? toInsight(detail, recentPlays) : toBasicInsight(playlist, recentPlays);
      }),
    ),
    sort,
  );
}

export async function getPlaylistInsights(accessToken: string, spotifyUserId: string): Promise<PlaylistInsight[]> {
  const inMemoryLastGood = lastGoodPlaylistInsights.get(spotifyUserId) ?? [];
  const [storedLastGood, recentPlays, currentPlaybackSource, storedLibrary, cachedDetails, allTimeTrackAffinity, allTimeArtistGenres] = await Promise.all([
    getStoredPlaylistInsights(spotifyUserId),
    getRecentHistory(accessToken, spotifyUserId),
    getCurrentPlaybackSource(accessToken).catch(() => undefined),
    getStoredPlaylistLibrary(spotifyUserId),
    getCachedPlaylistDetails(spotifyUserId),
    getAllTimeTrackAffinityMap(spotifyUserId),
    getAllTimeArtistGenreMap(spotifyUserId),
  ]);

  const playbackPlaylist = playlistFromPlaybackSource(currentPlaybackSource);
  const mergedStoredLibrary = playbackPlaylist
    ? uniqueById([playbackPlaylist, ...storedLibrary])
    : storedLibrary;

  if (playbackPlaylist) {
    await upsertStoredPlaylist(spotifyUserId, playbackPlaylist);
  }

  const cachedLibraryInsights = buildCachedPlaylistInsights(mergedStoredLibrary, cachedDetails, recentPlays).slice(0, DASHBOARD_PLAYLIST_COUNT);
  const lastGood = inMemoryLastGood.length > 0
    ? inMemoryLastGood
    : storedLastGood.length > 0
      ? storedLastGood
      : cachedLibraryInsights;

  const currentPlaylistId = currentPlaybackSource?.type === "playlist" ? currentPlaybackSource.playlistId : undefined;
  const candidateIds = getRecentPlaylistCandidates(
    recentPlays,
    currentPlaylistId,
    [
      ...lastGood.map((playlist) => playlist.id).filter((id): id is string => Boolean(id)),
      ...cachedLibraryInsights.map((playlist) => playlist.id).filter((id): id is string => Boolean(id)),
    ],
  );

  if (candidateIds.length === 0) {
    return cachedLibraryInsights.length > 0 ? cachedLibraryInsights : lastGood;
  }

  const storedById = new Map(mergedStoredLibrary.map((playlist) => [playlist.id, playlist]));

  const playlists = await Promise.all(
    candidateIds.map(async (playlistId) => {
      try {
        const playlist = await fetchPlaylistById(accessToken, playlistId);
        await upsertStoredPlaylist(spotifyUserId, playlist);
        return playlist;
      } catch {
        return storedById.get(playlistId) ?? null;
      }
    }),
  );

  const details = await analyzeManyPlaylists(
    accessToken,
    playlists.filter((playlist): playlist is SpotifyPlaylist => Boolean(playlist)),
    recentPlays,
    allTimeTrackAffinity,
    allTimeArtistGenres,
  );

  if (details.length > 0) {
    await writeCachedPlaylistDetails(spotifyUserId, details);
  }

  const currentPlaybackTimestamp = currentPlaylistId ? new Date().toISOString() : undefined;
  const detailInsights = uniqueById(details)
    .map((detail) => {
      const insight = toInsight(detail, recentPlays);

      if (currentPlaylistId && detail.id === currentPlaylistId) {
        return {
          ...insight,
          name: currentPlaybackSource?.label ?? insight.name,
          imageUrl: currentPlaybackSource?.imageUrl ?? insight.imageUrl,
          lastListenedAt: currentPlaybackTimestamp,
        };
      }

      return insight;
    })
    .filter((playlist) => Boolean(playlist.lastListenedAt));

  const nextInsights = sortPlaylistInsights(
    uniqueById([...detailInsights, ...cachedLibraryInsights, ...lastGood]),
    "last_listened_desc",
  ).slice(0, DASHBOARD_PLAYLIST_COUNT);

  if (nextInsights.length > 0) {
    lastGoodPlaylistInsights.set(spotifyUserId, nextInsights);
    await writeStoredPlaylistInsights(spotifyUserId, nextInsights);
    return nextInsights;
  }

  return cachedLibraryInsights.length > 0 ? cachedLibraryInsights : lastGood;
}

export async function syncPlaylistLibrary(accessToken: string, spotifyUserId: string) {
  const [playlists, currentPlaybackSource, storedPlaylists] = await Promise.all([
    getPlaylistLibrary(accessToken, spotifyUserId, { allowStoredFallback: false }),
    getCurrentPlaybackSource(accessToken).catch(() => undefined),
    getStoredPlaylistLibrary(spotifyUserId),
  ]);

  const playbackPlaylist = playlistFromPlaybackSource(currentPlaybackSource);
  const mergedPlaylists = uniqueById([
    ...(playbackPlaylist ? [playbackPlaylist] : []),
    ...playlists,
    ...storedPlaylists,
  ]);

  if (playbackPlaylist) {
    await upsertStoredPlaylist(spotifyUserId, playbackPlaylist);
  }

  if (mergedPlaylists.length === 0) {
    return await getStoredPlaylistInsights(spotifyUserId);
  }

  const recentPlays = await getRecentHistory(accessToken, spotifyUserId);
  const cachedDetails = await getCachedPlaylistDetails(spotifyUserId, mergedPlaylists.map((playlist) => playlist.id));
  const insights = buildCachedPlaylistInsights(mergedPlaylists, cachedDetails, recentPlays);

  if (insights.length > 0) {
    await writeStoredPlaylistInsights(spotifyUserId, insights.slice(0, DASHBOARD_PLAYLIST_COUNT));
  }

  return insights;
}

export async function getAllPlaylistInsights(
  accessToken: string,
  spotifyUserId: string,
  sort: PlaylistSortOption = "created_desc",
): Promise<PlaylistInsight[]> {
  try {
    const [playlists, recentPlays, storedLastGood, currentPlaybackSource, storedPlaylists, allTimeTrackAffinity, allTimeArtistGenres] = await Promise.all([
      getPlaylistLibrary(accessToken, spotifyUserId),
      getRecentHistory(accessToken, spotifyUserId),
      getStoredPlaylistInsights(spotifyUserId),
      getCurrentPlaybackSource(accessToken).catch(() => undefined),
      getStoredPlaylistLibrary(spotifyUserId),
      getAllTimeTrackAffinityMap(spotifyUserId),
      getAllTimeArtistGenreMap(spotifyUserId),
    ]);

    const playbackPlaylist = playlistFromPlaybackSource(currentPlaybackSource);
    const mergedPlaylists = uniqueById([
      ...(playbackPlaylist ? [playbackPlaylist] : []),
      ...playlists,
      ...storedPlaylists,
    ]);

    if (playbackPlaylist) {
      await upsertStoredPlaylist(spotifyUserId, playbackPlaylist);
    }

    if (mergedPlaylists.length === 0) {
      return storedLastGood;
    }

    const cachedDetails = await getCachedPlaylistDetails(spotifyUserId, mergedPlaylists.map((playlist) => playlist.id));
    const cachedDetailMap = new Map(cachedDetails.map((detail) => [detail.id, detail]));
    const missingPlaylists = mergedPlaylists.filter((playlist) => {
      const cached = cachedDetailMap.get(playlist.id);
      return !cached || isPlaylistDetailIncomplete(cached);
    }).slice(0, PLAYLIST_DETAIL_REFRESH_LIMIT);

    const freshDetails = missingPlaylists.length > 0
      ? await analyzeManyPlaylists(accessToken, missingPlaylists, recentPlays, allTimeTrackAffinity, allTimeArtistGenres)
      : [];

    if (freshDetails.length > 0) {
      await writeCachedPlaylistDetails(spotifyUserId, freshDetails);
      freshDetails.forEach((detail) => {
        cachedDetailMap.set(detail.id, { ...detail, spotifyUserId, updatedAt: new Date().toISOString() });
      });
    }

    const insights = mergedPlaylists.map((playlist) => {
      const detail = cachedDetailMap.get(playlist.id);
      return detail ? toInsight(detail, recentPlays) : toBasicInsight(playlist, recentPlays);
    });

    return sortPlaylistInsights(uniqueById(insights), sort);
  } catch (error) {
    const storedLastGood = await getStoredPlaylistInsights(spotifyUserId).catch(() => [] as PlaylistInsight[]);

    if (storedLastGood.length > 0) {
      return sortPlaylistInsights(uniqueById(storedLastGood), sort);
    }

    throw error;
  }
}

export async function getAllPlaylistInsightsFromHistory(
  spotifyUserId: string,
  sort: PlaylistSortOption = "created_desc",
): Promise<PlaylistInsight[]> {
  const [storedInsights, storedPlaylists, cachedDetails, recentPlays] = await Promise.all([
    getStoredPlaylistInsights(spotifyUserId).catch(() => [] as PlaylistInsight[]),
    getStoredPlaylistLibrary(spotifyUserId).catch(() => [] as SpotifyPlaylist[]),
    getCachedPlaylistDetails(spotifyUserId).catch(() => [] as CachedPlaylistDetail[]),
    getStoredRecentPlays(spotifyUserId).catch(() => [] as StoredRecentPlay[]),
  ]);

  if (storedPlaylists.length > 0) {
    const cachedInsights = buildCachedPlaylistInsights(storedPlaylists, cachedDetails, recentPlays, sort);
    const mergedInsights = uniqueById([...cachedInsights, ...storedInsights]);
    return sortPlaylistInsights(mergedInsights, sort);
  }

  return sortPlaylistInsights(uniqueById(storedInsights), sort);
}

export async function getPlaylistPageDataFromHistory(
  spotifyUserId: string,
  sort: PlaylistSortOption = "created_desc",
): Promise<PlaylistPageData> {
  const [storedInsights, storedPlaylistRecords, cachedDetails, recentPlays] = await Promise.all([
    getStoredPlaylistInsights(spotifyUserId).catch(() => [] as PlaylistInsight[]),
    getStoredPlaylistLibraryRecords(spotifyUserId).catch(() => [] as StoredPlaylistLibraryItem[]),
    getCachedPlaylistDetails(spotifyUserId).catch(() => [] as CachedPlaylistDetail[]),
    getStoredRecentPlays(spotifyUserId).catch(() => [] as StoredRecentPlay[]),
  ]);
  const storedPlaylists = storedPlaylistRecords
    .map((playlist) => normalizePlaylist(playlist))
    .filter((playlist): playlist is SpotifyPlaylist => Boolean(playlist));

  const playlists = storedPlaylists.length > 0
    ? sortPlaylistInsights(
      uniqueById([
        ...buildCachedPlaylistInsights(storedPlaylists, cachedDetails, recentPlays, sort),
        ...storedInsights,
      ]),
      sort,
    )
    : sortPlaylistInsights(uniqueById(storedInsights), sort);

  return {
    playlists,
    playlistCount: storedPlaylists.length,
    lastSyncedAt: storedPlaylistRecords[0]?.updatedAt,
  };
}

export async function getPlaylistDetailFromHistory(spotifyUserId: string, playlistId: string): Promise<PlaylistDetail | null> {
  const startedAt = Date.now();
  const [storedLibrary, cachedDetails, recentPlays, storedTrackItems, allTimeTrackAffinity, allTimeArtistGenres] = await Promise.all([
    getStoredPlaylistLibrary(spotifyUserId).catch(() => [] as SpotifyPlaylist[]),
    getCachedPlaylistDetails(spotifyUserId, [playlistId]).catch(() => [] as CachedPlaylistDetail[]),
    getStoredRecentPlays(spotifyUserId).catch(() => [] as StoredRecentPlay[]),
    getStoredPlaylistTrackItems(spotifyUserId, playlistId).catch(() => [] as PlaylistTrackWithMeta[]),
    getAllTimeTrackAffinityMap(spotifyUserId),
    getAllTimeArtistGenreMap(spotifyUserId),
  ]);

  const cached = cachedDetails[0];
  if (cached && !isPlaylistDetailIncomplete(cached)) {
    logPlaylistTiming(spotifyUserId, playlistId, "history-complete-cached-detail", startedAt, `tracks=${cached.trackCount}`);
    return cached;
  }

  const storedPlaylist = storedLibrary.find((playlist) => playlist.id === playlistId);
  if (storedPlaylist) {
    if (storedTrackItems.length > 0) {
      const recoveredDetail = await analyzePlaylistFromTrackItems(
        storedPlaylist,
        storedTrackItems,
        recentPlays,
        allTimeTrackAffinity,
        allTimeArtistGenres,
      );

      if (recoveredDetail) {
        await writeCachedPlaylistDetails(spotifyUserId, [recoveredDetail]);
        logPlaylistTiming(
          spotifyUserId,
          playlistId,
          "history-recovered-from-stored-tracks",
          startedAt,
          `storedTracks=${storedTrackItems.length} uniqueArtists=${recoveredDetail.uniqueArtistCount}`,
        );
        return recoveredDetail;
      }
    }

    logPlaylistTiming(
      spotifyUserId,
      playlistId,
      "history-thin-stored-playlist-fallback",
      startedAt,
      `storedTracks=${storedTrackItems.length} libraryTracks=${storedPlaylist.tracks?.total ?? 0}`,
    );
    return {
      ...toBasicInsight(storedPlaylist, recentPlays),
      id: storedPlaylist.id,
      trackCount: storedPlaylist.tracks?.total ?? 0,
      ownerName: storedPlaylist.owner?.display_name,
      uniqueArtistCount: 0,
      uniqueAlbumCount: 0,
      listeningCadence: getPlaylistListeningCadence(storedPlaylist.id, recentPlays),
      topGenres: [],
      topArtists: [],
      repeatedTracks: [],
      sampleTracks: [],
      topTracks: [],
      listenTimeline: buildListenTimeline(storedPlaylist.id, recentPlays),
    };
  }

  if (cached) {
    logPlaylistTiming(spotifyUserId, playlistId, "history-incomplete-cached-detail-fallback", startedAt, `tracks=${cached.trackCount}`);
    return cached;
  }

  logPlaylistTiming(spotifyUserId, playlistId, "history-miss", startedAt);
  return null;
}

export async function getPlaylistDetail(accessToken: string, spotifyUserId: string, playlistId: string): Promise<PlaylistDetail | null> {
  const [storedLibrary, cachedDetails, recentPlays, storedInsights, allTimeTrackAffinity, allTimeArtistGenres] = await Promise.all([
    getStoredPlaylistLibrary(spotifyUserId),
    getCachedPlaylistDetails(spotifyUserId, [playlistId]),
    getRecentHistory(accessToken, spotifyUserId),
    getStoredPlaylistInsights(spotifyUserId).catch(() => [] as PlaylistInsight[]),
    getAllTimeTrackAffinityMap(spotifyUserId),
    getAllTimeArtistGenreMap(spotifyUserId),
  ]);

  try {
    const playlist = await fetchPlaylistById(accessToken, playlistId);
    await upsertStoredPlaylist(spotifyUserId, playlist);
    const isLargePlaylist = (playlist.tracks?.total ?? 0) >= PLAYLIST_LARGE_SYNC_THRESHOLD;
    const detail = isLargePlaylist
      ? await (async () => {
        await syncPlaylistTrackCache(accessToken, spotifyUserId, playlist, { maxPages: PLAYLIST_LARGE_SYNC_PAGES_PER_REQUEST });
        const storedTrackItems = await getStoredPlaylistTrackItems(spotifyUserId, playlist.id);
        if (storedTrackItems.length === 0) {
          return null;
        }

        return analyzePlaylistFromTrackItems(
          playlist,
          storedTrackItems,
          recentPlays,
          allTimeTrackAffinity,
          allTimeArtistGenres,
        );
      })()
      : await (async () => {
        const snapshot = await fetchPlaylistTrackSnapshot(accessToken, playlist.id);
        if (snapshot.cacheRecords.length > 0) {
          await writeStoredPlaylistTrackSnapshotRecords(
            spotifyUserId,
            playlist.id,
            snapshot.cacheRecords,
            playlist.tracks?.total ?? snapshot.fetchedItems,
          );
        }

        return analyzePlaylistFromTrackItems(
          playlist,
          snapshot.trackItems,
          recentPlays,
          allTimeTrackAffinity,
          allTimeArtistGenres,
          accessToken,
        );
      })();

    if (detail) {
      await writeCachedPlaylistDetails(spotifyUserId, [detail]);
      const nextInsights = uniqueById([
        {
          ...toInsight(detail, recentPlays),
          lastListenedAt: storedInsights.find((entry) => entry.id === detail.id)?.lastListenedAt ?? detail.lastListenedAt,
        },
        ...storedInsights,
      ]);
      if (nextInsights.length > 0) {
        await writeStoredPlaylistInsights(spotifyUserId, nextInsights);
      }
      return detail;
    }
  } catch {
    // Fall through to cached and stored fallbacks below.
  }

  const cached = cachedDetails[0];
  if (cached) {
    return cached;
  }

  const storedPlaylist = storedLibrary.find((playlist) => playlist.id === playlistId);
  if (storedPlaylist) {
    return {
      ...toBasicInsight(storedPlaylist, recentPlays),
      id: storedPlaylist.id,
      trackCount: storedPlaylist.tracks?.total ?? 0,
      ownerName: storedPlaylist.owner?.display_name,
      uniqueArtistCount: 0,
      uniqueAlbumCount: 0,
      listeningCadence: getPlaylistListeningCadence(storedPlaylist.id, recentPlays),
      topGenres: [],
      topArtists: [],
      repeatedTracks: [],
      sampleTracks: [],
      topTracks: [],
      listenTimeline: buildListenTimeline(storedPlaylist.id, recentPlays),
    };
  }

  return null;
}

export async function syncPlaylistDetail(accessToken: string, spotifyUserId: string, playlistId: string) {
  const startedAt = Date.now();
  const [recentPlays, storedInsights, allTimeTrackAffinity, allTimeArtistGenres] = await Promise.all([
    getRecentHistory(accessToken, spotifyUserId),
    getStoredPlaylistInsights(spotifyUserId).catch(() => [] as PlaylistInsight[]),
    getAllTimeTrackAffinityMap(spotifyUserId),
    getAllTimeArtistGenreMap(spotifyUserId),
  ]);
  logPlaylistTiming(spotifyUserId, playlistId, "detail-sync-recent-history", startedAt, `recentPlays=${recentPlays.length}`);

  const playlist = await fetchPlaylistById(accessToken, playlistId);
  await upsertStoredPlaylist(spotifyUserId, playlist);
  logPlaylistTiming(spotifyUserId, playlistId, "detail-sync-fetched-playlist", startedAt, `playlistTracks=${playlist.tracks?.total ?? 0}`);

  const isLargePlaylist = (playlist.tracks?.total ?? 0) >= PLAYLIST_LARGE_SYNC_THRESHOLD;
  const syncState = isLargePlaylist
    ? await syncPlaylistTrackCache(accessToken, spotifyUserId, playlist, { maxPages: PLAYLIST_LARGE_SYNC_PAGES_PER_REQUEST })
    : { completed: true, fetchedCount: playlist.tracks?.total ?? 0, nextOffset: 0, totalTracks: playlist.tracks?.total ?? 0 };
  logPlaylistTiming(
    spotifyUserId,
    playlistId,
    "detail-sync-track-source",
    startedAt,
    `large=${isLargePlaylist} fetchedCount=${syncState.fetchedCount} total=${syncState.totalTracks ?? 0} completed=${syncState.completed}`,
  );

  const playlistSnapshot = isLargePlaylist ? null : await fetchPlaylistTrackSnapshot(accessToken, playlist.id);
  const trackItems = isLargePlaylist
    ? await getStoredPlaylistTrackItems(spotifyUserId, playlist.id)
    : playlistSnapshot?.trackItems ?? [];
  logPlaylistTiming(spotifyUserId, playlistId, "detail-sync-track-items", startedAt, `count=${trackItems.length}`);

  if (!isLargePlaylist && playlistSnapshot) {
    if (playlistSnapshot.cacheRecords.length > 0) {
      await writeStoredPlaylistTrackSnapshotRecords(
        spotifyUserId,
        playlist.id,
        playlistSnapshot.cacheRecords,
        playlist.tracks?.total ?? playlistSnapshot.fetchedItems,
      );
      logPlaylistTiming(spotifyUserId, playlistId, "detail-sync-wrote-track-snapshot", startedAt, `count=${playlistSnapshot.trackItems.length}`);
    }
  }

  const detail = await analyzePlaylistFromTrackItems(
    playlist,
    trackItems,
    recentPlays,
    allTimeTrackAffinity,
    allTimeArtistGenres,
    accessToken,
  );
  logPlaylistTiming(
    spotifyUserId,
    playlistId,
    "detail-sync-analyzed",
    startedAt,
    detail ? `updated=true uniqueArtists=${detail.uniqueArtistCount} uniqueAlbums=${detail.uniqueAlbumCount}` : "updated=false",
  );

  if (detail) {
    await writeCachedPlaylistDetails(spotifyUserId, [detail]);
    const nextInsights = uniqueById([
      {
        ...toInsight(detail, recentPlays),
        lastListenedAt: storedInsights.find((entry) => entry.id === detail.id)?.lastListenedAt ?? detail.lastListenedAt,
      },
      ...storedInsights,
    ]);

    if (nextInsights.length > 0) {
      await writeStoredPlaylistInsights(spotifyUserId, nextInsights);
    }
  }

  logPlaylistTiming(
    spotifyUserId,
    playlistId,
    "detail-sync-total",
    startedAt,
    `updated=${Boolean(detail)} completed=${syncState.completed}`,
  );

  return {
    detail,
    completed: syncState.completed,
    fetchedCount: syncState.fetchedCount,
    totalTracks: syncState.totalTracks,
  };
}

export async function primeIgnoredPlaylistTrackCaches(
  accessToken: string,
  spotifyUserId: string,
  playlistIds: string[],
) {
  const uniquePlaylistIds = [...new Set(playlistIds.filter(Boolean))].slice(0, 20);

  for (const playlistId of uniquePlaylistIds) {
    try {
      const playlist = await fetchPlaylistById(accessToken, playlistId);
      await upsertStoredPlaylist(spotifyUserId, playlist);

      if ((playlist.tracks?.total ?? 0) >= PLAYLIST_LARGE_SYNC_THRESHOLD) {
        await syncPlaylistTrackCache(accessToken, spotifyUserId, playlist, { maxPages: PLAYLIST_LARGE_SYNC_PAGES_PER_REQUEST });
        continue;
      }

      const snapshot = await fetchPlaylistTrackSnapshot(accessToken, playlistId);
      if (snapshot.cacheRecords.length > 0) {
        await writeStoredPlaylistTrackSnapshotRecords(
          spotifyUserId,
          playlistId,
          snapshot.cacheRecords,
          playlist.tracks?.total ?? snapshot.fetchedItems,
        );
      }
    } catch {
      continue;
    }
  }
}

function defaultPublicPlaylistDetailStageState(spotifyUserId: string, playlistId: string): PublicPlaylistDetailStageState {
  return {
    spotifyUserId,
    playlistId,
    stage: "idle",
    phase: "Waiting to start",
    trackCount: 0,
    artistsResolved: 0,
    artistsTotal: 0,
  };
}

async function readPublicPlaylistDetailStageState(spotifyUserId: string, playlistId: string) {
  const fallback = defaultPublicPlaylistDetailStageState(spotifyUserId, playlistId);

  if (!hasMongoConfig()) {
    return fallback;
  }

  try {
    const db = await getDatabase();
    if (!db) {
      return fallback;
    }

    const stored = await db
      .collection<StoredPublicPlaylistDetailStageState>(PUBLIC_PLAYLIST_DETAIL_STAGE_COLLECTION)
      .findOne({ id: `${spotifyUserId}:${playlistId}` });

    if (!stored) {
      return fallback;
    }

    return {
      spotifyUserId: stored.spotifyUserId,
      playlistId: stored.playlistId,
      stage: stored.stage,
      phase: stored.phase,
      trackCount: stored.trackCount,
      artistsResolved: stored.artistsResolved,
      artistsTotal: stored.artistsTotal,
      updatedAt: stored.updatedAt,
      error: stored.error,
    } satisfies PublicPlaylistDetailStageState;
  } catch {
    return fallback;
  }
}

async function writePublicPlaylistDetailStageState(
  spotifyUserId: string,
  playlistId: string,
  updates: Partial<PublicPlaylistDetailStageState>,
) {
  if (!hasMongoConfig()) {
    return;
  }

  try {
    const db = await getDatabase();
    if (!db) {
      return;
    }

    const now = new Date().toISOString();

    await db.collection<StoredPublicPlaylistDetailStageState>(PUBLIC_PLAYLIST_DETAIL_STAGE_COLLECTION).updateOne(
      { id: `${spotifyUserId}:${playlistId}` },
      {
        $set: {
          id: `${spotifyUserId}:${playlistId}` ,
          spotifyUserId,
          playlistId,
          updatedAt: now,
          ...updates,
        },
      },
      { upsert: true },
    );
  } catch {
    return;
  }
}

export async function getPublicPlaylistDetailAnalysisState(spotifyUserId: string, playlistId: string) {
  return readPublicPlaylistDetailStageState(spotifyUserId, playlistId);
}

export async function advancePublicPlaylistDetailAnalysis(spotifyUserId: string, playlistId: string) {
  const startedAt = Date.now();
  const [recentPlays, storedInsights, allTimeTrackAffinity, allTimeArtistGenres, cachedDetails, storedTrackItemsExisting] = await Promise.all([
    getStoredRecentPlays(spotifyUserId).catch(() => [] as StoredRecentPlay[]),
    getStoredPlaylistInsights(spotifyUserId).catch(() => [] as PlaylistInsight[]),
    getAllTimeTrackAffinityMap(spotifyUserId),
    getAllTimeArtistGenreMap(spotifyUserId),
    getCachedPlaylistDetails(spotifyUserId, [playlistId]).catch(() => [] as CachedPlaylistDetail[]),
    getStoredPlaylistTrackItems(spotifyUserId, playlistId).catch(() => [] as PlaylistTrackWithMeta[]),
  ]);

  const cached = cachedDetails[0];
  if (cached && !isPlaylistDetailIncomplete(cached)) {
    const done = {
      spotifyUserId,
      playlistId,
      stage: "completed",
      phase: "Playlist analysis ready",
      trackCount: cached.trackCount,
      artistsResolved: cached.uniqueArtistCount,
      artistsTotal: cached.uniqueArtistCount,
      updatedAt: new Date().toISOString(),
      error: undefined,
    } satisfies PublicPlaylistDetailStageState;
    await writePublicPlaylistDetailStageState(spotifyUserId, playlistId, done);
    return done;
  }

  try {
    const accessToken = await getSpotifyClientCredentialsToken();
    const playlist = await fetchPlaylistById(accessToken, playlistId);
    await upsertStoredPlaylist(spotifyUserId, playlist);

    let storedTrackItems = storedTrackItemsExisting;
    const expectedTrackCount = playlist.tracks?.total ?? storedTrackItems.length;

    if (storedTrackItems.length == 0) {
      await writePublicPlaylistDetailStageState(spotifyUserId, playlistId, {
        stage: "tracks",
        phase: "Fetching playlist tracks",
        trackCount: expectedTrackCount,
        artistsResolved: 0,
        artistsTotal: 0,
        error: undefined,
      });

      const snapshot = await fetchPlaylistTrackSnapshot(accessToken, playlistId);
      if (snapshot.trackItems.length === 0) {
        throw new Error("No playlist tracks returned from Spotify.");
      }

      await writeStoredPlaylistTrackSnapshotRecords(
        spotifyUserId,
        playlist.id,
        snapshot.cacheRecords,
        playlist.tracks?.total ?? snapshot.fetchedItems,
      );
      storedTrackItems = snapshot.trackItems;

      const state = {
        spotifyUserId,
        playlistId,
        stage: "tracks",
        phase: `Cached ${snapshot.trackItems.length} playlist tracks`,
        trackCount: playlist.tracks?.total ?? snapshot.fetchedItems,
        artistsResolved: 0,
        artistsTotal: getTopArtistIdsByFrequency(snapshot.trackItems.map((item) => item.track)).length,
        updatedAt: new Date().toISOString(),
        error: undefined,
      } satisfies PublicPlaylistDetailStageState;
      await writePublicPlaylistDetailStageState(spotifyUserId, playlistId, state);
      return state;
    }

    const tracks = storedTrackItems.map((item) => item.track);
    const topArtistIds = getTopArtistIdsByFrequency(tracks);
    const missingArtistIds = await getMissingStoredArtistMetadataIdsForPlaylistAnalysis(topArtistIds);

    if (missingArtistIds.length > 0) {
      const batch = missingArtistIds.slice(0, 50);
      await writePublicPlaylistDetailStageState(spotifyUserId, playlistId, {
        stage: "artists",
        phase: `Caching artist metadata (${topArtistIds.length - missingArtistIds.length}/${topArtistIds.length})`,
        trackCount: expectedTrackCount,
        artistsResolved: topArtistIds.length - missingArtistIds.length,
        artistsTotal: topArtistIds.length,
        error: undefined,
      });

      const artists = await fetchArtists(accessToken, batch);
      await writeStoredArtistMetadataForPlaylistAnalysis(artists);

      const remainingAfterBatch = await getMissingStoredArtistMetadataIdsForPlaylistAnalysis(topArtistIds);
      const state = {
        spotifyUserId,
        playlistId,
        stage: remainingAfterBatch.length > 0 ? "artists" : "finalizing",
        phase: remainingAfterBatch.length > 0
          ? `Cached artist metadata (${topArtistIds.length - remainingAfterBatch.length}/${topArtistIds.length})`
          : "Artist metadata ready",
        trackCount: expectedTrackCount,
        artistsResolved: topArtistIds.length - remainingAfterBatch.length,
        artistsTotal: topArtistIds.length,
        updatedAt: new Date().toISOString(),
        error: undefined,
      } satisfies PublicPlaylistDetailStageState;
      await writePublicPlaylistDetailStageState(spotifyUserId, playlistId, state);
      return state;
    }

    await writePublicPlaylistDetailStageState(spotifyUserId, playlistId, {
      stage: "finalizing",
      phase: "Building cached playlist insight",
      trackCount: expectedTrackCount,
      artistsResolved: topArtistIds.length,
      artistsTotal: topArtistIds.length,
      error: undefined,
    });

    const detail = await analyzePlaylistFromTrackItems(
      playlist,
      storedTrackItems,
      recentPlays,
      allTimeTrackAffinity,
      allTimeArtistGenres,
      undefined,
    );

    if (!detail) {
      throw new Error("Playlist analysis could not be computed from stored data.");
    }

    await writeCachedPlaylistDetails(spotifyUserId, [detail]);
    const nextInsights = uniqueById([
      {
        ...toInsight(detail, recentPlays),
        lastListenedAt: storedInsights.find((entry) => entry.id === detail.id)?.lastListenedAt ?? detail.lastListenedAt,
      },
      ...storedInsights,
    ]);

    if (nextInsights.length > 0) {
      await writeStoredPlaylistInsights(spotifyUserId, nextInsights);
    }

    const state = {
      spotifyUserId,
      playlistId,
      stage: "completed",
      phase: `Playlist analysis ready in ${Date.now() - startedAt}ms`,
      trackCount: detail.trackCount,
      artistsResolved: detail.uniqueArtistCount,
      artistsTotal: detail.uniqueArtistCount,
      updatedAt: new Date().toISOString(),
      error: undefined,
    } satisfies PublicPlaylistDetailStageState;
    await writePublicPlaylistDetailStageState(spotifyUserId, playlistId, state);
    return state;
  } catch (error) {
    const state = {
      spotifyUserId,
      playlistId,
      stage: "failed",
      phase: "Playlist analysis failed",
      trackCount: storedTrackItemsExisting.length,
      artistsResolved: 0,
      artistsTotal: 0,
      updatedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    } satisfies PublicPlaylistDetailStageState;
    await writePublicPlaylistDetailStageState(spotifyUserId, playlistId, state);
    return state;
  }
}

export function invalidatePlaylistInsightsCache(spotifyUserId: string) {
  invalidateCachedValue(`playlist-insights:${spotifyUserId}`);
  invalidateCachedValue(`playlist-recent-sync:${spotifyUserId}`);
}

export async function getCachedPlaylistInsights(accessToken: string, spotifyUserId: string): Promise<PlaylistInsight[]> {
  return getCachedValue(`playlist-insights:${spotifyUserId}`, PLAYLIST_INSIGHTS_TTL_MS, () =>
    getPlaylistInsights(accessToken, spotifyUserId),
  );
}
