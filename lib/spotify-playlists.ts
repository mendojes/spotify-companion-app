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
const PLAYLIST_TRACK_LIMIT = 100;
const DASHBOARD_PLAYLIST_COUNT = 3;
const PLAYLIST_ANALYSIS_CONCURRENCY = 3;
const PLAYLIST_INSIGHTS_TTL_MS = 1000 * 60 * 5;
const PLAYLIST_RECENT_SYNC_TTL_MS = 1000 * 60 * 5;
const PLAYLIST_INSIGHTS_COLLECTION = "spotify_playlist_insights";
const PLAYLIST_DETAIL_CACHE_COLLECTION = "spotify_playlist_detail_cache";
const PLAYLIST_LIBRARY_COLLECTION = "spotify_playlist_library";
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

type StoredPlaylistLibraryItem = SpotifyPlaylist & {
  spotifyUserId: string;
  updatedAt: string;
};

export type PlaylistLibraryStatus = {
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

function isPlaylistDetailIncomplete(detail: PlaylistDetail | CachedPlaylistDetail) {
  return detail.trackCount <= 0 || detail.mood.toLowerCase().includes("analysis pending");
}
function normalizePlaylist(playlist: Partial<SpotifyPlaylist> | null | undefined): SpotifyPlaylist | null {
  if (!playlist?.id || !playlist.name) {
    return null;
  }

  return {
    id: playlist.id,
    name: playlist.name,
    images: Array.isArray(playlist.images) ? playlist.images.filter((image) => Boolean(image?.url)) : undefined,
    tracks: {
      total: typeof playlist.tracks?.total === "number" ? playlist.tracks.total : 0,
      href: playlist.tracks?.href,
    },
    owner: playlist.owner?.display_name ? { display_name: playlist.owner.display_name } : undefined,
  };
}

async function getStoredPlaylistLibrary(spotifyUserId: string) {
  if (!hasMongoConfig()) {
    return [] as SpotifyPlaylist[];
  }

  try {
    const db = await getDatabase();
    if (!db) {
      return [] as SpotifyPlaylist[];
    }

    const records = await db
      .collection<StoredPlaylistLibraryItem>(PLAYLIST_LIBRARY_COLLECTION)
      .find({ spotifyUserId })
      .sort({ updatedAt: -1, name: 1 })
      .project({ spotifyUserId: 0, updatedAt: 0 })
      .toArray();

    return records
      .map((playlist) => normalizePlaylist(playlist))
      .filter((playlist): playlist is SpotifyPlaylist => Boolean(playlist));
  } catch {
    return [] as SpotifyPlaylist[];
  }
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

export async function getDashboardPlaylistInsights(spotifyUserId: string): Promise<PlaylistInsight[]> {
  const [storedInsights, recentPlays] = await Promise.all([
    getStoredPlaylistInsights(spotifyUserId),
    getStoredRecentPlays(spotifyUserId).catch(() => [] as StoredRecentPlay[]),
  ]);

  const { playlistInsights, changed } = reorderPlaylistInsightsFromRecentPlay(storedInsights, recentPlays);

  if (changed && playlistInsights.length > 0) {
    await writeStoredPlaylistInsights(spotifyUserId, playlistInsights);
  }

  return playlistInsights;
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

function buildTopTracks(tracks: SpotifyTrack[]): PlaylistTrackSummary[] {
  return uniqueById(tracks)
    .sort((a, b) => b.popularity - a.popularity)
    .slice(0, 8)
    .map((track) => ({
      id: track.id,
      title: track.name,
      artist: track.artists.map((artist) => artist.name).join(", "),
      album: track.album.name,
      imageUrl: track.album.images?.[0]?.url,
    }));
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

        const topGenres = buildGenreSummary(artists);

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
      listeningCadence: getPlaylistListeningCadence(playlist.id, recentPlays),
      createdAt: deriveCreatedAt(trackItems),
      lastListenedAt: deriveLastListenedAt(playlist.id, recentPlays),
      topGenres,
      topArtists: buildArtistSummary(tracks),
      repeatedTracks: buildRepeatedTracks(tracks),
      sampleTracks: buildSampleTracks(tracks),
      topTracks: buildTopTracks(tracks),
      listenTimeline: buildListenTimeline(playlist.id, recentPlays),
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
  const [storedLastGood, recentPlays, currentPlaybackSource, storedLibrary, cachedDetails] = await Promise.all([
    getStoredPlaylistInsights(spotifyUserId),
    getRecentHistory(accessToken, spotifyUserId),
    getCurrentPlaybackSource(accessToken).catch(() => undefined),
    getStoredPlaylistLibrary(spotifyUserId),
    getCachedPlaylistDetails(spotifyUserId),
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
    const [playlists, recentPlays, storedLastGood, currentPlaybackSource, storedPlaylists] = await Promise.all([
      getPlaylistLibrary(accessToken, spotifyUserId),
      getRecentHistory(accessToken, spotifyUserId),
      getStoredPlaylistInsights(spotifyUserId),
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
      return storedLastGood;
    }

    const cachedDetails = await getCachedPlaylistDetails(spotifyUserId, mergedPlaylists.map((playlist) => playlist.id));
    const cachedDetailMap = new Map(cachedDetails.map((detail) => [detail.id, detail]));
    const missingPlaylists = mergedPlaylists.filter((playlist) => {
      const cached = cachedDetailMap.get(playlist.id);
      return !cached || isPlaylistDetailIncomplete(cached);
    }).slice(0, PLAYLIST_DETAIL_REFRESH_LIMIT);

    const freshDetails = missingPlaylists.length > 0
      ? await analyzeManyPlaylists(accessToken, missingPlaylists, recentPlays)
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

export async function getPlaylistDetailFromHistory(spotifyUserId: string, playlistId: string): Promise<PlaylistDetail | null> {
  const [storedLibrary, cachedDetails, recentPlays] = await Promise.all([
    getStoredPlaylistLibrary(spotifyUserId).catch(() => [] as SpotifyPlaylist[]),
    getCachedPlaylistDetails(spotifyUserId, [playlistId]).catch(() => [] as CachedPlaylistDetail[]),
    getStoredRecentPlays(spotifyUserId).catch(() => [] as StoredRecentPlay[]),
  ]);

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

export async function getPlaylistDetail(accessToken: string, spotifyUserId: string, playlistId: string): Promise<PlaylistDetail | null> {
  const [storedLibrary, cachedDetails, recentPlays] = await Promise.all([
    getStoredPlaylistLibrary(spotifyUserId),
    getCachedPlaylistDetails(spotifyUserId, [playlistId]),
    getRecentHistory(accessToken, spotifyUserId),
  ]);

  try {
    const playlist = await fetchPlaylistById(accessToken, playlistId);
    await upsertStoredPlaylist(spotifyUserId, playlist);
    const detail = await analyzePlaylist(accessToken, playlist, recentPlays);

    if (detail) {
      await writeCachedPlaylistDetails(spotifyUserId, [detail]);
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

export function invalidatePlaylistInsightsCache(spotifyUserId: string) {
  invalidateCachedValue(`playlist-insights:${spotifyUserId}`);
  invalidateCachedValue(`playlist-recent-sync:${spotifyUserId}`);
}

export async function getCachedPlaylistInsights(accessToken: string, spotifyUserId: string): Promise<PlaylistInsight[]> {
  return getCachedValue(`playlist-insights:${spotifyUserId}`, PLAYLIST_INSIGHTS_TTL_MS, () =>
    getPlaylistInsights(accessToken, spotifyUserId),
  );
}








