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
} from "@/lib/types";
import { spotifyFetch, spotifyFetchOptional } from "@/lib/spotify";

import { getAllPlaylistInsights } from "@/lib/spotify-playlists";
import { getStoredRecentPlaysForRange, syncRecentPlays } from "@/lib/spotify-activity";
import { getDatabase, hasMongoConfig } from "@/lib/mongodb";
import { buildCachedTopListsForSnapshot, SNAPSHOT_TOP_LISTS_SCHEMA_VERSION } from "@/lib/spotify-toplists";
import { PST_TIME_ZONE } from "@/lib/time";

const genreColors = ["#31E7FF", "#53F8B7", "#FFD166", "#FF6B6B", "#2B59FF"];
const moodOrder = ["Energetic", "Chill", "Moody", "Joyful", "Focus"] as const;
const heatmapPeriods = ["Morning", "Afternoon", "Evening", "Late Night"] as const;
const SNAPSHOT_REFRESH_TTL_MS = 1000 * 60 * 15;
const AUTO_REFRESH_DASHBOARD_SNAPSHOTS = true;
const SNAPSHOT_HISTORY_COLLECTION = "spotify_snapshots_history";
const SNAPSHOT_SIGNIFICANT_PLAY_GAP_MS = 1000 * 60 * 60 * 6;
const PACIFIC_TIME_ZONE = PST_TIME_ZONE;
const MUSICBRAINZ_USER_AGENT = "SoundScope/0.1 ( genre pulse fallback )";
const PUBLIC_TAG_FETCH_LIMIT = 12;

type MoodAnalyticsResult = {
  moodData: MoodPoint[];
  moodSource: string;
  moodHeatmap: MoodHeatmapCell[];
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

async function fetchTopArtistsMetadata(accessToken: string) {
  try {
    const [shortTerm, mediumTerm, longTerm] = await Promise.all([
      spotifyFetch<SpotifyTopArtistsResponse>("/me/top/artists?time_range=short_term&limit=25", accessToken),
      spotifyFetch<SpotifyTopArtistsResponse>("/me/top/artists?time_range=medium_term&limit=25", accessToken),
      spotifyFetch<SpotifyTopArtistsResponse>("/me/top/artists?time_range=long_term&limit=25", accessToken),
    ]);

    const artistMap = new Map<string, SpotifyArtist>();
    [...shortTerm.items, ...mediumTerm.items, ...longTerm.items].forEach((artist) => {
      if (artist?.id) {
        artistMap.set(artist.id, artist);
      }
    });

    const artists = [...artistMap.values()];
    const enrichedArtists = await fetchArtistsByIds(accessToken, artists.map((artist) => artist.id));
    return mergeArtistMetadata(artists, enrichedArtists);
  } catch {
    return [] as SpotifyArtist[];
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
            imageUrl: artist.imageUrl ?? metadataArtist.images?.[0]?.url,
          };
        }),
      },
    ]),
  ) as SpotifyDashboardSnapshot["cachedTopLists"];
}

async function enrichSnapshotsWithArtistMetadata(snapshots: SpotifyDashboardSnapshot[], accessToken: string) {
  const snapshotArtistIds = snapshots.flatMap((snapshot) => [
    ...snapshot.topArtists.map((artist) => artist.id),
    ...(snapshot.mediumTermTopArtists ?? []).map((artist) => artist.id),
    ...(snapshot.longTermTopArtists ?? []).map((artist) => artist.id),
    ...snapshot.recent.flatMap((item) => item.track.artists.map((artist) => artist.id).filter((id): id is string => Boolean(id))),
    ...Object.values(snapshot.cachedTopLists ?? {}).flatMap((cachedList) => cachedList.artists.map((artist) => artist.id)),
  ]);

  const metadataArtists = await fetchArtistsByIds(accessToken, snapshotArtistIds);
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

  return {
    Energetic: feature.energy * 0.45 + feature.danceability * 0.25 + tempoNorm * 0.2 + feature.valence * 0.1,
    Chill: (1 - feature.energy) * 0.45 + feature.acousticness * 0.35 + (1 - tempoNorm) * 0.2,
    Moody: (1 - feature.valence) * 0.5 + (1 - feature.energy) * 0.25 + feature.acousticness * 0.25,
    Joyful: feature.valence * 0.5 + feature.danceability * 0.3 + feature.energy * 0.2,
    Focus: feature.instrumentalness * 0.45 + (1 - feature.speechiness) * 0.3 + (1 - Math.abs(feature.energy - 0.45)) * 0.25,
  } as const;
}

