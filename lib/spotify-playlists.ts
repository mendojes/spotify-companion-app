import { getCurrentPlaybackSource, getStoredRecentPlays, syncRecentPlays } from "@/lib/spotify-activity";
import { spotifyFetch } from "@/lib/spotify";
import { getDatabase, hasMongoConfig } from "@/lib/mongodb";
import { getCachedValue, invalidateCachedValue } from "@/lib/runtime-cache";
import {
  PlaylistArtistSummary,
  PlaylistDetail,
  PlaylistGenreSummary,
  PlaylistInsight,
  PlaylistSortOption,
  PlaylistTrackSummary,
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

const PLAYLIST_PAGE_LIMIT = 20;
const PLAYLIST_TRACK_LIMIT = 100;
const DASHBOARD_PLAYLIST_COUNT = 3;
const PLAYLIST_ANALYSIS_CONCURRENCY = 3;
const PLAYLIST_INSIGHTS_TTL_MS = 1000 * 60 * 5;
const PLAYLIST_RECENT_SYNC_TTL_MS = 1000 * 60 * 5;
const PLAYLIST_INSIGHTS_COLLECTION = "spotify_playlist_insights";
const PLAYLIST_DETAIL_CACHE_COLLECTION = "spotify_playlist_detail_cache";
const PLAYLIST_DETAIL_REFRESH_LIMIT = 6;

const lastGoodPlaylistInsights = new Map<string, PlaylistInsight[]>();

type PlaylistTrackWithMeta = {
  addedAt?: string;
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
    trackCount: playlist.tracks.total,
    mood: "Analysis pending",
    diversity: "Playlist cached, deeper analysis loading",
    overlap: "Open the playlist after more syncs",
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

async function fetchPlaylistsPage(accessToken: string, offset = 0) {
  return spotifyFetch<SpotifyPlaylistsResponse>(`/me/playlists?limit=${PLAYLIST_PAGE_LIMIT}&offset=${offset}`, accessToken);
}

async function fetchPlaylistById(accessToken: string, playlistId: string) {
  return spotifyFetch<SpotifyPlaylist>(`/playlists/${playlistId}`, accessToken);
}

async function fetchAllPlaylists(accessToken: string) {
  const playlists: SpotifyPlaylist[] = [];
  let offset = 0;

  while (true) {
    const page = await fetchPlaylistsPage(accessToken, offset);
    playlists.push(...page.items.filter((playlist) => playlist.tracks.total > 0));

    if (!page.next || page.items.length === 0) {
      break;
    }

    offset += page.items.length;
  }

  return uniqueById(playlists);
}

async function fetchPlaylistTrackItems(accessToken: string, playlistId: string) {
  const tracks: PlaylistTrackWithMeta[] = [];
  let offset = 0;

  while (tracks.length < PLAYLIST_TRACK_LIMIT) {
    const response = await spotifyFetch<SpotifyPlaylistTracksResponse>(
      `/playlists/${playlistId}/tracks?limit=100&offset=${offset}`,
      accessToken,
    );

    const pageTracks = response.items
      .map((item: SpotifyPlaylistTrackItem): PlaylistTrackWithMeta | null => {
        if (!item.track) {
          return null;
        }

        return {
          addedAt: item.added_at,
          track: item.track,
        };
      })
      .filter((item): item is PlaylistTrackWithMeta => item !== null);

    tracks.push(...pageTracks);

    if (!response.next || response.items.length === 0) {
      break;
    }

    offset += response.items.length;
  }

  return tracks.slice(0, PLAYLIST_TRACK_LIMIT);
}

async function fetchArtists(accessToken: string, artistIds: string[]) {
  const uniqueArtistIds = [...new Set(artistIds)].slice(0, 50);

  if (uniqueArtistIds.length === 0) {
    return [] as SpotifyArtist[];
  }

  const response = await spotifyFetch<{ artists: SpotifyArtist[] }>(`/artists?ids=${uniqueArtistIds.join(",")}`, accessToken);
  return response.artists;
}

async function fetchAudioFeatures(accessToken: string, tracks: SpotifyTrack[]) {
  const trackIds = uniqueById(tracks).map((track) => track.id).slice(0, 50);

  if (trackIds.length === 0) {
    return [] as SpotifyAudioFeature[];
  }

  try {
    const response = await spotifyFetch<SpotifyAudioFeaturesResponse>(`/audio-features?ids=${trackIds.join(",")}`, accessToken);
    return response.audio_features.filter((feature): feature is SpotifyAudioFeature => Boolean(feature));
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
    artistCounts.set(primaryArtist, (artistCounts.get(primaryArtist) ?? 0) + 1);
    albumCounts.set(track.album.name, (albumCounts.get(track.album.name) ?? 0) + 1);
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
): Promise<PlaylistDetail | null> {
  try {
    const trackItems = await fetchPlaylistTrackItems(accessToken, playlist.id);
    if (trackItems.length === 0) return null;

    const tracks = trackItems.map((item) => item.track);
    const artistIds = tracks.flatMap((track) => track.artists.map((artist) => artist.id).filter(Boolean)) as string[];
    const [artists, features] = await Promise.all([
      fetchArtists(accessToken, artistIds).catch(() => [] as SpotifyArtist[]),
      fetchAudioFeatures(accessToken, tracks).catch(() => [] as SpotifyAudioFeature[]),
    ]);

    const uniqueArtists = new Set(tracks.flatMap((track) => track.artists.map((artist) => artist.name)));
    const uniqueAlbums = new Set(tracks.map((track) => track.album.name));

    return {
      id: playlist.id,
      name: playlist.name,
      imageUrl: playlist.images?.[0]?.url ?? tracks[0]?.album.images?.[0]?.url,
      ownerName: playlist.owner?.display_name,
      trackCount: tracks.length,
      uniqueArtistCount: uniqueArtists.size,
      uniqueAlbumCount: uniqueAlbums.size,
      mood: getDominantMood(features) ?? getFallbackMood(tracks),
      diversity: getGenreDiversity(artists, tracks.length),
      overlap: getRedundancy(tracks),
      createdAt: deriveCreatedAt(trackItems),
      lastListenedAt: deriveLastListenedAt(playlist.id, recentPlays),
      topGenres: buildGenreSummary(artists),
      topArtists: buildArtistSummary(tracks),
      repeatedTracks: buildRepeatedTracks(tracks),
      sampleTracks: buildSampleTracks(tracks),
    };
  } catch {
    return null;
  }
}

async function analyzeManyPlaylists(
  accessToken: string,
  playlists: SpotifyPlaylist[],
  recentPlays: StoredRecentPlay[] = [],
) {
  const results: PlaylistDetail[] = [];

  for (let index = 0; index < playlists.length; index += PLAYLIST_ANALYSIS_CONCURRENCY) {
    const batch = playlists.slice(index, index + PLAYLIST_ANALYSIS_CONCURRENCY);
    const batchResults = await Promise.all(batch.map((playlist) => analyzePlaylist(accessToken, playlist, recentPlays)));
    results.push(...batchResults.filter((detail): detail is PlaylistDetail => Boolean(detail)));
  }

  return results;
}

function toInsight(detail: PlaylistDetail): PlaylistInsight {
  return {
    id: detail.id,
    name: detail.name,
    mood: detail.mood,
    diversity: detail.diversity,
    overlap: detail.overlap,
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

export async function getPlaylistInsights(accessToken: string, spotifyUserId: string): Promise<PlaylistInsight[]> {
  const inMemoryLastGood = lastGoodPlaylistInsights.get(spotifyUserId) ?? [];
  const [storedLastGood, recentPlays, currentPlaybackSource] = await Promise.all([
    getStoredPlaylistInsights(spotifyUserId),
    getRecentHistory(accessToken, spotifyUserId),
    getCurrentPlaybackSource(accessToken).catch(() => undefined),
  ]);

  const lastGood = inMemoryLastGood.length > 0 ? inMemoryLastGood : storedLastGood;
  const currentPlaylistId = currentPlaybackSource?.type === "playlist" ? currentPlaybackSource.playlistId : undefined;
  const candidateIds = getRecentPlaylistCandidates(
    recentPlays,
    currentPlaylistId,
    lastGood.map((playlist) => playlist.id).filter((id): id is string => Boolean(id)),
  );

  if (candidateIds.length === 0) {
    return lastGood;
  }

  const playlists = await Promise.all(
    candidateIds.map(async (playlistId) => {
      try {
        return await fetchPlaylistById(accessToken, playlistId);
      } catch {
        return null;
      }
    }),
  );

  const details = await analyzeManyPlaylists(
    accessToken,
    playlists.filter((playlist): playlist is SpotifyPlaylist => Boolean(playlist)),
    recentPlays,
  );

  const currentPlaybackTimestamp = currentPlaylistId ? new Date().toISOString() : undefined;

  const nextInsights = sortPlaylistInsights(
    uniqueById(details)
      .map((detail) => {
        const insight = toInsight(detail);

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
      .filter((playlist) => Boolean(playlist.lastListenedAt)),
    "last_listened_desc",
  ).slice(0, DASHBOARD_PLAYLIST_COUNT);

  if (nextInsights.length > 0) {
    lastGoodPlaylistInsights.set(spotifyUserId, nextInsights);
    await writeStoredPlaylistInsights(spotifyUserId, nextInsights);
    return nextInsights;
  }

  return lastGood;
}

export async function getAllPlaylistInsights(
  accessToken: string,
  spotifyUserId: string,
  sort: PlaylistSortOption = "created_desc",
): Promise<PlaylistInsight[]> {
  const [playlists, recentPlays] = await Promise.all([
    fetchAllPlaylists(accessToken),
    getRecentHistory(accessToken, spotifyUserId),
  ]);

  const details = await analyzeManyPlaylists(accessToken, playlists, recentPlays);
  return sortPlaylistInsights(uniqueById(details).map(toInsight), sort);
}

export async function getPlaylistDetail(accessToken: string, spotifyUserId: string, playlistId: string): Promise<PlaylistDetail | null> {
  try {
    const [playlist, recentPlays] = await Promise.all([
      fetchPlaylistById(accessToken, playlistId),
      getRecentHistory(accessToken, spotifyUserId),
    ]);

    return analyzePlaylist(accessToken, playlist, recentPlays);
  } catch {
    return null;
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







