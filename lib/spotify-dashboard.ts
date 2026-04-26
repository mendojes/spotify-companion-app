import {
  DashboardInsights,
  DashboardRange,
  FavoriteTrack,
  GenrePulse,
  MoodHeatmapCell,
  MoodPoint,
  PlaylistInsight,
  SpotifyArtist,
  SpotifyAudioFeature,
  SpotifyAudioFeaturesResponse,
  SpotifyDashboardSnapshot,
  SpotifyRecentlyPlayedItem,
  SpotifyRecentlyPlayedResponse,
  SpotifySavedTrackItem,
  StoredRecentPlay,
  SpotifySavedTracksResponse,
  SpotifyTopArtistsResponse,
  SpotifyTopTracksResponse,
  StatCard,
  TrendPoint,
  DashboardAnalysisDetail,
  DashboardAnalysisEntry,
  DashboardAnalysisHighlight,
} from "@/lib/types";
import { spotifyFetch, spotifyFetchOptional } from "@/lib/spotify";
import { getIgnoredPlaylistIds } from "@/lib/connected-users";

import { getAllPlaylistInsights } from "@/lib/spotify-playlists";
import { getPlaylistIdFromContext, getStoredRecentPlaysForRange, syncRecentPlays } from "@/lib/spotify-activity";
import { getDatabase, hasMongoConfig } from "@/lib/mongodb";
import { getCachedValue, invalidateCachedValue } from "@/lib/runtime-cache";
import { buildCachedTopListsForSnapshot, SNAPSHOT_TOP_LISTS_SCHEMA_VERSION } from "@/lib/spotify-toplists";
import { PST_TIME_ZONE } from "@/lib/time";
import { moodOrder } from "@/lib/moods";

const genreColors = ["#31E7FF", "#53F8B7", "#FFD166", "#FF6B6B", "#2B59FF"];
const heatmapPeriods = ["Morning", "Afternoon", "Evening", "Late Night"] as const;
const SNAPSHOT_REFRESH_TTL_MS = 1000 * 60 * 15;
const AUTO_REFRESH_DASHBOARD_SNAPSHOTS = true;
const SNAPSHOT_HISTORY_COLLECTION = "spotify_snapshots_history";
const ARTIST_METADATA_COLLECTION = "spotify_artist_metadata";
const AUDIO_FEATURE_CACHE_COLLECTION = "spotify_audio_feature_cache";
const SNAPSHOT_SIGNIFICANT_PLAY_GAP_MS = 1000 * 60 * 60 * 6;
const PACIFIC_TIME_ZONE = PST_TIME_ZONE;
const MUSICBRAINZ_USER_AGENT = "SoundScope/0.1 ( genre pulse fallback )";
const PUBLIC_TAG_FETCH_LIMIT = 12;
const ANALYSIS_DETAIL_TTL_MS = 1000 * 60 * 5;
const DASHBOARD_SNAPSHOT_CACHE_TTL_MS = 1000 * 30;
const DASHBOARD_INSIGHTS_CACHE_TTL_MS = 1000 * 30;
const DASHBOARD_RANGE_VALUES: DashboardRange[] = ["week", "month", "all"];

type MoodAnalyticsResult = {
  moodData: MoodPoint[];
  moodSource: string;
  moodHeatmap: MoodHeatmapCell[];
};

type DashboardInsightOptions = {
  includeLivePlaylistInsights?: boolean;
  includePublicTagFallback?: boolean;
};

type StoredArtistMetadata = {
  artistId: string;
  name: string;
  genres: string[];
  imageUrl?: string;
  popularity: number;
  updatedAt: string;
};

type StoredAudioFeature = SpotifyAudioFeature & {
  updatedAt: string;
};

type RecentTrackMoodMeta = {
  item: SpotifyRecentlyPlayedItem;
  mood?: (typeof moodOrder)[number];
  period: (typeof heatmapPeriods)[number];
};

function getArtistGenres(artist: Pick<SpotifyArtist, "genres">) {
  return Array.isArray(artist.genres) ? artist.genres : [];
}

function formatDuration(hours: number) {
  return `${hours.toFixed(1)}h`;
}

function hoursFromMs(durationMs: number) {
  return durationMs / 1000 / 60 / 60;
}

function minutesFromMs(durationMs: number) {
  return durationMs / 1000 / 60;
}

function daysSince(isoDate: string) {
  const diff = Date.now() - new Date(isoDate).getTime();
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
}

function titleKey(title: string, artist: string) {
  return `${title}::${artist}`.toLowerCase();
}

function isFresh(isoDate?: string, ttlMs = SNAPSHOT_REFRESH_TTL_MS) {
  if (!isoDate) {
    return false;
  }

  return Date.now() - new Date(isoDate).getTime() < ttlMs;
}

function getRangeWindow(range: DashboardRange) {
  const now = Date.now();

  if (range === "week") {
    return new Date(now - 1000 * 60 * 60 * 24 * 7);
  }

  if (range === "month") {
    return new Date(now - 1000 * 60 * 60 * 24 * 30);
  }

  return null;
}

function getPacificDateParts(value: string | Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: PACIFIC_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(new Date(value));

  const lookup = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return {
    year: Number(lookup.year),
    month: Number(lookup.month),
    day: Number(lookup.day),
    hour: lookup.hour,
  };
}

function toPacificDateKey(value: string | Date) {
  const { year, month, day } = getPacificDateParts(value);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function normalizeDateInput(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return undefined;
  }

  return value;
}

function getPacificDaySerial(value: string | Date) {
  const { year, month, day } = getPacificDateParts(value);
  return Math.floor(Date.UTC(year, month - 1, day) / (1000 * 60 * 60 * 24));
}

function getPacificMonthSerial(value: string | Date) {
  const { year, month } = getPacificDateParts(value);
  return year * 12 + (month - 1);
}

function pacificSerialToDate(daySerial: number) {
  return new Date(daySerial * 1000 * 60 * 60 * 24 + 1000 * 60 * 60 * 12);
}

function pacificMonthSerialToDate(monthSerial: number) {
  const year = Math.floor(monthSerial / 12);
  const month = monthSerial % 12;
  return new Date(Date.UTC(year, month, 1, 12));
}

function filterSnapshotsForDashboardRange(snapshots: SpotifyDashboardSnapshot[], range: DashboardRange) {
  const windowStart = getRangeWindow(range);

  if (!windowStart) {
    return snapshots;
  }

  return snapshots.filter((snapshot) => new Date(snapshot.fetchedAt).getTime() >= windowStart.getTime());
}

function getDashboardSnapshotBucketKey(snapshot: SpotifyDashboardSnapshot, range: DashboardRange) {
  const { year, month, day, hour } = getPacificDateParts(snapshot.fetchedAt);

  if (range === "all") {
    return `${year}-${month}-${day}`;
  }

  return `${year}-${month}-${day}-${hour}`;
}

function downsampleSnapshotsForDashboardRange(snapshots: SpotifyDashboardSnapshot[], range: DashboardRange) {
  const buckets = new Map<string, SpotifyDashboardSnapshot>();

  snapshots.forEach((snapshot) => {
    const bucketKey = getDashboardSnapshotBucketKey(snapshot, range);
    const existing = buckets.get(bucketKey);

    if (!existing || new Date(snapshot.fetchedAt).getTime() > new Date(existing.fetchedAt).getTime()) {
      buckets.set(bucketKey, snapshot);
    }
  });

  return [...buckets.values()].sort((a, b) => new Date(b.fetchedAt).getTime() - new Date(a.fetchedAt).getTime());
}

function dashboardCacheError(step: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`[${step}] ${message}`);
}

function toRecentPlayedItemsFromStoredPlays(recentPlays: Array<{
  trackId: string;
  playedAt: string;
  trackName: string;
  artistName: string;
  albumName: string;
  durationMs?: number;
  imageUrl?: string;
}>): SpotifyRecentlyPlayedItem[] {
  return recentPlays.map((play) => ({
    played_at: play.playedAt,
    track: {
      id: play.trackId,
      name: play.trackName,
      popularity: 0,
      duration_ms: play.durationMs ?? 0,
      album: {
        name: play.albumName,
        images: play.imageUrl ? [{ url: play.imageUrl }] : undefined,
      },
      artists: play.artistName.split(/,\s*/).filter(Boolean).map((name) => ({ name })),
    },
  }));
}

function mergeRecentSources(primary: SpotifyRecentlyPlayedItem[], fallback: SpotifyRecentlyPlayedItem[]) {
  return dedupeRecent([...fallback, ...primary]);
}