function getDominantMood(feature: SpotifyAudioFeature): (typeof moodOrder)[number] {
  const scores = getMoodScores(feature);
  return moodOrder.reduce((best, mood) => (scores[mood] > scores[best] ? mood : best), moodOrder[0]);
}

function getDayPeriod(date: Date) {
  const hour = date.getHours();

  if (hour >= 5 && hour < 11) {
    return "Morning";
  }

  if (hour >= 11 && hour < 17) {
    return "Afternoon";
  }

  if (hour >= 17 && hour < 22) {
    return "Evening";
  }

  return "Late Night";
}

function deriveMoodDataFromGenres(topArtists: SpotifyArtist[]) {
  const buckets = [
    { mood: "Energetic", energy: 84, matchers: ["dance", "house", "edm", "electro", "hyperpop", "punk"] },
    { mood: "Chill", energy: 38, matchers: ["ambient", "chill", "dream", "lo-fi", "indie pop"] },
    { mood: "Moody", energy: 47, matchers: ["sad", "emo", "singer-songwriter", "grunge", "melanch"] },
    { mood: "Joyful", energy: 69, matchers: ["pop", "funk", "disco", "soul", "groove"] },
    { mood: "Focus", energy: 56, matchers: ["classical", "instrumental", "study", "jazz", "soundtrack"] },
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
      scores.set("Joyful", (scores.get("Joyful") ?? 0) + 1);
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
    Morning: { Focus: 1.2, Chill: 1.05, Joyful: 0.8, Energetic: 0.5, Moody: 0.35 },
    Afternoon: { Energetic: 1.15, Joyful: 1.05, Focus: 0.8, Chill: 0.5, Moody: 0.3 },
    Evening: { Energetic: 0.95, Joyful: 0.9, Moody: 0.85, Chill: 0.7, Focus: 0.35 },
    "Late Night": { Chill: 1.2, Moody: 1.1, Focus: 0.8, Joyful: 0.45, Energetic: 0.3 },
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
    const dominantMood = getDominantMood(feature);
    shareScores.set(dominantMood, (shareScores.get(dominantMood) ?? 0) + weight);
    const energyEntry = energyTotals.get(dominantMood) ?? { total: 0, count: 0 };
    energyEntry.total += feature.energy * 100 * weight;
    energyEntry.count += weight;
    energyTotals.set(dominantMood, energyEntry);
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

    const mood = getDominantMood(feature);
    const period = getDayPeriod(new Date(item.played_at));
    const key = `${period}::${mood}`;
    rawHeatmap.set(key, (rawHeatmap.get(key) ?? 0) + minutesFromMs(item.track.duration_ms));
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
      period: getDayPeriod(new Date(item.played_at)),
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
): Promise<DashboardInsights> {
  const metadataSnapshots = accessToken ? await enrichSnapshotsWithArtistMetadata(snapshots, accessToken) : snapshots;
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
    const [recentArtists, fallbackTopArtists] = await Promise.all([
      fetchArtistsByIds(accessToken, recentArtistIds),
      fetchTopArtistsMetadata(accessToken),
    ]);
    const mergedGenreArtists = mergeArtists(topArtists, recentArtists, fallbackTopArtists);
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
    } else {
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

    const [audioFeatureResponse, livePlaylistInsights] = await Promise.all([
      audioFeatureTrackIds.length > 0
        ? spotifyFetchOptional<SpotifyAudioFeaturesResponse>(`/audio-features?ids=${audioFeatureTrackIds.join(",")}`, accessToken)
        : Promise.resolve(null),
      spotifyUserId ? getAllPlaylistInsights(accessToken, spotifyUserId, "last_listened_desc").then((items) => items.slice(0, 3)).catch(() => null) : Promise.resolve(null),
    ]);

    const features = audioFeatureResponse?.audio_features.filter((feature): feature is SpotifyAudioFeature => Boolean(feature)) ?? [];
    moodResult = deriveMoodAnalytics(features, recent, topTracks, longTermTopTracks, topArtists);

    if (livePlaylistInsights && livePlaylistInsights.length > 0) {
      playlistInsights = livePlaylistInsights;
    }
  }

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
    const db = await getDatabase({ forceRetry: true });
    if (!db) {
      return [] as SpotifyDashboardSnapshot[];
    }

    const snapshots = await db
      .collection<SpotifyDashboardSnapshot>(SNAPSHOT_HISTORY_COLLECTION)
      .find({ spotifyUserId })
      .sort({ fetchedAt: -1 })
      .limit(range === "all" ? 180 : 90)
      .toArray();

    const filteredSnapshots = filterSnapshotsForDashboardRange(snapshots, range);
    return filteredSnapshots.length > 0 ? filteredSnapshots : snapshots.slice(0, 1);
  } catch {
    return [] as SpotifyDashboardSnapshot[];
  }
}

async function getLatestSnapshot(spotifyUserId: string) {
  if (!hasMongoConfig()) {
    return null;
  }

  try {
    const db = await getDatabase({ forceRetry: true });
    if (!db) {
      return null;
    }

    return db.collection<SpotifyDashboardSnapshot>(SNAPSHOT_HISTORY_COLLECTION).find({ spotifyUserId }).sort({ fetchedAt: -1 }).limit(1).next();
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
    recent: recent.items,
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
  options: { section: "trend" | "heatmap"; label?: string; mood?: string; period?: string },
): Promise<DashboardAnalysisDetail> {
  const snapshots = await ensureSnapshotsForRange(accessToken, spotifyUserId, range);
  const sortedSnapshots = [...snapshots].sort((a, b) => new Date(b.fetchedAt).getTime() - new Date(a.fetchedAt).getTime());
  const recent = dedupeRecent(sortedSnapshots.flatMap((snapshot) => snapshot.recent));

  const audioFeatureTrackIds = [...new Set(recent.map((item) => item.track.id))].slice(0, 100);
  const audioFeatureResponse = audioFeatureTrackIds.length > 0
    ? await spotifyFetchOptional<SpotifyAudioFeaturesResponse>(`/audio-features?ids=${audioFeatureTrackIds.join(",")}`, accessToken)
    : null;
  const features = audioFeatureResponse?.audio_features.filter((feature): feature is SpotifyAudioFeature => Boolean(feature)) ?? [];
  const recentMoodMeta = buildRecentMoodMeta(recent, features);

  if (options.section === "trend") {
    const buckets = buildTrendBuckets(range);
    const targetBucket = buckets.find((bucket) => bucket.label === options.label) ?? buckets[0];
    const entries = recentMoodMeta
      .filter((meta) => getTrendBucketKeyForPlay(meta.item.played_at, range) === targetBucket.key)
      .map(toAnalysisEntry);

    return {
      section: "trend",
      title: `${targetBucket.label} listening sessions`,
      subtitle: `Tracks played during the ${range} trend bucket shown on your dashboard.`,
      range,
      entries,
    };
  }

  const targetPeriod = (options.period && heatmapPeriods.includes(options.period as (typeof heatmapPeriods)[number])
    ? options.period
    : heatmapPeriods[0]) as (typeof heatmapPeriods)[number];
  const targetMood = (options.mood && moodOrder.includes(options.mood as (typeof moodOrder)[number])
    ? options.mood
    : moodOrder[0]) as (typeof moodOrder)[number];

  let filtered = recentMoodMeta.filter((meta) => meta.period === targetPeriod && meta.mood === targetMood);
  let subtitle = `Recent ${targetMood.toLowerCase()} sessions during ${targetPeriod.toLowerCase()}.`;

  if (filtered.length === 0) {
    filtered = recentMoodMeta.filter((meta) => meta.period === targetPeriod);
    subtitle = `Audio-feature mood matches were unavailable here, so this shows all ${targetPeriod.toLowerCase()} sessions instead.`;
  }

  return {
    section: "heatmap",
    title: `${targetMood} x ${targetPeriod}`,
    subtitle,
    range,
    entries: filtered.map(toAnalysisEntry),
  };
}


export async function getSharedDashboardCacheSnapshots(spotifyUserId: string) {
  let latestSnapshot;
  try {
    latestSnapshot = await getLatestSnapshot(spotifyUserId);
  } catch (error) {
    throw dashboardCacheError("getLatestSnapshot", error);
  }

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
}

export async function getDashboardInsightsFromSnapshots(snapshots: SpotifyDashboardSnapshot[], range: DashboardRange, accessToken?: string, spotifyUserId?: string) {
  const scopedSnapshots = filterSnapshotsForDashboardRange(snapshots, range);
  const relevantSnapshots = scopedSnapshots.length > 0 ? scopedSnapshots : snapshots.slice(0, 1);
  const historicalSnapshots = downsampleSnapshotsForDashboardRange(relevantSnapshots, range);

  if (historicalSnapshots.length === 0) {
    return null;
  }

  return deriveInsights(historicalSnapshots, range, accessToken, spotifyUserId);
}

export async function getDashboardInsightsFromHistory(spotifyUserId: string, range: DashboardRange, accessToken?: string) {
  const snapshots = await getSharedDashboardCacheSnapshots(spotifyUserId);
  return getDashboardInsightsFromSnapshots(snapshots, range, accessToken, spotifyUserId);
}