function dedupeRecent(items: SpotifyRecentlyPlayedItem[]) {
  const seen = new Set<string>();
  const result: SpotifyRecentlyPlayedItem[] = [];

  for (const item of items) {
    const key = `${item.track.id}:${item.played_at}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }

  return result.sort((a, b) => new Date(b.played_at).getTime() - new Date(a.played_at).getTime());
}

function filterRecentItemsByIgnoredPlaylistIds(recent: SpotifyRecentlyPlayedItem[], ignoredPlaylistIds: string[]) {
  if (ignoredPlaylistIds.length === 0) {
    return recent;
  }

  return recent.filter((item) => {
    const playlistId = getPlaylistIdFromContext(item.context);
    return !playlistId || !ignoredPlaylistIds.includes(playlistId);
  });
}

function filterSnapshotRecentHistory(
  snapshots: SpotifyDashboardSnapshot[],
  ignoredPlaylistIds: string[],
) {
  if (ignoredPlaylistIds.length === 0) {
    return snapshots;
  }

  return snapshots.map((snapshot) => ({
    ...snapshot,
    recent: filterRecentItemsByIgnoredPlaylistIds(snapshot.recent, ignoredPlaylistIds),
  }));
}

function pushArtistsWithWeight(map: Map<string, SpotifyArtist & { score: number }>, artists: SpotifyArtist[] | undefined, weight: number) {
  (artists ?? []).forEach((artist, index) => {
    const existing = map.get(artist.id) ?? { ...artist, genres: getArtistGenres(artist), score: 0 };
    existing.score += Math.max(1, 18 - index) * weight;
    existing.genres = [...new Set([...(existing.genres ?? []), ...getArtistGenres(artist)])];
    existing.popularity = Math.max(existing.popularity, artist.popularity);
    if (!existing.images?.length && artist.images?.length) {
      existing.images = artist.images;
    }
    map.set(artist.id, existing);
  });
}

function aggregateArtists(snapshots: SpotifyDashboardSnapshot[]) {
  const artistMap = new Map<string, SpotifyArtist & { score: number }>();

  snapshots.forEach((snapshot) => {
    pushArtistsWithWeight(artistMap, snapshot.topArtists, 1.5);
    pushArtistsWithWeight(artistMap, snapshot.mediumTermTopArtists, 1.05);
    pushArtistsWithWeight(artistMap, snapshot.longTermTopArtists, 0.75);
  });

  return [...artistMap.values()].sort((a, b) => b.score - a.score || b.popularity - a.popularity);
}
function mergeArtists(...groups: SpotifyArtist[][]) {
  const artistMap = new Map<string, SpotifyArtist>();

  groups.flat().forEach((artist) => {
    if (!artist?.name) {
      return;
    }

    const key = artist.id ?? artist.name.toLowerCase();
    const existing = artistMap.get(key);

    if (!existing) {
      artistMap.set(key, artist);
      return;
    }

    artistMap.set(key, {
      ...existing,
      ...artist,
      genres: [...new Set([...(existing.genres ?? []), ...(artist.genres ?? [])])],
      images: existing.images?.length ? existing.images : artist.images,
      popularity: Math.max(existing.popularity ?? 0, artist.popularity ?? 0),
    });
  });

  return [...artistMap.values()];
}

function pushTracksWithWeight(
  map: Map<string, { track: SpotifyDashboardSnapshot["topTracks"][number]; score: number }>,
  tracks: SpotifyDashboardSnapshot["topTracks"] | undefined,
  weight: number,
) {
  (tracks ?? []).forEach((track, index) => {
    const existing = map.get(track.id) ?? { track, score: 0 };
    existing.score += Math.max(1, 18 - index) * weight;
    if (track.popularity > existing.track.popularity) {
      existing.track = track;
    }
    map.set(track.id, existing);
  });
}

function aggregateTracks(snapshots: SpotifyDashboardSnapshot[]) {
  const trackMap = new Map<string, { track: SpotifyDashboardSnapshot["topTracks"][number]; score: number }>();

  snapshots.forEach((snapshot) => {
    pushTracksWithWeight(trackMap, snapshot.topTracks, 1.45);
    pushTracksWithWeight(trackMap, snapshot.mediumTermTopTracks, 1.0);
    pushTracksWithWeight(trackMap, snapshot.longTermTopTracks, 0.7);
  });

  return [...trackMap.values()].sort((a, b) => b.score - a.score || b.track.popularity - a.track.popularity).map((entry) => entry.track);
}

function mergeArtistMetadata(baseArtists: SpotifyArtist[], metadataArtists: SpotifyArtist[]) {
  const metadataById = new Map(metadataArtists.filter((artist) => artist?.id).map((artist) => [artist.id, artist]));

  return baseArtists.map((artist) => {
    const metadataArtist = artist.id ? metadataById.get(artist.id) : undefined;

    if (!metadataArtist) {
      return {
        ...artist,
        genres: getArtistGenres(artist),
      };
    }

    return {
      ...artist,
      ...metadataArtist,
      genres: getArtistGenres(metadataArtist).length > 0 ? getArtistGenres(metadataArtist) : getArtistGenres(artist),
      images: metadataArtist.images?.length ? metadataArtist.images : artist.images,
      popularity: Math.max(metadataArtist.popularity ?? 0, artist.popularity ?? 0),
    } satisfies SpotifyArtist;
  });
}

function toStoredArtistMetadata(artist: SpotifyArtist): StoredArtistMetadata | null {
  if (!artist?.id) {
    return null;
  }

  return {
    artistId: artist.id,
    name: artist.name,
    genres: getArtistGenres(artist),
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

async function getStoredArtistMetadataByIds(artistIds: string[]) {
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

async function writeStoredArtistMetadata(artists: SpotifyArtist[]) {
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

async function backfillArtistGenresFromMusicBrainz(artists: SpotifyArtist[]) {
  const artistsMissingGenres = artists.filter((artist) => getArtistGenres(artist).length === 0 && artist.name);

  if (artistsMissingGenres.length === 0) {
    return artists;
  }

  const artistTags = await fetchMusicBrainzArtistTags(artistsMissingGenres.map((artist) => artist.name));

  return artists.map((artist) => {
    if (getArtistGenres(artist).length > 0) {
      return artist;
    }

    const fallbackGenres = artistTags.get(artist.name.toLowerCase()) ?? [];
    if (fallbackGenres.length === 0) {
      return artist;
    }

    return {
      ...artist,
      genres: fallbackGenres,
    };
  });
}

async function getArtistMetadata(accessToken: string | undefined, artistIds: string[]) {
  const uniqueArtistIds = [...new Set(artistIds.filter(Boolean))].slice(0, 200);

  if (uniqueArtistIds.length === 0) {
    return [] as SpotifyArtist[];
  }

  const storedArtists = await getStoredArtistMetadataByIds(uniqueArtistIds);
  const storedArtistIds = new Set(storedArtists.map((artist) => artist.id));
  const missingArtistIds = uniqueArtistIds.filter((artistId) => !storedArtistIds.has(artistId));

  if (!accessToken || missingArtistIds.length === 0) {
    const enrichedStoredArtists = await backfillArtistGenresFromMusicBrainz(storedArtists);
    if (enrichedStoredArtists.some((artist, index) => getArtistGenres(artist).join("|") !== getArtistGenres(storedArtists[index] ?? { genres: [] }).join("|"))) {
      await writeStoredArtistMetadata(enrichedStoredArtists);
    }
    return enrichedStoredArtists;
  }

  const fetchedArtists = await fetchArtistsByIds(accessToken, missingArtistIds);
  const mergedArtists = mergeArtists(storedArtists, fetchedArtists);
  const enrichedArtists = await backfillArtistGenresFromMusicBrainz(mergedArtists);

  if (enrichedArtists.length > 0) {
    await writeStoredArtistMetadata(enrichedArtists);
  }

  return enrichedArtists;
}

async function getStoredAudioFeatures(trackIds: string[]) {
  const uniqueTrackIds = [...new Set(trackIds.filter(Boolean))];

  if (!hasMongoConfig() || uniqueTrackIds.length === 0) {
    return [] as SpotifyAudioFeature[];
  }

  try {
    const db = await getDatabase();
    if (!db) {
      return [] as SpotifyAudioFeature[];
    }

    const records = await db
      .collection<StoredAudioFeature>(AUDIO_FEATURE_CACHE_COLLECTION)
      .find({ id: { $in: uniqueTrackIds } })
      .toArray();

    return records.map(({ updatedAt: _updatedAt, ...feature }) => feature);
  } catch {
    return [] as SpotifyAudioFeature[];
  }
}

async function writeStoredAudioFeatures(features: SpotifyAudioFeature[]) {
  if (!hasMongoConfig() || features.length === 0) {
    return;
  }

  try {
    const db = await getDatabase();
    if (!db) {
      return;
    }

    const updatedAt = new Date().toISOString();

    await db.collection<StoredAudioFeature>(AUDIO_FEATURE_CACHE_COLLECTION).bulkWrite(
      features.map((feature) => ({
        updateOne: {
          filter: { id: feature.id },
          update: {
            $set: {
              ...feature,
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

async function getAudioFeatures(accessToken: string | undefined, trackIds: string[]) {
  const uniqueTrackIds = [...new Set(trackIds.filter(Boolean))].slice(0, 100);

  if (uniqueTrackIds.length === 0) {
    return [] as SpotifyAudioFeature[];
  }

  const storedFeatures = await getStoredAudioFeatures(uniqueTrackIds);
  const storedFeatureIds = new Set(storedFeatures.map((feature) => feature.id));
  const missingTrackIds = uniqueTrackIds.filter((trackId) => !storedFeatureIds.has(trackId));

  if (!accessToken || missingTrackIds.length === 0) {
    return storedFeatures;
  }

  try {
    const response = await spotifyFetchOptional<SpotifyAudioFeaturesResponse>(`/audio-features?ids=${missingTrackIds.join(",")}`, accessToken);
    const fetchedFeatures = response?.audio_features.filter((feature): feature is SpotifyAudioFeature => Boolean(feature)) ?? [];

    if (fetchedFeatures.length > 0) {
      await writeStoredAudioFeatures(fetchedFeatures);
    }

    return [...storedFeatures, ...fetchedFeatures];
  } catch {
    return storedFeatures;
  }
}

async function fetchArtistsByIds(accessToken: string, artistIds: string[]) {
  const uniqueArtistIds = [...new Set(artistIds.filter(Boolean))].slice(0, 200);

  if (uniqueArtistIds.length === 0) {
    return [] as SpotifyArtist[];
  }

  try {
    const chunks = Array.from({ length: Math.ceil(uniqueArtistIds.length / 50) }, (_, index) => uniqueArtistIds.slice(index * 50, index * 50 + 50));
    const responses = await Promise.all(
      chunks.map((chunk) => spotifyFetch<{ artists: SpotifyArtist[] }>(`/artists?ids=${chunk.join(",")}`, accessToken)),
    );

    return responses.flatMap((response) => response.artists ?? []);
  } catch {
    return [] as SpotifyArtist[];
  }
}

function hydrateCachedTopListsArtists(
  cachedTopLists: SpotifyDashboardSnapshot["cachedTopLists"],
  metadataArtists: SpotifyArtist[],
): SpotifyDashboardSnapshot["cachedTopLists"] {
  if (!cachedTopLists) {
    return cachedTopLists;
  }

  const metadataById = new Map(metadataArtists.filter((artist) => artist?.id).map((artist) => [artist.id, artist]));

  return Object.fromEntries(
    Object.entries(cachedTopLists).map(([key, list]) => [
      key,
      {
        ...list,
        artists: list.artists.map((artist) => {
          const metadataArtist = metadataById.get(artist.id);
          if (!metadataArtist) {
            return artist;
          }

          return {
            ...artist,
            genres: getArtistGenres(metadataArtist).length > 0 ? getArtistGenres(metadataArtist) : artist.genres,
            imageUrl: metadataArtist.images?.[0]?.url ?? artist.imageUrl,
          };
        }),
      },
    ]),
  ) as SpotifyDashboardSnapshot["cachedTopLists"];
}

async function enrichSnapshotsWithArtistMetadata(snapshots: SpotifyDashboardSnapshot[], accessToken?: string) {
  const snapshotArtistIds = snapshots.flatMap((snapshot) => [
    ...snapshot.topArtists.map((artist) => artist.id),
    ...(snapshot.mediumTermTopArtists ?? []).map((artist) => artist.id),
    ...(snapshot.longTermTopArtists ?? []).map((artist) => artist.id),
    ...snapshot.recent.flatMap((item) => item.track.artists.map((artist) => artist.id).filter((id): id is string => Boolean(id))),
    ...Object.values(snapshot.cachedTopLists ?? {}).flatMap((cachedList) => cachedList.artists.map((artist) => artist.id)),
  ]);

  const metadataArtists = await getArtistMetadata(accessToken, snapshotArtistIds);
  if (metadataArtists.length === 0) {
    return snapshots;
  }

  return snapshots.map((snapshot) => ({
    ...snapshot,
    topArtists: mergeArtistMetadata(snapshot.topArtists, metadataArtists),
    mediumTermTopArtists: mergeArtistMetadata(snapshot.mediumTermTopArtists ?? [], metadataArtists),
    longTermTopArtists: mergeArtistMetadata(snapshot.longTermTopArtists ?? [], metadataArtists),
    cachedTopLists: hydrateCachedTopListsArtists(snapshot.cachedTopLists, metadataArtists),
  }));
}

function buildArtistMetadataMap(topArtists: SpotifyArtist[], snapshots: SpotifyDashboardSnapshot[]) {
  const metadata = new Map<string, { genres: string[]; imageUrl?: string }>();

  topArtists.forEach((artist) => {
    const keys = [artist.name.toLowerCase(), artist.id].filter(Boolean);
    keys.forEach((key) => {
      const existing = metadata.get(key) ?? { genres: [], imageUrl: undefined };
      existing.genres = [...new Set([...(existing.genres ?? []), ...getArtistGenres(artist)])];
      if (!existing.imageUrl && artist.images?.[0]?.url) {
        existing.imageUrl = artist.images[0].url;
      }
      metadata.set(key, existing);
    });
  });

  snapshots.forEach((snapshot) => {
    Object.values(snapshot.cachedTopLists ?? {}).forEach((cachedList) => {
      cachedList.artists.forEach((artist) => {
        const keys = [artist.name.toLowerCase(), artist.id].filter(Boolean);
        keys.forEach((key) => {
          const existing = metadata.get(key) ?? { genres: [], imageUrl: undefined };
          existing.genres = [...new Set([...(existing.genres ?? []), ...(artist.genres ?? [])])];
          if (!existing.imageUrl && artist.imageUrl) {
            existing.imageUrl = artist.imageUrl;
          }
          metadata.set(key, existing);
        });
      });
    });
  });

  return metadata;
}

function deriveGenrePulseFromStoredRecent(recentPlays: StoredRecentPlay[], artistMetadata: Map<string, { genres: string[]; imageUrl?: string }>) {
  const scores = new Map<string, number>();
  const recentListeningHours = hoursFromMs(recentPlays.reduce((sum, play) => sum + (play.durationMs ?? 0), 0));

  recentPlays.forEach((play, index) => {
    const contribution = Math.max(0.15, hoursFromMs(play.durationMs ?? 0) * 3.2 || 0.15);
    const artistKeys = [
      ...(play.artistIds ?? []),
      ...play.artistName.split(/,\s*/).map((name) => name.toLowerCase()).filter(Boolean),
    ];
    const genres = new Set<string>();

    artistKeys.forEach((key) => {
      (artistMetadata.get(key)?.genres ?? []).forEach((genre) => genres.add(genre));
    });

    genres.forEach((genre) => {
      scores.set(genre, (scores.get(genre) ?? 0) + contribution + Math.max(0, 0.02 * (recentPlays.length - index)));
    });
  });

  const total = [...scores.values()].reduce((sum, value) => sum + value, 0) || 1;
  const scaledHours = Math.max(recentListeningHours, 1);

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([genre, score], index) => ({
      genre,
      hours: Number(((score / total) * scaledHours).toFixed(1)),
      color: genreColors[index % genreColors.length],
    }));
}

function getArtistLookup(topArtists: SpotifyArtist[]) {
  const byId = new Map<string, SpotifyArtist>();
  const byName = new Map<string, SpotifyArtist>();

  topArtists.forEach((artist) => {
    byId.set(artist.id, artist);
    byName.set(artist.name.toLowerCase(), artist);
  });

  return { byId, byName };
}

function deriveGenrePulse(topArtists: SpotifyArtist[], recent: SpotifyRecentlyPlayedItem[]): GenrePulse[] {
  const scores = new Map<string, number>();
  const { byId, byName } = getArtistLookup(topArtists);
  const recentListeningHours = hoursFromMs(recent.reduce((sum, item) => sum + item.track.duration_ms, 0));

  topArtists.forEach((artist, index) => {
    const weight = Math.max(1, 20 - index) * 1.2;
    getArtistGenres(artist).forEach((genre) => {
      scores.set(genre, (scores.get(genre) ?? 0) + weight);
    });
  });

  recent.forEach((item) => {
    const contribution = Math.max(0.15, hoursFromMs(item.track.duration_ms) * 3.2);
    item.track.artists.forEach((artistRef) => {
      const matchedArtist = (artistRef.id ? byId.get(artistRef.id) : undefined) ?? byName.get(artistRef.name.toLowerCase());
      getArtistGenres(matchedArtist ?? { genres: [] }).forEach((genre) => {
        scores.set(genre, (scores.get(genre) ?? 0) + contribution);
      });
    });
  });

  const total = [...scores.values()].reduce((sum, value) => sum + value, 0) || 1;
  const scaledHours = Math.max(recentListeningHours, 6);

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([genre, score], index) => ({
      genre,
      hours: Number(((score / total) * scaledHours).toFixed(1)),
      color: genreColors[index % genreColors.length],
    }));
}
function deriveGenrePulseFromRecentItems(recent: SpotifyRecentlyPlayedItem[], artistMetadata: Map<string, { genres: string[]; imageUrl?: string }>) {
  const scores = new Map<string, number>();
  const recentListeningHours = hoursFromMs(recent.reduce((sum, item) => sum + item.track.duration_ms, 0));

  recent.forEach((item, index) => {
    const contribution = Math.max(0.15, hoursFromMs(item.track.duration_ms) * 3.2 || 0.15);
    const genres = new Set<string>();

    item.track.artists.forEach((artistRef) => {
      const keys = [artistRef.id, artistRef.name.toLowerCase()].filter(Boolean) as string[];
      keys.forEach((key) => {
        (artistMetadata.get(key)?.genres ?? []).forEach((genre) => genres.add(genre));
      });
    });

    genres.forEach((genre) => {
      scores.set(genre, (scores.get(genre) ?? 0) + contribution + Math.max(0, 0.02 * (recent.length - index)));
    });
  });

  const total = [...scores.values()].reduce((sum, value) => sum + value, 0) || 1;
  const scaledHours = Math.max(recentListeningHours, 1);

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([genre, score], index) => ({
      genre,
      hours: Number(((score / total) * scaledHours).toFixed(1)),
      color: genreColors[index % genreColors.length],
    }));
}

function buildGenrePulseFromArtistTags(
  items: Array<{ artistNames: string[]; durationMs?: number }>,
  artistTags: Map<string, string[]>,
) {
  const scores = new Map<string, number>();
  const totalHours = hoursFromMs(items.reduce((sum, item) => sum + (item.durationMs ?? 0), 0));

  items.forEach((item, index) => {
    const contribution = Math.max(0.15, hoursFromMs(item.durationMs ?? 0) * 3.2 || 0.15);
    const genres = new Set<string>();

    item.artistNames.forEach((artistName) => {
      (artistTags.get(artistName.toLowerCase()) ?? []).forEach((genre) => genres.add(genre));
    });

    genres.forEach((genre) => {
      scores.set(genre, (scores.get(genre) ?? 0) + contribution + Math.max(0, 0.02 * (items.length - index)));
    });
  });

  const total = [...scores.values()].reduce((sum, value) => sum + value, 0) || 1;
  const scaledHours = Math.max(totalHours, 1);

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([genre, score], index) => ({
      genre,
      hours: Number(((score / total) * scaledHours).toFixed(1)),
      color: genreColors[index % genreColors.length],
    }));
}

async function fetchMusicBrainzArtistTags(artistNames: string[]) {
  const uniqueNames = [...new Set(artistNames.map((name) => name.trim()).filter(Boolean))].slice(0, PUBLIC_TAG_FETCH_LIMIT);
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

      const payload = await response.json() as { artists?: Array<{ name?: string; score?: number | string; tags?: Array<{ name?: string; count?: number }> }> };
      const match = payload.artists?.[0];
      const score = Number(match?.score ?? 0);
      const tags = (match?.tags ?? [])
        .map((tag) => tag?.name?.trim().toLowerCase() ?? "")
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

function getMoodScores(feature: SpotifyAudioFeature) {
  const tempoNorm = Math.min(1, Math.max(0, (feature.tempo - 70) / 90));
  const lowValence = 1 - feature.valence;
  const lowEnergy = 1 - feature.energy;
  const midEnergy = 1 - Math.min(1, Math.abs(feature.energy - 0.58) / 0.58);
  const highAcoustic = feature.acousticness;
  const highInstrumental = feature.instrumentalness;
  const lowSpeech = 1 - feature.speechiness;
  const nightDriveBalance = 1 - Math.min(1, Math.abs(feature.valence - 0.45) / 0.55);

  return {
    "Adrenaline Rush": feature.energy * 0.4 + feature.danceability * 0.2 + tempoNorm * 0.25 + feature.valence * 0.15,
    "Neon Drift": midEnergy * 0.3 + nightDriveBalance * 0.2 + feature.danceability * 0.2 + lowSpeech * 0.15 + lowValence * 0.15,
    Dreamwash: lowEnergy * 0.28 + highAcoustic * 0.32 + lowSpeech * 0.15 + (1 - tempoNorm) * 0.15 + midEnergy * 0.1,
    "Melancholy Glow": lowValence * 0.45 + highAcoustic * 0.2 + lowEnergy * 0.2 + lowSpeech * 0.15,
    "Bright Pulse": feature.valence * 0.42 + feature.danceability * 0.28 + feature.energy * 0.2 + tempoNorm * 0.1,
    "Flow State": highInstrumental * 0.42 + lowSpeech * 0.28 + (1 - Math.abs(feature.energy - 0.42)) * 0.2 + highAcoustic * 0.1,
    Cathartic: lowValence * 0.28 + feature.energy * 0.28 + feature.danceability * 0.12 + tempoNorm * 0.16 + highAcoustic * 0.16,
    Swagger: feature.danceability * 0.35 + feature.energy * 0.18 + lowSpeech * 0.12 + feature.valence * 0.1 + (1 - highAcoustic) * 0.15 + midEnergy * 0.1,
  } as const;
}

function getDominantMood(feature: SpotifyAudioFeature): (typeof moodOrder)[number] {
  const scores = getMoodScores(feature);
  return moodOrder.reduce((best, mood) => (scores[mood] > scores[best] ? mood : best), moodOrder[0]);
}

function getDayPeriod(value: string | Date) {
  const { hour } = getPacificDateParts(value);
  const normalizedHour = Number(hour);

  if (normalizedHour >= 5 && normalizedHour < 11) {
    return "Morning";
  }

  if (normalizedHour >= 11 && normalizedHour < 17) {
    return "Afternoon";
  }

  if (normalizedHour >= 17 && normalizedHour < 22) {
    return "Evening";
  }

  return "Late Night";
}

function deriveMoodDataFromGenres(topArtists: SpotifyArtist[]) {
  const buckets = [
    { mood: "Adrenaline Rush", energy: 88, matchers: ["dance", "house", "edm", "electro", "hyperpop", "drum and bass", "punk", "hardcore"] },
    { mood: "Neon Drift", energy: 58, matchers: ["synthwave", "night", "alternative r&b", "trip-hop", "downtempo", "neo-soul"] },
    { mood: "Dreamwash", energy: 34, matchers: ["ambient", "chill", "dream", "lo-fi", "shoegaze", "bedroom pop"] },
    { mood: "Melancholy Glow", energy: 42, matchers: ["sad", "emo", "singer-songwriter", "grunge", "melanch", "slowcore"] },
    { mood: "Bright Pulse", energy: 72, matchers: ["pop", "funk", "disco", "soul", "groove", "nu-disco"] },
    { mood: "Flow State", energy: 50, matchers: ["classical", "instrumental", "study", "jazz", "soundtrack", "post-rock"] },
    { mood: "Cathartic", energy: 68, matchers: ["metalcore", "post-hardcore", "alt rock", "indie rock", "arena rock", "gospel"] },
    { mood: "Swagger", energy: 66, matchers: ["hip hop", "rap", "trap", "phonk", "afrobeats", "dancehall"] },
  ] as const;

  const scores = new Map<string, number>(buckets.map((bucket) => [bucket.mood, 1]));

  topArtists.forEach((artist, index) => {
    const weight = Math.max(1, 14 - index);
    const joinedGenres = getArtistGenres(artist).join(" ").toLowerCase();

    let matched = false;
    for (const bucket of buckets) {
      if (bucket.matchers.some((matcher) => joinedGenres.includes(matcher))) {
        scores.set(bucket.mood, (scores.get(bucket.mood) ?? 0) + weight);
        matched = true;
      }
    }

    if (!matched) {
      scores.set("Bright Pulse", (scores.get("Bright Pulse") ?? 0) + 1);
    }
  });

  const total = [...scores.values()].reduce((sum, value) => sum + value, 0) || 1;

  return {
    moodData: buckets.map((bucket) => ({
      mood: bucket.mood,
      share: Math.round(((scores.get(bucket.mood) ?? 0) / total) * 100),
      energy: bucket.energy,
    })),
    moodSource: "Genre-based fallback mood model",
  };
}

function deriveMoodHeatmapFallback(moodData: MoodPoint[]): MoodHeatmapCell[] {
  const emphasis: Record<(typeof heatmapPeriods)[number], Partial<Record<(typeof moodOrder)[number], number>>> = {
    Morning: { "Flow State": 1.22, Dreamwash: 1.05, "Bright Pulse": 0.82, "Adrenaline Rush": 0.58, "Melancholy Glow": 0.34, Cathartic: 0.42, Swagger: 0.52, "Neon Drift": 0.4 },
    Afternoon: { "Adrenaline Rush": 1.12, "Bright Pulse": 1.06, Swagger: 0.94, "Flow State": 0.86, Cathartic: 0.72, Dreamwash: 0.48, "Neon Drift": 0.42, "Melancholy Glow": 0.3 },
    Evening: { "Neon Drift": 1.12, Cathartic: 1.02, Swagger: 0.9, "Bright Pulse": 0.88, "Adrenaline Rush": 0.82, "Melancholy Glow": 0.86, Dreamwash: 0.74, "Flow State": 0.38 },
    "Late Night": { "Neon Drift": 1.24, "Melancholy Glow": 1.08, Dreamwash: 1.02, Swagger: 0.82, Cathartic: 0.72, "Flow State": 0.62, "Bright Pulse": 0.42, "Adrenaline Rush": 0.28 },
  };

  const rawCells = heatmapPeriods.flatMap((period) =>
    moodOrder.map((mood) => {
      const point = moodData.find((entry) => entry.mood === mood);
      const intensity = Math.round((point?.share ?? 10) * (emphasis[period][mood] ?? 0.5));
      const minutes = Math.round(intensity * 0.9);
      return { period, mood, intensity, minutes };
    }),
  );

  const maxIntensity = Math.max(...rawCells.map((cell) => cell.intensity), 1);
  return rawCells.map((cell) => ({
    ...cell,
    intensity: Math.round((cell.intensity / maxIntensity) * 100),
  }));
}

function deriveMoodAnalytics(
  audioFeatures: SpotifyAudioFeature[],
  recent: SpotifyRecentlyPlayedItem[],
  topTracks: SpotifyTopTracksResponse["items"],
  longTermTopTracks: SpotifyTopTracksResponse["items"],
  topArtists: SpotifyArtist[],
) {
  if (audioFeatures.length === 0) {
    const fallback = deriveMoodDataFromGenres(topArtists);
    return {
      moodData: fallback.moodData,
      moodSource: fallback.moodSource,
      moodHeatmap: deriveMoodHeatmapFallback(fallback.moodData),
    };
  }

  const featureMap = new Map(audioFeatures.map((feature) => [feature.id, feature]));
  const recentMoodMeta = buildRecentMoodMeta(recent, audioFeatures).filter(
    (meta): meta is RecentTrackMoodMeta & { mood: (typeof moodOrder)[number] } => Boolean(meta.mood),
  );

  if (recentMoodMeta.length > 0) {
    const moodCounts = new Map<string, number>(moodOrder.map((mood) => [mood, 0]));
    const energyTotals = new Map<string, { total: number; count: number }>(moodOrder.map((mood) => [mood, { total: 0, count: 0 }]));
    const rawHeatmap = new Map<string, number>();

    recentMoodMeta.forEach((meta) => {
      const mood = meta.mood;
      const feature = featureMap.get(meta.item.track.id);
      const minutes = minutesFromMs(meta.item.track.duration_ms);
      const period = meta.period;

      moodCounts.set(mood, (moodCounts.get(mood) ?? 0) + 1);
      if (feature) {
        const energyEntry = energyTotals.get(mood) ?? { total: 0, count: 0 };
        energyEntry.total += feature.energy * 100;
        energyEntry.count += 1;
        energyTotals.set(mood, energyEntry);
      }

      const heatmapKey = `${period}::${mood}`;
      rawHeatmap.set(heatmapKey, (rawHeatmap.get(heatmapKey) ?? 0) + minutes);
    });

    const totalPlays = [...moodCounts.values()].reduce((sum, value) => sum + value, 0) || 1;
    const moodData: MoodPoint[] = moodOrder.map((mood) => {
      const energyEntry = energyTotals.get(mood) ?? { total: 0, count: 0 };
      return {
        mood,
        share: Math.round(((moodCounts.get(mood) ?? 0) / totalPlays) * 100),
        energy: energyEntry.count > 0 ? Math.round(energyEntry.total / energyEntry.count) : 45,
      };
    });

    const maxMinutes = Math.max(...rawHeatmap.values(), 1);
    const moodHeatmap: MoodHeatmapCell[] = heatmapPeriods.flatMap((period) =>
      moodOrder.map((mood) => {
        const minutes = Number((rawHeatmap.get(`${period}::${mood}`) ?? 0).toFixed(1));
        const intensity = minutes > 0 ? Math.max(8, Math.round((minutes / maxMinutes) * 100)) : 0;
        return { period, mood, minutes, intensity };
      }),
    );

    return {
      moodData,
      moodSource: "Spotify audio-features mood model (recent-play dominant mood)",
      moodHeatmap: moodHeatmap.some((cell) => cell.intensity > 0) ? moodHeatmap : deriveMoodHeatmapFallback(moodData),
    };
  }

  const shareScores = new Map<string, number>(moodOrder.map((mood) => [mood, 0]));
  const energyTotals = new Map<string, { total: number; count: number }>(moodOrder.map((mood) => [mood, { total: 0, count: 0 }]));
  const weightedTracks = new Map<string, { weight: number; feature: SpotifyAudioFeature }>();

  topTracks.forEach((track, index) => {
    const feature = featureMap.get(track.id);
    if (!feature) {
      return;
    }

    const weight = Math.max(1, 14 - index) * 1.2;
    const existing = weightedTracks.get(track.id);
    weightedTracks.set(track.id, { feature, weight: (existing?.weight ?? 0) + weight });
  });

  longTermTopTracks.forEach((track, index) => {
    const feature = featureMap.get(track.id);
    if (!feature) {
      return;
    }

    const weight = Math.max(1, 14 - index) * 0.7;
    const existing = weightedTracks.get(track.id);
    weightedTracks.set(track.id, { feature, weight: (existing?.weight ?? 0) + weight });
  });

  recent.forEach((item, index) => {
    const feature = featureMap.get(item.track.id);
    if (!feature) {
      return;
    }

    const weight = Math.max(1.2, 12 - index) + minutesFromMs(item.track.duration_ms) / 6;
    const existing = weightedTracks.get(item.track.id);
    weightedTracks.set(item.track.id, { feature, weight: (existing?.weight ?? 0) + weight });
  });

  weightedTracks.forEach(({ feature, weight }) => {
    const scores = getMoodScores(feature);
    const normalizedEntries = moodOrder.map((mood) => {
      const softenedScore = Math.pow(scores[mood], 1.15);
      return [mood, softenedScore] as const;
    });
    const totalScore = normalizedEntries.reduce((sum, [, value]) => sum + value, 0) || 1;

    normalizedEntries.forEach(([mood, value]) => {
      const contribution = (value / totalScore) * weight;
      shareScores.set(mood, (shareScores.get(mood) ?? 0) + contribution);
      const energyEntry = energyTotals.get(mood) ?? { total: 0, count: 0 };
      energyEntry.total += feature.energy * 100 * contribution;
      energyEntry.count += contribution;
      energyTotals.set(mood, energyEntry);
    });
  });

  const totalShare = [...shareScores.values()].reduce((sum, value) => sum + value, 0) || 1;
  const moodData: MoodPoint[] = moodOrder.map((mood) => {
    const energyEntry = energyTotals.get(mood) ?? { total: 0, count: 0 };
    return {
      mood,
      share: Math.round(((shareScores.get(mood) ?? 0) / totalShare) * 100),
      energy: energyEntry.count > 0 ? Math.round(energyEntry.total / energyEntry.count) : 45,
    };
  });

  const rawHeatmap = new Map<string, number>();

  recent.forEach((item) => {
    const feature = featureMap.get(item.track.id);
    if (!feature) {
      return;
    }

    const period = getDayPeriod(item.played_at);
    const scores = getMoodScores(feature);
    const normalizedEntries = moodOrder.map((mood) => {
      const softenedScore = Math.pow(scores[mood], 1.1);
      return [mood, softenedScore] as const;
    });
    const totalScore = normalizedEntries.reduce((sum, [, value]) => sum + value, 0) || 1;

    normalizedEntries.forEach(([mood, value]) => {
      const key = `${period}::${mood}`;
      const minutes = (value / totalScore) * minutesFromMs(item.track.duration_ms);
      rawHeatmap.set(key, (rawHeatmap.get(key) ?? 0) + minutes);
    });
  });

  const maxMinutes = Math.max(...rawHeatmap.values(), 1);
  const moodHeatmap: MoodHeatmapCell[] = heatmapPeriods.flatMap((period) =>
    moodOrder.map((mood) => {
      const minutes = Number((rawHeatmap.get(`${period}::${mood}`) ?? 0).toFixed(1));
      const intensity = minutes > 0 ? Math.max(8, Math.round((minutes / maxMinutes) * 100)) : 0;
      return { period, mood, minutes, intensity };
    }),
  );

  return {
    moodData,
    moodSource: "Spotify audio-features mood model",
    moodHeatmap: moodHeatmap.some((cell) => cell.intensity > 0) ? moodHeatmap : deriveMoodHeatmapFallback(moodData),
  };
}

type TrendBucket = {
  key: string;
  label: string;
};

function buildTrendBuckets(range: DashboardRange): TrendBucket[] {
  const now = new Date();
  const weekdayFormatter = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: PACIFIC_TIME_ZONE });
  const monthFormatter = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: PACIFIC_TIME_ZONE });

  if (range === "week") {
    const todaySerial = getPacificDaySerial(now);
    return Array.from({ length: 7 }, (_, index) => {
      const daySerial = todaySerial - (6 - index);
      const labelDate = pacificSerialToDate(daySerial);
      return {
        key: `day:${daySerial}`,
        label: weekdayFormatter.format(labelDate),
      };
    });
  }

  if (range === "month") {
    const todaySerial = getPacificDaySerial(now);
    const firstBucketStart = todaySerial - 29;

    return Array.from({ length: 5 }, (_, index) => {
      const bucketStart = firstBucketStart + index * 6;
      const labelDate = pacificSerialToDate(bucketStart);
      const { day } = getPacificDateParts(labelDate);

      return {
        key: `window:${index}`,
        label: `${monthFormatter.format(labelDate)} ${day}`,
      };
    });
  }

  const currentMonthSerial = getPacificMonthSerial(now);
  return Array.from({ length: 6 }, (_, index) => {
    const monthSerial = currentMonthSerial - (5 - index);
    const labelDate = pacificMonthSerialToDate(monthSerial);
    return {
      key: `month:${monthSerial}`,
      label: monthFormatter.format(labelDate),
    };
  });
}

function getTrendBucketKeyForPlay(playedAt: string, range: DashboardRange) {
  if (range === "week") {
    const todaySerial = getPacificDaySerial(new Date());
    const playSerial = getPacificDaySerial(playedAt);
    return playSerial >= todaySerial - 6 && playSerial <= todaySerial ? `day:${playSerial}` : null;
  }

  if (range === "month") {
    const todaySerial = getPacificDaySerial(new Date());
    const firstBucketStart = todaySerial - 29;
    const playSerial = getPacificDaySerial(playedAt);

    if (playSerial < firstBucketStart || playSerial > todaySerial) {
      return null;
    }

    const index = Math.min(4, Math.floor((playSerial - firstBucketStart) / 6));
    return `window:${index}`;
  }

  const currentMonthSerial = getPacificMonthSerial(new Date());
  const playMonthSerial = getPacificMonthSerial(playedAt);
  return playMonthSerial >= currentMonthSerial - 5 && playMonthSerial <= currentMonthSerial ? `month:${playMonthSerial}` : null;
}

function deriveTrendData(recent: SpotifyRecentlyPlayedItem[], range: DashboardRange): TrendPoint[] {
  const buckets = buildTrendBuckets(range);
  const bucketMap = new Map<string, { minutes: number; artists: Set<string> }>(
    buckets.map((bucket) => [bucket.key, { minutes: 0, artists: new Set<string>() }]),
  );

  recent.forEach((item) => {
    const bucketKey = getTrendBucketKeyForPlay(item.played_at, range);
    if (!bucketKey || !bucketMap.has(bucketKey)) {
      return;
    }

    const bucket = bucketMap.get(bucketKey);
    if (!bucket) {
      return;
    }

    bucket.minutes += minutesFromMs(item.track.duration_ms);
    item.track.artists.forEach((artist) => bucket.artists.add(artist.name.toLowerCase()));
  });

  return buckets.map((bucket) => {
    const values = bucketMap.get(bucket.key) ?? { minutes: 0, artists: new Set<string>() };
    return {
      label: bucket.label,
      minutes: Math.round(values.minutes),
      rediscovered: values.artists.size,
    };
  });
}

function deriveForgottenFavorites(
  topTracks: SpotifyTopTracksResponse["items"],
  recent: SpotifyRecentlyPlayedItem[],
  longTermTopTracks: SpotifyTopTracksResponse["items"] = [],
  savedTracks: SpotifySavedTrackItem[] = [],
): FavoriteTrack[] {
  const recentMap = new Map<string, string>();
  recent.forEach((item) => {
    const key = titleKey(item.track.name, item.track.artists[0]?.name ?? "Unknown Artist");
    recentMap.set(key, item.played_at);
  });

  const candidateMap = new Map<string, {
    title: string;
    artist: string;
    album: string;
    popularity: number;
    sourceBoost: number;
    savedAt?: string;
    imageUrl?: string;
  }>();

  topTracks.forEach((track, index) => {
    const artist = track.artists[0]?.name ?? "Unknown Artist";
    candidateMap.set(track.id, {
      title: track.name,
      artist,
      album: track.album.name,
      popularity: track.popularity,
      sourceBoost: 18 + Math.max(0, 8 - index),
      imageUrl: track.album.images?.[0]?.url,
    });
  });

  longTermTopTracks.forEach((track, index) => {
    const artist = track.artists[0]?.name ?? "Unknown Artist";
    const existing = candidateMap.get(track.id);
    candidateMap.set(track.id, {
      title: track.name,
      artist,
      album: track.album.name,
      popularity: Math.max(existing?.popularity ?? 0, track.popularity),
      sourceBoost: Math.max(existing?.sourceBoost ?? 0, 24 + Math.max(0, 8 - index)),
      savedAt: existing?.savedAt,
      imageUrl: existing?.imageUrl ?? track.album.images?.[0]?.url,
    });
  });

  savedTracks.forEach((item, index) => {
    const track = item.track;
    const artist = track.artists[0]?.name ?? "Unknown Artist";
    const existing = candidateMap.get(track.id);
    candidateMap.set(track.id, {
      title: track.name,
      artist,
      album: track.album.name,
      popularity: Math.max(existing?.popularity ?? 0, track.popularity),
      sourceBoost: Math.max(existing?.sourceBoost ?? 0, 20 + Math.max(0, 12 - index)),
      savedAt: item.added_at,
      imageUrl: existing?.imageUrl ?? track.album.images?.[0]?.url,
    });
  });

  return [...candidateMap.entries()]
    .map(([, candidate]) => {
      const key = titleKey(candidate.title, candidate.artist);
      const recentPlay = recentMap.get(key);
      const recencyBoost = recentPlay ? Math.min(18, daysSince(recentPlay)) : 22;
      const libraryBoost = candidate.savedAt ? Math.min(12, Math.floor(daysSince(candidate.savedAt) / 30) + 4) : 0;
      const lastPlayed = recentPlay ? `${daysSince(recentPlay)} days ago` : "Not in recent listens";
      const affinity = Math.min(99, Math.max(70, Math.round(candidate.popularity * 0.58 + candidate.sourceBoost + recencyBoost + libraryBoost)));

      return {
        title: candidate.title,
        artist: candidate.artist,
        album: candidate.album,
        lastPlayed,
        affinity,
        imageUrl: candidate.imageUrl,
        recentPlay,
      };
    })
    .sort((a, b) => Number(Boolean(a.recentPlay)) - Number(Boolean(b.recentPlay)) || b.affinity - a.affinity)
    .slice(0, 12)
    .map<FavoriteTrack>(({ recentPlay: _recentPlay, ...track }) => track);
}

function deriveQuietSavedTracks(
  savedTracks: SpotifySavedTrackItem[] = [],
  recent: SpotifyRecentlyPlayedItem[],
  excludedTitles: Set<string>,
): FavoriteTrack[] {
  const recentMap = new Map<string, string>();
  recent.forEach((item) => {
    const key = titleKey(item.track.name, item.track.artists[0]?.name ?? "Unknown Artist");
    if (!recentMap.has(key)) {
      recentMap.set(key, item.played_at);
    }
  });

  const candidateMap = new Map<string, FavoriteTrack & { recentPlay?: string; dormantScore: number }>();

  savedTracks.forEach((item, index) => {
    const track = item.track;
    const artist = track.artists[0]?.name ?? "Unknown Artist";
    const dedupeKey = titleKey(track.name, artist);

    if (excludedTitles.has(dedupeKey)) {
      return;
    }

    const recentPlay = recentMap.get(dedupeKey);
    const daysSinceSaved = Math.max(0, daysSince(item.added_at));
    const daysSincePlayed = recentPlay ? daysSince(recentPlay) : Math.max(45, Math.floor(daysSinceSaved * 0.45));
    const dormantScore = daysSincePlayed + Math.min(24, Math.floor(daysSinceSaved / 45)) + Math.max(0, 12 - index);
    const affinity = Math.max(58, Math.min(92, Math.round(40 + dormantScore * 0.75 + track.popularity * 0.18)));

    const existing = candidateMap.get(track.id);
    if (!existing || dormantScore > existing.dormantScore) {
      candidateMap.set(track.id, {
        title: track.name,
        artist,
        album: track.album.name,
        lastPlayed: recentPlay ? `${daysSincePlayed} days ago` : "Not in recent listens",
        affinity,
        imageUrl: track.album.images?.[0]?.url,
        savedAt: item.added_at,
        reason: recentPlay
          ? `Saved earlier and absent from rotation for ${daysSincePlayed} days.`
          : "Saved in your library, but it has not shown up in your recent listening window.",
        recentPlay,
        dormantScore,
      });
    }
  });

  return [...candidateMap.values()]
    .sort((a, b) => b.dormantScore - a.dormantScore || b.affinity - a.affinity)
    .slice(0, 12)
    .map(({ recentPlay: _recentPlay, dormantScore: _dormantScore, ...track }) => track);
}
function deriveStatCards(
  topArtists: SpotifyArtist[],
  topTracks: SpotifyTopTracksResponse["items"],
  recent: SpotifyRecentlyPlayedItem[],
  snapshotCount: number,
  range: DashboardRange,
): StatCard[] {
  const totalHours = hoursFromMs(recent.reduce((sum, item) => sum + item.track.duration_ms, 0));
  const topArtist = topArtists[0];
  const topTrack = topTracks[0];
  const rangeLabel = range === "week" ? "7 days" : range === "month" ? "30 days" : "full history";

  return [
    {
      label: "Recent listening",
      value: formatDuration(totalHours),
      delta: `${recent.length} deduped plays in ${rangeLabel}`,
    },
    {
      label: "Top artist",
      value: topArtist?.name ?? "Unavailable",
      delta: topArtist?.genres[0] ?? "Aggregated from Spotify snapshots",
    },
    {
      label: "Top track",
      value: topTrack?.name ?? "Unavailable",
      delta: topTrack ? topTrack.artists.map((artist) => artist.name).join(", ") : "Waiting on Spotify data",
    },
    {
      label: "Snapshots stored",
      value: String(snapshotCount),
      delta: "Historical cache points available",
    },
  ];
}

function getTrendHeading(range: DashboardRange) {
  if (range === "month") {
    return "Listening minutes vs artist spread by week";
  }

  if (range === "all") {
    return "Listening minutes vs artist spread by month";
  }

  return "Listening minutes vs artist spread by day";
}

function buildRecentMoodMeta(recent: SpotifyRecentlyPlayedItem[], audioFeatures: SpotifyAudioFeature[]): RecentTrackMoodMeta[] {
  const featureMap = new Map(audioFeatures.map((feature) => [feature.id, feature]));

  return recent.map((item) => {
    const feature = featureMap.get(item.track.id);
    return {
      item,
      mood: feature ? getDominantMood(feature) : undefined,
      period: getDayPeriod(item.played_at),
    };
  });
}

function toAnalysisEntry(meta: RecentTrackMoodMeta): DashboardAnalysisEntry {
  return {
    trackId: meta.item.track.id,
    title: meta.item.track.name,
    artist: meta.item.track.artists.map((artist) => artist.name).join(", "),
    album: meta.item.track.album.name,
    imageUrl: meta.item.track.album.images?.[0]?.url,
    playedAt: meta.item.played_at,
    durationMs: meta.item.track.duration_ms,
    mood: meta.mood,
    period: meta.period,
  };
}

function buildAnalysisFilterLabel(range: DashboardRange, from?: string, to?: string) {
  if (from && to) {
    if (from === to) {
      return formatPacificLabel(from);
    }

    return `${formatPacificLabel(from)} to ${formatPacificLabel(to)}`;
  }

  if (range === "week") {
    return "Last 7 days";
  }

  if (range === "month") {
    return "Last 30 days";
  }

  return "Last 6 months";
}

function formatPacificLabel(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: PACIFIC_TIME_ZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

function buildAnalysisArtistGenreLookup(snapshots: SpotifyDashboardSnapshot[]) {
  const lookup = new Map<string, string[]>();

  snapshots.forEach((snapshot) => {
    snapshot.topArtists.forEach((artist) => {
      const genres = getArtistGenres(artist);
      if (genres.length === 0) {
        return;
      }

      lookup.set(artist.name.toLowerCase(), genres);
    });
  });

  return lookup;
}

function deriveMoodDataFromGenreNames(genreNames: string[]) {
  const buckets = [
    { mood: "Adrenaline Rush", energy: 88, matchers: ["dance", "house", "edm", "electro", "hyperpop", "drum and bass", "punk", "hardcore"] },
    { mood: "Neon Drift", energy: 58, matchers: ["synthwave", "night", "alternative r&b", "trip-hop", "downtempo", "neo-soul"] },
    { mood: "Dreamwash", energy: 34, matchers: ["ambient", "chill", "dream", "lo-fi", "shoegaze", "bedroom pop"] },
    { mood: "Melancholy Glow", energy: 42, matchers: ["sad", "emo", "singer-songwriter", "grunge", "melanch", "slowcore"] },
    { mood: "Bright Pulse", energy: 72, matchers: ["pop", "funk", "disco", "soul", "groove", "nu-disco"] },
    { mood: "Flow State", energy: 50, matchers: ["classical", "instrumental", "study", "jazz", "soundtrack", "post-rock"] },
    { mood: "Cathartic", energy: 68, matchers: ["metalcore", "post-hardcore", "alt rock", "indie rock", "arena rock", "gospel"] },
    { mood: "Swagger", energy: 66, matchers: ["hip hop", "rap", "trap", "phonk", "afrobeats", "dancehall"] },
  ] as const;

  const scores = new Map<string, number>(buckets.map((bucket) => [bucket.mood, 1]));

  genreNames.forEach((genre) => {
    const normalized = genre.toLowerCase();
    let matched = false;

    for (const bucket of buckets) {
      if (bucket.matchers.some((matcher) => normalized.includes(matcher))) {
        scores.set(bucket.mood, (scores.get(bucket.mood) ?? 0) + 1.4);
        matched = true;
      }
    }

    if (!matched) {
      scores.set("Bright Pulse", (scores.get("Bright Pulse") ?? 0) + 0.5);
    }
  });

  const total = [...scores.values()].reduce((sum, value) => sum + value, 0) || 1;
  return moodOrder.map((mood) => ({
    mood,
    share: Math.round(((scores.get(mood) ?? 0) / total) * 100),
  }));
}

function normalizeMoodShares(points: MoodPoint[]): MoodPoint[] {
  const base = moodOrder.map((mood) => points.find((point) => point.mood === mood) ?? { mood, share: 0, energy: 50 });
  const total = base.reduce((sum, point) => sum + point.share, 0);

  if (total <= 0) {
    return base.map((point) => ({
      ...point,
      share: point.mood === "Bright Pulse" ? 100 : 0,
    }));
  }

  let remainder = 100;
  const normalized = base.map((point, index) => {
    if (index === base.length - 1) {
      return {
        ...point,
        share: remainder,
      };
    }

    const share = Math.round((point.share / total) * 100);
    remainder -= share;
    return {
      ...point,
      share,
    };
  });

  return normalized;
}

function blendMoodData(primary: MoodPoint[], secondary: Array<{ mood: string; share: number }>, secondaryWeight = 0.32): MoodPoint[] {
  const primaryByMood = new Map(primary.map((point) => [point.mood, point]));
  const secondaryByMood = new Map(secondary.map((point) => [point.mood, point]));

  const blended = moodOrder.map((mood) => {
    const primaryPoint = primaryByMood.get(mood) ?? { mood, share: 0, energy: 50 };
    const secondaryPoint = secondaryByMood.get(mood) ?? { mood, share: 0 };

    return {
      mood,
      share: primaryPoint.share * (1 - secondaryWeight) + secondaryPoint.share * secondaryWeight,
      energy: primaryPoint.energy,
    };
  });

  return normalizeMoodShares(blended);
}

function smoothMoodHeatmap(cells: MoodHeatmapCell[], moodData: MoodPoint[], baselineWeight = 0.18): MoodHeatmapCell[] {
  if (cells.length === 0) {
    return cells;
  }

  const moodShareByMood = new Map(moodData.map((point) => [point.mood, point.share / 100]));
  const totalMinutesByPeriod = new Map<string, number>();

  cells.forEach((cell) => {
    totalMinutesByPeriod.set(cell.period, (totalMinutesByPeriod.get(cell.period) ?? 0) + cell.minutes);
  });

  const adjusted = cells.map((cell) => {
    const baselineMinutes = (totalMinutesByPeriod.get(cell.period) ?? 0) * (moodShareByMood.get(cell.mood) ?? 0) * baselineWeight;
    return {
      ...cell,
      minutes: Number((cell.minutes + baselineMinutes).toFixed(1)),
    };
  });

  const maxMinutes = Math.max(...adjusted.map((cell) => cell.minutes), 1);
  return adjusted.map((cell) => ({
    ...cell,
    intensity: cell.minutes > 0 ? Math.max(8, Math.round((cell.minutes / maxMinutes) * 100)) : 0,
  }));
}

function applyOverviewMoodSmoothing(moodResult: MoodAnalyticsResult, fallbackGenres: string[]): MoodAnalyticsResult {
  if (fallbackGenres.length === 0) {
    return moodResult;
  }

  const fallbackMoodData = deriveMoodDataFromGenreNames(fallbackGenres);
  const blendedMoodData = blendMoodData(moodResult.moodData, fallbackMoodData);

  return {
    ...moodResult,
    moodData: blendedMoodData,
    moodHeatmap: smoothMoodHeatmap(moodResult.moodHeatmap, blendedMoodData),
  };
}

async function buildAnalysisHighlights(
  recent: SpotifyRecentlyPlayedItem[],
  snapshots: SpotifyDashboardSnapshot[],
  filterLabel: string,
  moodEntries: Array<(typeof moodOrder)[number] | undefined>,
): Promise<Omit<DashboardAnalysisDetail, "section" | "title" | "subtitle" | "range" | "entries" | "from" | "to">> {
  const totalMinutes = recent.reduce((sum, item) => sum + minutesFromMs(item.track.duration_ms), 0);
  const uniqueTracks = new Set(recent.map((item) => item.track.id)).size;
  const uniqueArtists = new Set(
    recent.flatMap((item) => item.track.artists.map((artist) => artist.name.toLowerCase())),
  ).size;
  const uniqueAlbums = new Set(recent.map((item) => `${item.track.album.name}::${item.track.artists[0]?.name ?? ""}`.toLowerCase())).size;
  const averageMinutes = recent.length > 0 ? totalMinutes / recent.length : 0;

  const periodTotals = new Map<(typeof heatmapPeriods)[number], { minutes: number; plays: number }>(
    heatmapPeriods.map((period) => [period, { minutes: 0, plays: 0 }]),
  );
  const artistTotals = new Map<string, { plays: number; minutes: number }>();
  const albumTotals = new Map<string, { plays: number; minutes: number; artist: string }>();
  const genreTotals = new Map<string, { minutes: number; plays: number }>();
  const genreLookup = buildAnalysisArtistGenreLookup(snapshots);
  let fallbackArtistTags: Map<string, string[]> | null = null;
  const dayTotals = new Map<string, number>();

  recent.forEach((item) => {
    const minutes = minutesFromMs(item.track.duration_ms);
    const period = getDayPeriod(item.played_at);
    const dayKey = toPacificDateKey(item.played_at);

    periodTotals.set(period, {
      minutes: (periodTotals.get(period)?.minutes ?? 0) + minutes,
      plays: (periodTotals.get(period)?.plays ?? 0) + 1,
    });
    dayTotals.set(dayKey, (dayTotals.get(dayKey) ?? 0) + minutes);

    item.track.artists.forEach((artist) => {
      const key = artist.name;
      const existingArtist = artistTotals.get(key) ?? { plays: 0, minutes: 0 };
      artistTotals.set(key, {
        plays: existingArtist.plays + 1,
        minutes: existingArtist.minutes + minutes,
      });

      const genres = genreLookup.get(artist.name.toLowerCase()) ?? [];
      genres.slice(0, 3).forEach((genre) => {
        const existingGenre = genreTotals.get(genre) ?? { minutes: 0, plays: 0 };
        genreTotals.set(genre, {
          minutes: existingGenre.minutes + minutes / Math.max(1, item.track.artists.length),
          plays: existingGenre.plays + 1,
        });
      });
    });

    const albumKey = `${item.track.album.name}::${item.track.artists[0]?.name ?? "Unknown Artist"}`;
    const existingAlbum = albumTotals.get(albumKey) ?? {
      plays: 0,
      minutes: 0,
      artist: item.track.artists[0]?.name ?? "Unknown Artist",
    };
    albumTotals.set(albumKey, {
      plays: existingAlbum.plays + 1,
      minutes: existingAlbum.minutes + minutes,
      artist: existingAlbum.artist,
    });
  });

  const peakPeriod = [...periodTotals.entries()].sort((a, b) => b[1].minutes - a[1].minutes)[0];
  const busiestDay = [...dayTotals.entries()].sort((a, b) => b[1] - a[1])[0];
  const firstPlay = recent[recent.length - 1]?.played_at;
  const lastPlay = recent[0]?.played_at;

  const summaryCards = [
    {
      label: "Listening time",
      value: `${Math.round(totalMinutes)} min`,
      delta: `${recent.length} plays across ${filterLabel.toLowerCase()}`,
    },
    {
      label: "Artist spread",
      value: String(uniqueArtists),
      delta: `${uniqueTracks} unique tracks and ${uniqueAlbums} albums`,
    },
    {
      label: "Peak window",
      value: peakPeriod?.[0] ?? "Unavailable",
      delta: peakPeriod ? `${Math.round(peakPeriod[1].minutes)} minutes in that period` : "Not enough listening history yet",
    },
    {
      label: "Average play",
      value: `${averageMinutes.toFixed(1)} min`,
      delta: busiestDay ? `Busiest day: ${formatPacificLabel(busiestDay[0])}` : "No busiest day available yet",
    },
  ];

  const topArtists = [...artistTotals.entries()]
    .sort((a, b) => b[1].minutes - a[1].minutes || b[1].plays - a[1].plays)
    .slice(0, 4)
    .map<DashboardAnalysisHighlight>(([artist, value]) => ({
      label: artist,
      value: `${Math.round(value.minutes)} min`,
      detail: `${value.plays} play${value.plays === 1 ? "" : "s"}`,
    }));

  const topAlbums = [...albumTotals.entries()]
    .sort((a, b) => b[1].minutes - a[1].minutes || b[1].plays - a[1].plays)
    .slice(0, 4)
    .map<DashboardAnalysisHighlight>(([albumKey, value]) => ({
      label: albumKey.split("::")[0] ?? albumKey,
      value: `${Math.round(value.minutes)} min`,
      detail: `${value.artist} • ${value.plays} play${value.plays === 1 ? "" : "s"}`,
    }));

  if (genreTotals.size === 0) {
    const fallbackArtistNames = [...new Set(recent.flatMap((item) => item.track.artists.map((artist) => artist.name)).filter(Boolean))];
    fallbackArtistTags = await fetchMusicBrainzArtistTags(fallbackArtistNames);

    recent.forEach((item) => {
      const minutes = minutesFromMs(item.track.duration_ms);
      const fallbackGenres = new Set<string>();

      item.track.artists.forEach((artist) => {
        (fallbackArtistTags?.get(artist.name.toLowerCase()) ?? []).slice(0, 3).forEach((genre) => fallbackGenres.add(genre));
      });

      fallbackGenres.forEach((genre) => {
        const existingGenre = genreTotals.get(genre) ?? { minutes: 0, plays: 0 };
        genreTotals.set(genre, {
          minutes: existingGenre.minutes + minutes / Math.max(1, fallbackGenres.size),
          plays: existingGenre.plays + 1,
        });
      });
    });
  }

  const topGenres = [...genreTotals.entries()]
    .sort((a, b) => b[1].minutes - a[1].minutes || b[1].plays - a[1].plays)
    .slice(0, 4)
    .map<DashboardAnalysisHighlight>(([genre, value]) => ({
      label: genre,
      value: `${Math.round(value.minutes)} min`,
      detail: `${value.plays} contributing play${value.plays === 1 ? "" : "s"}`,
    }));

  const moodCounts = new Map<string, number>(moodOrder.map((mood) => [mood, 0]));
  moodEntries.forEach((mood) => {
    if (mood) {
      moodCounts.set(mood, (moodCounts.get(mood) ?? 0) + 1);
    }
  });

  if ([...moodCounts.values()].every((value) => value === 0)) {
    const inferredMoods = deriveMoodDataFromGenreNames(topGenres.map((item) => item.label));
    inferredMoods.forEach((entry) => {
      moodCounts.set(entry.mood, entry.share);
    });
  }

  const totalMoodScore = [...moodCounts.values()].reduce((sum, value) => sum + value, 0) || 1;
  const topMoods = [...moodCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map<DashboardAnalysisHighlight>(([mood, value]) => ({
      label: mood,
      value: `${Math.round((value / totalMoodScore) * 100)}%`,
      detail: value > 0 ? `${value} matched play${value === 1 ? "" : "s"} in this slice` : "Estimated from genre fallback",
    }));

  const periodBreakdown = heatmapPeriods.map<DashboardAnalysisHighlight>((period) => {
    const value = periodTotals.get(period) ?? { minutes: 0, plays: 0 };
    return {
      label: period,
      value: `${Math.round(value.minutes)} min`,
      detail: `${value.plays} play${value.plays === 1 ? "" : "s"}`,
    };
  }).sort((a, b) => Number.parseInt(b.value, 10) - Number.parseInt(a.value, 10));

  return {
    filterLabel,
    summaryCards,
    topArtists,
    topAlbums,
    topGenres,
    topMoods,
    periodBreakdown,
  };
}

async function ensureSnapshotsForRange(accessToken: string, spotifyUserId: string, range: DashboardRange) {
  const latestSnapshot = await getLatestSnapshot(spotifyUserId);

  if (accessToken && AUTO_REFRESH_DASHBOARD_SNAPSHOTS && (!latestSnapshot || !isFresh(latestSnapshot.fetchedAt))) {
    await refreshDashboardSnapshot(accessToken, spotifyUserId);
  }

  let snapshots = await getHistoricalSnapshots(spotifyUserId, range);

  if (snapshots.length === 0) {
    const fallbackLatest = await getLatestSnapshot(spotifyUserId);
    if (fallbackLatest) {
      snapshots = [fallbackLatest];
    }
  }

  if (snapshots.length === 0 && accessToken && AUTO_REFRESH_DASHBOARD_SNAPSHOTS) {
    const snapshot = await refreshDashboardSnapshot(accessToken, spotifyUserId);
    snapshots = [snapshot];
  }

  return snapshots;
}
function getTrendBadge(range: DashboardRange, snapshotCount: number) {
  if (range === "month") {
    return `5 rolling windows / ${snapshotCount} snapshots`;
  }

  if (range === "all") {
    return `6 month view / ${snapshotCount} snapshots`;
  }

  return `7 day view / ${snapshotCount} snapshots`;
}

async function deriveInsights(
  snapshots: SpotifyDashboardSnapshot[],
  range: DashboardRange,
  accessToken?: string,
  spotifyUserId?: string,
  options?: DashboardInsightOptions,
): Promise<DashboardInsights> {
  const metadataSnapshots = await enrichSnapshotsWithArtistMetadata(snapshots, accessToken);
  const sortedSnapshots = [...metadataSnapshots].sort((a, b) => new Date(b.fetchedAt).getTime() - new Date(a.fetchedAt).getTime());
  const snapshotRecent = dedupeRecent(sortedSnapshots.flatMap((snapshot) => snapshot.recent));
  const storedRecent = spotifyUserId ? await getStoredRecentPlaysForRange(spotifyUserId, range).catch(() => []) : [];
  const recent = storedRecent.length > 0
    ? mergeRecentSources(toRecentPlayedItemsFromStoredPlays(storedRecent), snapshotRecent)
    : snapshotRecent;
  const topArtists = aggregateArtists(sortedSnapshots);
  const topTracks = aggregateTracks(sortedSnapshots);
  const longTermTopTracks = sortedSnapshots.flatMap((snapshot) => snapshot.longTermTopTracks ?? []);
  const savedTracks = sortedSnapshots.flatMap((snapshot) => snapshot.savedTracks ?? []);
  const latestFetchedAt = sortedSnapshots[0]?.fetchedAt;

  let genrePulse = deriveGenrePulse(topArtists, recent);
  let moodResult: MoodAnalyticsResult = {
    ...deriveMoodDataFromGenres(topArtists),
    moodHeatmap: deriveMoodHeatmapFallback(deriveMoodDataFromGenres(topArtists).moodData),
  };
  let playlistInsights: PlaylistInsight[] = [];

  if (accessToken) {
    const recentArtistIds = [
      ...storedRecent.flatMap((play) => play.artistIds ?? []),
      ...recent.flatMap((item) => item.track.artists.map((artist) => artist.id).filter((id): id is string => Boolean(id))),
      ...topArtists.map((artist) => artist.id).filter(Boolean),
      ...sortedSnapshots.flatMap((snapshot) => [
        ...snapshot.topArtists.map((artist) => artist.id),
        ...(snapshot.mediumTermTopArtists ?? []).map((artist) => artist.id),
        ...(snapshot.longTermTopArtists ?? []).map((artist) => artist.id),
      ].filter((id): id is string => Boolean(id))),
    ];
    const recentArtists = await getArtistMetadata(accessToken, recentArtistIds);
    const mergedGenreArtists = mergeArtists(topArtists, recentArtists);
    const artistMetadata = buildArtistMetadataMap(mergedGenreArtists, sortedSnapshots);
    const recentGenrePulse = storedRecent.length > 0
      ? deriveGenrePulseFromStoredRecent(storedRecent, artistMetadata)
      : deriveGenrePulseFromRecentItems(recent, artistMetadata);
    const snapshotGenrePulse = deriveGenrePulseFromRecentItems(recent, artistMetadata);
    const mergedArtistGenrePulse = deriveGenrePulse(mergedGenreArtists, recent.length > 0 ? recent : snapshotRecent);

    if (recentGenrePulse.length > 0) {
      genrePulse = recentGenrePulse;
    } else if (snapshotGenrePulse.length > 0) {
      genrePulse = snapshotGenrePulse;
    } else if (mergedArtistGenrePulse.length > 0) {
      genrePulse = mergedArtistGenrePulse;
    } else if (options?.includePublicTagFallback !== false) {
      const fallbackArtistNames = [
        ...storedRecent.flatMap((play) => play.artistName.split(/,\s*/)),
        ...recent.flatMap((item) => item.track.artists.map((artist) => artist.name)),
        ...mergedGenreArtists.map((artist) => artist.name),
      ];
      const publicArtistTags = await fetchMusicBrainzArtistTags(fallbackArtistNames);
      const publicGenrePulse = buildGenrePulseFromArtistTags(
        storedRecent.length > 0
          ? storedRecent.map((play) => ({ artistNames: play.artistName.split(/,\s*/), durationMs: play.durationMs }))
          : recent.map((item) => ({ artistNames: item.track.artists.map((artist) => artist.name), durationMs: item.track.duration_ms })),
        publicArtistTags,
      );

      if (publicGenrePulse.length > 0) {
        genrePulse = publicGenrePulse;
      }
    }

    const audioFeatureTrackIds = [
      ...new Set([...topTracks, ...longTermTopTracks, ...recent.map((item) => item.track)].map((track) => track.id)),
    ].slice(0, 100);

    const [features, livePlaylistInsights] = await Promise.all([
      getAudioFeatures(accessToken, audioFeatureTrackIds),
      spotifyUserId && options?.includeLivePlaylistInsights !== false
        ? getAllPlaylistInsights(accessToken, spotifyUserId, "last_listened_desc").then((items) => items.slice(0, 3)).catch(() => null)
        : Promise.resolve(null),
    ]);
    moodResult = deriveMoodAnalytics(features, recent, topTracks, longTermTopTracks, topArtists);

    if (livePlaylistInsights && livePlaylistInsights.length > 0) {
      playlistInsights = livePlaylistInsights;
    }
  }

  moodResult = applyOverviewMoodSmoothing(moodResult, genrePulse.map((item) => item.genre));

  const forgottenFavorites = deriveForgottenFavorites(topTracks, recent, longTermTopTracks, savedTracks);
  const quietSavedTracks = deriveQuietSavedTracks(
    savedTracks,
    recent,
    new Set(forgottenFavorites.map((track) => titleKey(track.title, track.artist))),
  );

  return {
    statCards: deriveStatCards(topArtists, topTracks, recent, sortedSnapshots.length, range),
    trendData: deriveTrendData(recent, range),
    trendHeading: getTrendHeading(range),
    trendBadge: getTrendBadge(range, sortedSnapshots.length),
    genrePulse,
    moodData: moodResult.moodData,
    moodHeatmap: moodResult.moodHeatmap,
    moodSource: moodResult.moodSource,
    forgottenFavorites,
    quietSavedTracks,
    playlistInsights,
    sourceLabel: sortedSnapshots.length > 1 ? "Historical Spotify snapshots" : "Latest Spotify snapshot",
    cachedAt: latestFetchedAt,
    snapshotCount: sortedSnapshots.length,
    range,
  };
}

async function getHistoricalSnapshots(spotifyUserId: string, range: DashboardRange) {
  if (!hasMongoConfig()) {
    return [] as SpotifyDashboardSnapshot[];
  }

  try {
    const db = await getDatabase();
    if (!db) {
      return [] as SpotifyDashboardSnapshot[];
    }

    const windowStart = getRangeWindow(range);
    const query = windowStart
      ? { spotifyUserId, fetchedAt: { $gte: windowStart.toISOString() } }
      : { spotifyUserId };

    const snapshots = await db
      .collection<SpotifyDashboardSnapshot>(SNAPSHOT_HISTORY_COLLECTION)
      .find(query)
      .sort({ fetchedAt: -1 })
      .limit(range === "all" ? 180 : 90)
      .toArray();
    const ignoredPlaylistIds = await getIgnoredPlaylistIds(spotifyUserId).catch(() => [] as string[]);

    return snapshots.length > 0 ? filterSnapshotRecentHistory(snapshots, ignoredPlaylistIds) : [];
  } catch {
    return [] as SpotifyDashboardSnapshot[];
  }
}

async function getLatestSnapshot(spotifyUserId: string) {
  if (!hasMongoConfig()) {
    return null;
  }

  try {
    const db = await getDatabase();
    if (!db) {
      return null;
    }

    const snapshot = await db.collection<SpotifyDashboardSnapshot>(SNAPSHOT_HISTORY_COLLECTION).find({ spotifyUserId }).sort({ fetchedAt: -1 }).limit(1).next();
    if (!snapshot) {
      return null;
    }

    const ignoredPlaylistIds = await getIgnoredPlaylistIds(spotifyUserId).catch(() => [] as string[]);
    return filterSnapshotRecentHistory([snapshot], ignoredPlaylistIds)[0] ?? null;
  } catch {
    return null;
  }
}

async function writeSnapshot(snapshot: SpotifyDashboardSnapshot) {
  if (!hasMongoConfig()) {
    return;
  }

  try {
    const db = await getDatabase({ forceRetry: true });
    if (!db) {
      return;
    }

    await db.collection<SpotifyDashboardSnapshot>(SNAPSHOT_HISTORY_COLLECTION).insertOne(snapshot);
  } catch {
    return;
  }
}

async function fetchSavedTracks(accessToken: string, limit = 50) {
  const items: SpotifySavedTrackItem[] = [];
  let offset = 0;

  while (items.length < limit) {
    const page = await spotifyFetch<SpotifySavedTracksResponse>(`/me/tracks?limit=50&offset=${offset}`, accessToken);

    items.push(...page.items);

    if (!page.next || page.items.length === 0) {
      break;
    }

    offset += page.items.length;
    if (offset >= limit) {
      break;
    }
  }

  return items.slice(0, limit);
}

async function fetchSnapshot(accessToken: string, spotifyUserId: string): Promise<SpotifyDashboardSnapshot> {
  const [topArtists, topTracks, mediumTermTopArtists, mediumTermTopTracks, longTermTopArtists, longTermTopTracks, recent, savedTracks] = await Promise.all([
    spotifyFetch<SpotifyTopArtistsResponse>("/me/top/artists?time_range=short_term&limit=10", accessToken),
    spotifyFetch<SpotifyTopTracksResponse>("/me/top/tracks?time_range=short_term&limit=10", accessToken),
    spotifyFetch<SpotifyTopArtistsResponse>("/me/top/artists?time_range=medium_term&limit=15", accessToken),
    spotifyFetch<SpotifyTopTracksResponse>("/me/top/tracks?time_range=medium_term&limit=15", accessToken),
    spotifyFetch<SpotifyTopArtistsResponse>("/me/top/artists?time_range=long_term&limit=20", accessToken),
    spotifyFetch<SpotifyTopTracksResponse>("/me/top/tracks?time_range=long_term&limit=20", accessToken),
    spotifyFetch<SpotifyRecentlyPlayedResponse>("/me/player/recently-played?limit=50", accessToken),
    fetchSavedTracks(accessToken, 100),
  ]);

  const allTopArtists = [...topArtists.items, ...mediumTermTopArtists.items, ...longTermTopArtists.items];
  const enrichedArtists = await fetchArtistsByIds(accessToken, allTopArtists.map((artist) => artist.id));
  const mergedArtistMetadata = mergeArtists(
    mergeArtistMetadata(topArtists.items, enrichedArtists),
    mergeArtistMetadata(mediumTermTopArtists.items, enrichedArtists),
    mergeArtistMetadata(longTermTopArtists.items, enrichedArtists),
  );
  await writeStoredArtistMetadata(mergedArtistMetadata);

  const ignoredPlaylistIds = await getIgnoredPlaylistIds(spotifyUserId).catch(() => [] as string[]);
  const filteredRecent = filterRecentItemsByIgnoredPlaylistIds(recent.items, ignoredPlaylistIds);

  const snapshot = {
    spotifyUserId,
    schemaVersion: SNAPSHOT_TOP_LISTS_SCHEMA_VERSION,
    topArtists: mergeArtistMetadata(topArtists.items, enrichedArtists),
    topTracks: topTracks.items,
    mediumTermTopArtists: mergeArtistMetadata(mediumTermTopArtists.items, enrichedArtists),
    mediumTermTopTracks: mediumTermTopTracks.items,
    longTermTopArtists: mergeArtistMetadata(longTermTopArtists.items, enrichedArtists),
    longTermTopTracks: longTermTopTracks.items,
    savedTracks,
    recent: filteredRecent,
    fetchedAt: new Date().toISOString(),
  } satisfies SpotifyDashboardSnapshot;

  return {
    ...snapshot,
    cachedTopLists: buildCachedTopListsForSnapshot(snapshot),
  };
}

export async function shouldWriteSnapshot(spotifyUserId: string, recentPlays?: Array<{ playedAt: string }>) {
  const latestSnapshot = await getLatestSnapshot(spotifyUserId);

  if (!latestSnapshot) {
    return true;
  }

  const latestSnapshotTime = new Date(latestSnapshot.fetchedAt).getTime();
  const latestRecentPlayTime = recentPlays
    ?.map((play) => new Date(play.playedAt).getTime())
    .filter((time) => Number.isFinite(time))
    .sort((a, b) => b - a)[0];

  if (!latestRecentPlayTime) {
    return !isFresh(latestSnapshot.fetchedAt, SNAPSHOT_SIGNIFICANT_PLAY_GAP_MS);
  }

  return latestRecentPlayTime > latestSnapshotTime && (latestRecentPlayTime - latestSnapshotTime >= 1000 * 60 * 5 || !isFresh(latestSnapshot.fetchedAt, SNAPSHOT_SIGNIFICANT_PLAY_GAP_MS));
}

export async function refreshDashboardSnapshot(accessToken: string, spotifyUserId: string, recentPlays?: Awaited<ReturnType<typeof syncRecentPlays>>) {
  const syncedRecent = recentPlays ?? await syncRecentPlays(accessToken, spotifyUserId).catch(() => []);
  const shouldWrite = await shouldWriteSnapshot(spotifyUserId, syncedRecent);

  if (!shouldWrite) {
    return (await getLatestSnapshot(spotifyUserId)) ?? fetchSnapshot(accessToken, spotifyUserId);
  }

  const snapshot = await fetchSnapshot(accessToken, spotifyUserId);
  await writeSnapshot(snapshot);
  return snapshot;
}

export async function getDashboardInsights(accessToken: string, spotifyUserId: string, range: DashboardRange): Promise<DashboardInsights> {
  const snapshots = await ensureSnapshotsForRange(accessToken, spotifyUserId, range);
  return deriveInsights(snapshots, range, accessToken, spotifyUserId);
}

export async function getDashboardInsightsLive(accessToken: string, spotifyUserId: string, range: DashboardRange): Promise<DashboardInsights> {
  const snapshot = await fetchSnapshot(accessToken, spotifyUserId);
  return deriveInsights([snapshot], range, accessToken, spotifyUserId);
}

export async function getDashboardAnalysisDetail(
  accessToken: string,
  spotifyUserId: string,
  range: DashboardRange,
  options: { section: "trend" | "heatmap"; label?: string; mood?: string; period?: string; day?: string; from?: string; to?: string },
): Promise<DashboardAnalysisDetail> {
  const snapshots = await ensureSnapshotsForRange(accessToken, spotifyUserId, range);
  const sortedSnapshots = [...snapshots].sort((a, b) => new Date(b.fetchedAt).getTime() - new Date(a.fetchedAt).getTime());
  const selectedDay = normalizeDateInput(options.day);
  const rawFrom = normalizeDateInput(options.from);
  const rawTo = normalizeDateInput(options.to);
  const from = selectedDay ?? (rawFrom && rawTo && rawFrom > rawTo ? rawTo : rawFrom);
  const to = selectedDay ?? (rawFrom && rawTo && rawFrom > rawTo ? rawFrom : rawTo ?? rawFrom);

  const recent = dedupeRecent(sortedSnapshots.flatMap((snapshot) => snapshot.recent)).filter((item) => {
    if (!from && !to) {
      return true;
    }

    const dayKey = toPacificDateKey(item.played_at);
    if (from && dayKey < from) {
      return false;
    }

    if (to && dayKey > to) {
      return false;
    }

    return true;
  });

  const audioFeatureTrackIds = [...new Set(recent.map((item) => item.track.id))].slice(0, 100);
  const features = await getAudioFeatures(accessToken, audioFeatureTrackIds);
  const recentMoodMeta = buildRecentMoodMeta(recent, features);
  const filterLabel = buildAnalysisFilterLabel(range, from, to);

  if (options.section === "trend") {
    const buckets = buildTrendBuckets(range);
    const targetBucket = options.label ? buckets.find((bucket) => bucket.label === options.label) : undefined;
    const scopedMeta = targetBucket
      ? recentMoodMeta.filter((meta) => getTrendBucketKeyForPlay(meta.item.played_at, range) === targetBucket.key)
      : recentMoodMeta;
    const playCountByTrackId = new Map<string, number>();
    scopedMeta.forEach((meta) => {
      playCountByTrackId.set(meta.item.track.id, (playCountByTrackId.get(meta.item.track.id) ?? 0) + 1);
    });
    const entries = scopedMeta.map((meta) => ({
      ...toAnalysisEntry(meta),
      playCount: playCountByTrackId.get(meta.item.track.id) ?? 1,
    }));
    const highlights = await buildAnalysisHighlights(scopedMeta.map((meta) => meta.item), sortedSnapshots, filterLabel, scopedMeta.map((meta) => meta.mood));

    return {
      section: "trend",
      title: targetBucket ? `${targetBucket.label} listening sessions` : `${filterLabel} listening analysis`,
      subtitle: targetBucket
        ? `Tracks played during the ${range} trend bucket shown on your dashboard, plus deeper breakdowns for this slice.`
        : `A deeper breakdown of the listening history stored for ${filterLabel.toLowerCase()}.`,
      range,
      from,
      to,
      entries,
      ...highlights,
    };
  }

  const targetPeriod = options.period && heatmapPeriods.includes(options.period as (typeof heatmapPeriods)[number])
    ? options.period as (typeof heatmapPeriods)[number]
    : undefined;
  const targetMood = options.mood && moodOrder.includes(options.mood as (typeof moodOrder)[number])
    ? options.mood as (typeof moodOrder)[number]
    : undefined;

  let filtered = recentMoodMeta;
  let subtitle = `A deeper breakdown of listening across ${filterLabel.toLowerCase()}.`;

  if (targetPeriod && targetMood) {
    filtered = recentMoodMeta.filter((meta) => meta.period === targetPeriod && meta.mood === targetMood);
    subtitle = `Recent ${targetMood.toLowerCase()} sessions during ${targetPeriod.toLowerCase()}.`;

    if (filtered.length === 0) {
      filtered = recentMoodMeta.filter((meta) => meta.period === targetPeriod);
      subtitle = `Audio-feature mood matches were unavailable here, so this shows all ${targetPeriod.toLowerCase()} sessions instead.`;
    }
  } else if (targetPeriod) {
    filtered = recentMoodMeta.filter((meta) => meta.period === targetPeriod);
    subtitle = `Listening sessions grouped under ${targetPeriod.toLowerCase()} for ${filterLabel.toLowerCase()}.`;
  }

  const playCountByTrackId = new Map<string, number>();
  filtered.forEach((meta) => {
    playCountByTrackId.set(meta.item.track.id, (playCountByTrackId.get(meta.item.track.id) ?? 0) + 1);
  });
  const highlights = await buildAnalysisHighlights(filtered.map((meta) => meta.item), sortedSnapshots, filterLabel, filtered.map((meta) => meta.mood));

  return {
    section: "heatmap",
    title: targetPeriod && targetMood
      ? `${targetMood} x ${targetPeriod}`
      : targetPeriod
        ? `${targetPeriod} listening analysis`
        : `${filterLabel} listening analysis`,
    subtitle,
    range,
    from,
    to,
    entries: filtered.map((meta) => ({
      ...toAnalysisEntry(meta),
      playCount: playCountByTrackId.get(meta.item.track.id) ?? 1,
    })),
    ...highlights,
  };
}

export async function getDashboardAnalysisDetailFromHistory(
  spotifyUserId: string,
  range: DashboardRange,
  options: { section: "trend" | "heatmap"; label?: string; mood?: string; period?: string; day?: string; from?: string; to?: string },
): Promise<DashboardAnalysisDetail | null> {
  const snapshots = await getSharedDashboardCacheSnapshots(spotifyUserId);
  const selectedDay = normalizeDateInput(options.day);
  const rawFrom = normalizeDateInput(options.from);
  const rawTo = normalizeDateInput(options.to);
  const from = selectedDay ?? (rawFrom && rawTo && rawFrom > rawTo ? rawTo : rawFrom);
  const to = selectedDay ?? (rawFrom && rawTo && rawFrom > rawTo ? rawFrom : rawTo ?? rawFrom);
  const hasCustomWindow = Boolean(from || to);
  const scopedSnapshots = hasCustomWindow ? snapshots : filterSnapshotsForDashboardRange(snapshots, range);
  const relevantSnapshots = scopedSnapshots.length > 0 ? scopedSnapshots : snapshots.slice(0, 1);
  const sortedSnapshots = [...relevantSnapshots].sort((a, b) => new Date(b.fetchedAt).getTime() - new Date(a.fetchedAt).getTime());

  if (sortedSnapshots.length === 0) {
    return null;
  }

  const analysisCacheKey = [
    "dashboard-analysis-history",
    spotifyUserId,
    range,
    options.section,
    options.label ?? "",
    options.mood ?? "",
    options.period ?? "",
    selectedDay ?? "",
    from ?? "",
    to ?? "",
    sortedSnapshots[0]?.fetchedAt ?? "",
    sortedSnapshots.length,
  ].join(":");

  return getCachedValue(analysisCacheKey, ANALYSIS_DETAIL_TTL_MS, async () => {
    const recent = dedupeRecent(sortedSnapshots.flatMap((snapshot) => snapshot.recent)).filter((item) => {
      if (!from && !to) {
        return true;
      }

      const dayKey = toPacificDateKey(item.played_at);
      if (from && dayKey < from) {
        return false;
      }

      if (to && dayKey > to) {
        return false;
      }

      return true;
    });
    const filterLabel = buildAnalysisFilterLabel(range, from, to);

    if (options.section === "trend") {
      const buckets = buildTrendBuckets(range);
      const targetBucket = options.label ? buckets.find((bucket) => bucket.label === options.label) : undefined;
      const scopedRecent = targetBucket
        ? recent.filter((item) => getTrendBucketKeyForPlay(item.played_at, range) === targetBucket.key)
        : recent;
      const playCountByTrackId = new Map<string, number>();
      scopedRecent.forEach((item) => {
        playCountByTrackId.set(item.track.id, (playCountByTrackId.get(item.track.id) ?? 0) + 1);
      });
      const entries = scopedRecent
        .map((item) => ({
          trackId: item.track.id,
          title: item.track.name,
          artist: item.track.artists.map((artist) => artist.name).join(", "),
          album: item.track.album.name,
          imageUrl: item.track.album.images?.[0]?.url,
          playedAt: item.played_at,
          durationMs: item.track.duration_ms,
          period: getDayPeriod(item.played_at),
          playCount: playCountByTrackId.get(item.track.id) ?? 1,
        }));
      const highlights = await buildAnalysisHighlights(scopedRecent, sortedSnapshots, filterLabel, []);

      return {
        section: "trend",
        title: targetBucket ? `${targetBucket.label} listening sessions` : `${filterLabel} listening analysis`,
        subtitle: targetBucket
          ? `Tracks played during the ${range} trend bucket shown in your cached dashboard history, plus deeper breakdowns for this slice.`
          : `A deeper breakdown of the listening history stored for ${filterLabel.toLowerCase()}.`,
        range,
        from,
        to,
        entries,
        ...highlights,
      } satisfies DashboardAnalysisDetail;
    }

    const targetPeriod = options.period && heatmapPeriods.includes(options.period as (typeof heatmapPeriods)[number])
      ? options.period as (typeof heatmapPeriods)[number]
      : undefined;
    const scopedRecent = targetPeriod
    ? recent.filter((item) => getDayPeriod(item.played_at) === targetPeriod)
      : recent;
    const playCountByTrackId = new Map<string, number>();
    scopedRecent.forEach((item) => {
      playCountByTrackId.set(item.track.id, (playCountByTrackId.get(item.track.id) ?? 0) + 1);
    });
    const entries = scopedRecent
      .map((item) => ({
        trackId: item.track.id,
        title: item.track.name,
        artist: item.track.artists.map((artist) => artist.name).join(", "),
        album: item.track.album.name,
        imageUrl: item.track.album.images?.[0]?.url,
        playedAt: item.played_at,
        durationMs: item.track.duration_ms,
      period: getDayPeriod(item.played_at),
        playCount: playCountByTrackId.get(item.track.id) ?? 1,
      }));
    const highlights = await buildAnalysisHighlights(scopedRecent, sortedSnapshots, filterLabel, []);

    return {
      section: "heatmap",
      title: targetPeriod ? `${targetPeriod} sessions` : `${filterLabel} listening analysis`,
      subtitle: targetPeriod
        ? "Cached history does not include live audio-feature mood matching, so this view shows the selected time-of-day sessions from stored snapshots with extra context."
        : `Cached history breakdown for ${filterLabel.toLowerCase()}, including top artists, albums, genres, and time-of-day patterns.`,
      range,
      from,
      to,
      entries,
      ...highlights,
    } satisfies DashboardAnalysisDetail;
  });
}


export async function getSharedDashboardCacheSnapshots(spotifyUserId: string) {
  return getCachedValue(`dashboard-snapshots:${spotifyUserId}`, DASHBOARD_SNAPSHOT_CACHE_TTL_MS, async () => {
    let snapshots;
    try {
      snapshots = await getHistoricalSnapshots(spotifyUserId, "all");
    } catch (error) {
      throw dashboardCacheError("getHistoricalSnapshots", error);
    }

    if (snapshots.length === 0) {
      try {
        const fallbackLatest = await getLatestSnapshot(spotifyUserId);
        if (fallbackLatest) {
          snapshots = [fallbackLatest];
        }
      } catch (error) {
        throw dashboardCacheError("fallbackLatestSnapshot", error);
      }
    }

    return snapshots;
  });
}

export function invalidateDashboardSnapshotCaches(spotifyUserId: string) {
  invalidateCachedValue(`dashboard-snapshots:${spotifyUserId}`);

  DASHBOARD_RANGE_VALUES.forEach((range) => {
    invalidateCachedValue(`dashboard-insights:${spotifyUserId}:${range}:cached`);
    invalidateCachedValue(`dashboard-insights:${spotifyUserId}:${range}:live`);
  });
}

export async function getDashboardInsightsFromSnapshots(
  snapshots: SpotifyDashboardSnapshot[],
  range: DashboardRange,
  accessToken?: string,
  spotifyUserId?: string,
  options?: DashboardInsightOptions,
) {
  const scopedSnapshots = filterSnapshotsForDashboardRange(snapshots, range);
  const relevantSnapshots = scopedSnapshots.length > 0 ? scopedSnapshots : snapshots.slice(0, 1);
  const historicalSnapshots = downsampleSnapshotsForDashboardRange(relevantSnapshots, range);

  if (historicalSnapshots.length === 0) {
    return null;
  }

  const latestFetchedAt = historicalSnapshots[0]?.fetchedAt ?? "";
  const cacheKey = `dashboard-insights:${spotifyUserId ?? "anonymous"}:${range}:${accessToken ? "live" : "cached"}:${options?.includeLivePlaylistInsights === false ? "no-playlists" : "with-playlists"}:${latestFetchedAt}:${historicalSnapshots.length}`;

  return getCachedValue(cacheKey, DASHBOARD_INSIGHTS_CACHE_TTL_MS, () => deriveInsights(historicalSnapshots, range, accessToken, spotifyUserId, options));
}

export async function getDashboardInsightsFromHistory(spotifyUserId: string, range: DashboardRange, accessToken?: string) {
  const snapshots = await getSharedDashboardCacheSnapshots(spotifyUserId);
  return getDashboardInsightsFromSnapshots(snapshots, range, accessToken, spotifyUserId);
}









