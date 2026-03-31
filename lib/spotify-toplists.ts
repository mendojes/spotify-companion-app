import { getDatabase, hasMongoConfig } from "@/lib/mongodb";
import { spotifyFetch } from "@/lib/spotify";
import {
  SpotifyArtist,
  SpotifyDashboardSnapshot,
  SpotifyTimeRange,
  SpotifyTopArtistsResponse,
  SpotifyTopTracksResponse,
  StoredRecentPlay,
  TopListAlbum,
  TopListArtist,
  TopListRange,
  TopListTrack,
  TopListsData,
} from "@/lib/types";

export const DASHBOARD_TOP_LIST_LIMIT = 5;
export const FULL_TOP_LIST_LIMIT = 50;
const SNAPSHOT_HISTORY_COLLECTION = "spotify_snapshots_history";
const RECENT_PLAYS_COLLECTION = "spotify_recent_plays";
const MIN_RECENT_PLAYS_FOR_TOPS = 5;
const MAX_RECENT_PLAYS_FOR_TOPS = 5000;

type SnapshotListPair = {
  artists: SpotifyArtist[];
  tracks: SpotifyTopTracksResponse["items"];
};

type RecentPlayTopLists = TopListsData & {
  playCount: number;
};

function getArtistGenres(artist: Pick<SpotifyArtist, "genres">) {
  return Array.isArray(artist.genres) ? artist.genres : [];
}

function toIsoDayStart(value: string) {
  return new Date(`${value}T00:00:00.000Z`).toISOString();
}

function toIsoDayEnd(value: string) {
  return new Date(`${value}T23:59:59.999Z`).toISOString();
}

function getWindow(range: TopListRange, from?: string, to?: string) {
  const now = Date.now();

  if (range === "week") {
    return { from: new Date(now - 1000 * 60 * 60 * 24 * 7).toISOString() };
  }

  if (range === "month") {
    return { from: new Date(now - 1000 * 60 * 60 * 24 * 30).toISOString() };
  }

  if (range === "year") {
    return { from: new Date(now - 1000 * 60 * 60 * 24 * 365).toISOString() };
  }

  if (range === "custom" && from && to) {
    return { from: toIsoDayStart(from), to: toIsoDayEnd(to) };
  }

  return {};
}

function filterSnapshotsForTopRange(snapshots: SpotifyDashboardSnapshot[], range: TopListRange, from?: string, to?: string) {
  const window = getWindow(range, from, to);

  return snapshots.filter((snapshot) => {
    if (window.from && snapshot.fetchedAt < window.from) {
      return false;
    }

    if (window.to && snapshot.fetchedAt > window.to) {
      return false;
    }

    return true;
  });
}

function getTopListSnapshotBucketKey(snapshot: SpotifyDashboardSnapshot, range: TopListRange) {
  const date = new Date(snapshot.fetchedAt);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");

  if (range === "all" || range === "year") {
    return `${year}-${month}-${day}`;
  }

  const hour = String(date.getUTCHours()).padStart(2, "0");
  return `${year}-${month}-${day}-${hour}`;
}

function downsampleSnapshotsForTopRange(snapshots: SpotifyDashboardSnapshot[], range: TopListRange) {
  const buckets = new Map<string, SpotifyDashboardSnapshot>();

  snapshots.forEach((snapshot) => {
    const bucketKey = getTopListSnapshotBucketKey(snapshot, range);
    const existing = buckets.get(bucketKey);

    if (!existing || new Date(snapshot.fetchedAt).getTime() > new Date(existing.fetchedAt).getTime()) {
      buckets.set(bucketKey, snapshot);
    }
  });

  return [...buckets.values()].sort((a, b) => new Date(b.fetchedAt).getTime() - new Date(a.fetchedAt).getTime());
}

function getFallbackSpotifyRange(range: TopListRange): SpotifyTimeRange {
  if (range === "week") {
    return "short_term";
  }

  if (range === "month") {
    return "medium_term";
  }

  return "long_term";
}

function getSnapshotListsForRange(snapshot: SpotifyDashboardSnapshot, range: TopListRange, from?: string, to?: string): SnapshotListPair {
  if (range === "week") {
    return {
      artists: snapshot.topArtists,
      tracks: snapshot.topTracks,
    };
  }

  if (range === "month") {
    return {
      artists: snapshot.mediumTermTopArtists ?? snapshot.topArtists,
      tracks: snapshot.mediumTermTopTracks ?? snapshot.topTracks,
    };
  }

  if (range === "year" || range === "all") {
    return {
      artists: snapshot.longTermTopArtists ?? snapshot.mediumTermTopArtists ?? snapshot.topArtists,
      tracks: snapshot.longTermTopTracks ?? snapshot.mediumTermTopTracks ?? snapshot.topTracks,
    };
  }

  if (range === "custom" && from && to) {
    const spanMs = new Date(`${to}T23:59:59.999Z`).getTime() - new Date(`${from}T00:00:00.000Z`).getTime();
    const spanDays = Math.max(1, Math.ceil(spanMs / (1000 * 60 * 60 * 24)));

    if (spanDays <= 14) {
      return {
        artists: snapshot.topArtists,
        tracks: snapshot.topTracks,
      };
    }

    if (spanDays <= 120) {
      return {
        artists: snapshot.mediumTermTopArtists ?? snapshot.topArtists,
        tracks: snapshot.mediumTermTopTracks ?? snapshot.topTracks,
      };
    }

    return {
      artists: snapshot.longTermTopArtists ?? snapshot.mediumTermTopArtists ?? snapshot.topArtists,
      tracks: snapshot.longTermTopTracks ?? snapshot.mediumTermTopTracks ?? snapshot.topTracks,
    };
  }

  return {
    artists: snapshot.mediumTermTopArtists ?? snapshot.topArtists,
    tracks: snapshot.mediumTermTopTracks ?? snapshot.topTracks,
  };
}

function deriveAlbumsFromTracks(tracks: TopListTrack[], limit: number): TopListAlbum[] {
  const albumMap = new Map<string, Omit<TopListAlbum, "rank">>();

  tracks.forEach((track) => {
    const key = `${track.album}::${track.artist}`.toLowerCase();
    const weight = tracks.length - track.rank + 1;
    const existing = albumMap.get(key) ?? {
      id: key,
      name: track.album,
      artist: track.artist,
      trackCount: 0,
      score: 0,
      imageUrl: track.imageUrl,
    };

    existing.trackCount += 1;
    existing.score += weight + Math.round(track.popularity / 10);
    if (!existing.imageUrl && track.imageUrl) {
      existing.imageUrl = track.imageUrl;
    }

    albumMap.set(key, existing);
  });

  return [...albumMap.values()]
    .sort((a, b) => b.score - a.score || b.trackCount - a.trackCount || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((album, index) => ({
      ...album,
      rank: index + 1,
    }));
}

function toArtistList(items: SpotifyArtist[], limit: number): TopListArtist[] {
  return items.slice(0, limit).map((artist, index) => ({
    id: artist.id,
    rank: index + 1,
    name: artist.name,
    genres: getArtistGenres(artist),
    imageUrl: artist.images?.[0]?.url,
  }));
}

function toTrackList(items: SpotifyTopTracksResponse["items"], limit: number): TopListTrack[] {
  return items.slice(0, limit).map((track, index) => ({
    id: track.id,
    rank: index + 1,
    title: track.name,
    artist: track.artists.map((artist) => artist.name).join(", "),
    album: track.album.name,
    popularity: track.popularity,
    imageUrl: track.album.images?.[0]?.url,
  }));
}

function aggregateArtistsFromSnapshots(snapshots: SpotifyDashboardSnapshot[], range: TopListRange, limit: number, from?: string, to?: string): TopListArtist[] {
  const artistMap = new Map<string, TopListArtist & { score: number }>();

  snapshots.forEach((snapshot) => {
    const artists = getSnapshotListsForRange(snapshot, range, from, to).artists;

    artists.forEach((artist, index) => {
      const existing = artistMap.get(artist.id) ?? {
        id: artist.id,
        rank: 0,
        name: artist.name,
        genres: getArtistGenres(artist),
        imageUrl: artist.images?.[0]?.url,
        score: 0,
      };

      existing.score += Math.max(1, 16 - index);
      existing.genres = [...new Set([...(existing.genres ?? []), ...getArtistGenres(artist)])];
      if (!existing.imageUrl && artist.images?.[0]?.url) {
        existing.imageUrl = artist.images[0].url;
      }

      artistMap.set(artist.id, existing);
    });
  });

  return [...artistMap.values()]
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((artist, index) => ({
      id: artist.id,
      rank: index + 1,
      name: artist.name,
      genres: artist.genres ?? [],
      imageUrl: artist.imageUrl,
    }));
}

function aggregateTracksFromSnapshots(snapshots: SpotifyDashboardSnapshot[], range: TopListRange, limit: number, from?: string, to?: string): TopListTrack[] {
  const trackMap = new Map<string, TopListTrack & { score: number }>();

  snapshots.forEach((snapshot) => {
    const tracks = getSnapshotListsForRange(snapshot, range, from, to).tracks;

    tracks.forEach((track, index) => {
      const existing = trackMap.get(track.id) ?? {
        id: track.id,
        rank: 0,
        title: track.name,
        artist: track.artists.map((artist) => artist.name).join(", "),
        album: track.album.name,
        popularity: track.popularity,
        imageUrl: track.album.images?.[0]?.url,
        score: 0,
      };

      existing.score += Math.max(1, 16 - index);
      existing.popularity = Math.max(existing.popularity, track.popularity);
      if (!existing.imageUrl && track.album.images?.[0]?.url) {
        existing.imageUrl = track.album.images[0].url;
      }

      trackMap.set(track.id, existing);
    });
  });

  return [...trackMap.values()]
    .sort((a, b) => b.score - a.score || b.popularity - a.popularity || a.title.localeCompare(b.title))
    .slice(0, limit)
    .map((track, index) => ({
      id: track.id,
      rank: index + 1,
      title: track.title,
      artist: track.artist,
      album: track.album,
      popularity: track.popularity,
      imageUrl: track.imageUrl,
    }));
}

function buildArtistMetadataFromSnapshots(snapshots: SpotifyDashboardSnapshot[]) {
  const metadata = new Map<string, { genres: string[]; imageUrl?: string }>();

  snapshots.forEach((snapshot) => {
    const artists = [
      ...snapshot.topArtists,
      ...(snapshot.mediumTermTopArtists ?? []),
      ...(snapshot.longTermTopArtists ?? []),
    ];

    artists.forEach((artist) => {
      const key = artist.name.toLowerCase();
      const existing = metadata.get(key) ?? { genres: [], imageUrl: undefined };
      existing.genres = [...new Set([...existing.genres, ...getArtistGenres(artist)])];
      if (!existing.imageUrl && artist.images?.[0]?.url) {
        existing.imageUrl = artist.images[0].url;
      }
      metadata.set(key, existing);
    });
  });

  return metadata;
}
function splitArtistNames(value: string) {
  return value
    .split(",")
    .map((artist) => artist.trim())
    .filter(Boolean);
}

function deriveRecentArtists(recentPlays: StoredRecentPlay[], limit: number, artistMetadata: Map<string, { genres: string[]; imageUrl?: string }>): TopListArtist[] {
  const artistMap = new Map<string, { id: string; name: string; score: number; playCount: number; imageUrl?: string; genres: string[] }>();

  recentPlays.forEach((play, index) => {
    const recencyWeight = Math.max(1, recentPlays.length - index);

    splitArtistNames(play.artistName).forEach((artistName) => {
      const key = artistName.toLowerCase();
      const metadata = artistMetadata.get(key);
      const existing = artistMap.get(key) ?? {
        id: key,
        name: artistName,
        score: 0,
        playCount: 0,
        imageUrl: metadata?.imageUrl,
        genres: metadata?.genres ?? [],
      };

      existing.score += 100 + recencyWeight;
      existing.playCount += 1;
      if (!existing.imageUrl && metadata?.imageUrl) {
        existing.imageUrl = metadata.imageUrl;
      }
      if (existing.genres.length === 0 && metadata?.genres?.length) {
        existing.genres = metadata.genres;
      }
      artistMap.set(key, existing);
    });
  });

  return [...artistMap.values()]
    .sort((a, b) => b.score - a.score || b.playCount - a.playCount || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((artist, index) => ({
      id: artist.id,
      rank: index + 1,
      name: artist.name,
      genres: artist.genres,
      imageUrl: artist.imageUrl,
    }));
}

function deriveRecentTracks(recentPlays: StoredRecentPlay[], limit: number): TopListTrack[] {
  const trackMap = new Map<string, TopListTrack & { score: number; playCount: number; lastPlayedAt: string }>();

  recentPlays.forEach((play, index) => {
    const recencyWeight = Math.max(1, recentPlays.length - index);
    const existing = trackMap.get(play.trackId) ?? {
      id: play.trackId,
      rank: 0,
      title: play.trackName,
      artist: play.artistName,
      album: play.albumName,
      popularity: 0,
      imageUrl: play.imageUrl,
      score: 0,
      playCount: 0,
      lastPlayedAt: play.playedAt,
    };

    existing.score += 100 + recencyWeight;
    existing.playCount += 1;
    existing.popularity = Math.min(100, existing.playCount * 12 + Math.min(40, recencyWeight));
    if (play.playedAt > existing.lastPlayedAt) {
      existing.lastPlayedAt = play.playedAt;
    }
    if (!existing.imageUrl && play.imageUrl) {
      existing.imageUrl = play.imageUrl;
    }

    trackMap.set(play.trackId, existing);
  });

  return [...trackMap.values()]
    .sort((a, b) => b.score - a.score || b.playCount - a.playCount || b.lastPlayedAt.localeCompare(a.lastPlayedAt))
    .slice(0, limit)
    .map((track, index) => ({
      id: track.id,
      rank: index + 1,
      title: track.title,
      artist: track.artist,
      album: track.album,
      popularity: track.popularity,
      imageUrl: track.imageUrl,
    }));
}

function deriveRecentAlbums(recentPlays: StoredRecentPlay[], limit: number): TopListAlbum[] {
  const albumMap = new Map<string, Omit<TopListAlbum, "rank"> & { playCount: number; lastPlayedAt: string }>();

  recentPlays.forEach((play, index) => {
    const recencyWeight = Math.max(1, recentPlays.length - index);
    const key = `${play.albumName}::${play.artistName}`.toLowerCase();
    const existing = albumMap.get(key) ?? {
      id: key,
      name: play.albumName,
      artist: play.artistName,
      trackCount: 0,
      score: 0,
      imageUrl: play.imageUrl,
      playCount: 0,
      lastPlayedAt: play.playedAt,
    };

    existing.score += 100 + recencyWeight;
    existing.playCount += 1;
    existing.trackCount += 1;
    if (play.playedAt > existing.lastPlayedAt) {
      existing.lastPlayedAt = play.playedAt;
    }
    if (!existing.imageUrl && play.imageUrl) {
      existing.imageUrl = play.imageUrl;
    }

    albumMap.set(key, existing);
  });

  return [...albumMap.values()]
    .sort((a, b) => b.score - a.score || b.playCount - a.playCount || b.lastPlayedAt.localeCompare(a.lastPlayedAt))
    .slice(0, limit)
    .map((album, index) => ({
      id: album.id,
      rank: index + 1,
      name: album.name,
      artist: album.artist,
      trackCount: album.trackCount,
      score: album.score,
      imageUrl: album.imageUrl,
    }));
}

async function getHistoricalSnapshots(spotifyUserId: string, range: TopListRange, from?: string, to?: string) {
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
      .limit(range === "all" || range === "year" ? 365 : 180)
      .toArray();

    const filteredSnapshots = filterSnapshotsForTopRange(snapshots, range, from, to);
    return filteredSnapshots.length > 0 ? filteredSnapshots : snapshots.slice(0, 1);
  } catch {
    return [] as SpotifyDashboardSnapshot[];
  }
}

async function getRecentPlaysForTopLists(spotifyUserId: string, range: TopListRange, from?: string, to?: string) {
  if (!hasMongoConfig()) {
    return [] as StoredRecentPlay[];
  }

  try {
    const db = await getDatabase({ forceRetry: true });
    if (!db) {
      return [] as StoredRecentPlay[];
    }

    const window = getWindow(range, from, to);
    const playedAt: { $gte?: string; $lte?: string } = {};

    if (window.from) {
      playedAt.$gte = window.from;
    }

    if (window.to) {
      playedAt.$lte = window.to;
    }

    const query = Object.keys(playedAt).length > 0 ? { spotifyUserId, playedAt } : { spotifyUserId };

    return db
      .collection<StoredRecentPlay>(RECENT_PLAYS_COLLECTION)
      .find(query)
      .sort({ playedAt: -1 })
      .limit(MAX_RECENT_PLAYS_FOR_TOPS)
      .toArray();
  } catch {
    return [] as StoredRecentPlay[];
  }
}

async function getRecentPlayTopLists(spotifyUserId: string, range: TopListRange, limit: number, from?: string, to?: string, snapshots: SpotifyDashboardSnapshot[] = []): Promise<RecentPlayTopLists | null> {
  const recentPlays = await getRecentPlaysForTopLists(spotifyUserId, range, from, to);

  if (recentPlays.length < MIN_RECENT_PLAYS_FOR_TOPS) {
    return null;
  }

  const artists = deriveRecentArtists(recentPlays, limit, buildArtistMetadataFromSnapshots(snapshots));
  const tracks = deriveRecentTracks(recentPlays, limit);
  const albums = deriveRecentAlbums(recentPlays, limit);

  return {
    range,
    artists,
    tracks,
    albums,
    playCount: recentPlays.length,
    sourceLabel: "SoundScope recent-play history",
    generatedAt: recentPlays[0]?.playedAt ?? new Date().toISOString(),
    from,
    to,
  };
}

async function getFallbackSpotifyTopLists(accessToken: string, range: TopListRange, limit: number): Promise<TopListsData> {
  const spotifyRange = getFallbackSpotifyRange(range);
  const boundedLimit = Math.max(1, Math.min(FULL_TOP_LIST_LIMIT, limit));

  const [artistsResponse, tracksResponse] = await Promise.all([
    spotifyFetch<SpotifyTopArtistsResponse>(`/me/top/artists?time_range=${spotifyRange}&limit=${boundedLimit}`, accessToken),
    spotifyFetch<SpotifyTopTracksResponse>(`/me/top/tracks?time_range=${spotifyRange}&limit=${boundedLimit}`, accessToken),
  ]);

  const artists = toArtistList(artistsResponse.items, boundedLimit);
  const tracks = toTrackList(tracksResponse.items, boundedLimit);
  const albums = deriveAlbumsFromTracks(tracks, boundedLimit);

  return {
    range,
    artists,
    tracks,
    albums,
    sourceLabel: "Spotify affinity fallback",
    generatedAt: new Date().toISOString(),
  };
}

export async function getSpotifyTopListsLive(
  accessToken: string,
  range: TopListRange,
  limit = DASHBOARD_TOP_LIST_LIMIT,
  from?: string,
  to?: string,
): Promise<TopListsData> {
  const boundedLimit = Math.max(1, Math.min(FULL_TOP_LIST_LIMIT, limit));
  const fallback = await getFallbackSpotifyTopLists(accessToken, range, boundedLimit);
  return {
    ...fallback,
    from,
    to,
  };
}

export async function getSpotifyTopLists(
  accessToken: string,
  spotifyUserId: string,
  range: TopListRange,
  limit = DASHBOARD_TOP_LIST_LIMIT,
  from?: string,
  to?: string,
): Promise<TopListsData> {
  const boundedLimit = Math.max(1, Math.min(FULL_TOP_LIST_LIMIT, limit));
  const snapshots = await getHistoricalSnapshots(spotifyUserId, range, from, to);
  const recentPlayTopLists = await getRecentPlayTopLists(spotifyUserId, range, boundedLimit, from, to, snapshots);

  if (recentPlayTopLists) {
    const needsArtistMetadata = recentPlayTopLists.artists.some((artist) => !artist.imageUrl || artist.genres.length === 0);

    if (needsArtistMetadata) {
      try {
        const fallback = await getFallbackSpotifyTopLists(accessToken, range, boundedLimit);
        const fallbackArtistMap = new Map(fallback.artists.map((artist) => [artist.name.toLowerCase(), artist]));

        recentPlayTopLists.artists = recentPlayTopLists.artists.map((artist) => {
          const fallbackArtist = fallbackArtistMap.get(artist.name.toLowerCase());
          return {
            ...artist,
            imageUrl: artist.imageUrl ?? fallbackArtist?.imageUrl,
            genres: artist.genres.length > 0 ? artist.genres : (fallbackArtist?.genres ?? []),
          };
        });
      } catch {
        // Keep recent-play rankings even if metadata enrichment fails.
      }
    }

    return recentPlayTopLists;
  }

  if (snapshots.length > 0 && (range === "all" || range === "custom")) {
    const artists = aggregateArtistsFromSnapshots(snapshots, range, boundedLimit, from, to);
    const tracks = aggregateTracksFromSnapshots(snapshots, range, boundedLimit, from, to);
    const albums = deriveAlbumsFromTracks(tracks, boundedLimit);

    return {
      range,
      artists,
      tracks,
      albums,
      sourceLabel: snapshots.length > 1 ? "Historical SoundScope rankings" : "Latest SoundScope snapshot",
      generatedAt: snapshots[0]?.fetchedAt ?? new Date().toISOString(),
      from,
      to,
    };
  }

  const fallback = await getFallbackSpotifyTopLists(accessToken, range, boundedLimit);
  return {
    ...fallback,
    from,
    to,
  };
}

export async function getSpotifyTopListsFromSnapshots(
  snapshots: SpotifyDashboardSnapshot[],
  range: TopListRange,
  limit = DASHBOARD_TOP_LIST_LIMIT,
  from?: string,
  to?: string,
) {
  const boundedLimit = Math.max(1, Math.min(FULL_TOP_LIST_LIMIT, limit));
  const scopedSnapshots = filterSnapshotsForTopRange(snapshots, range, from, to);
  const relevantSnapshots = scopedSnapshots.length > 0 ? scopedSnapshots : snapshots;
  const historicalSnapshots = downsampleSnapshotsForTopRange(relevantSnapshots, range);

  if (historicalSnapshots.length === 0) {
    return null;
  }

  const artists = aggregateArtistsFromSnapshots(historicalSnapshots, range, boundedLimit, from, to);
  const tracks = aggregateTracksFromSnapshots(historicalSnapshots, range, boundedLimit, from, to);
  const albums = deriveAlbumsFromTracks(tracks, boundedLimit);

  return {
    range,
    artists,
    tracks,
    albums,
    sourceLabel: historicalSnapshots.length > 1 ? "Historical Spotify snapshots" : "Latest Spotify snapshot",
    generatedAt: historicalSnapshots[0]?.fetchedAt ?? new Date().toISOString(),
    from,
    to,
  } satisfies TopListsData;
}

export async function getSpotifyTopListsFromHistory(
  spotifyUserId: string,
  range: TopListRange,
  limit = DASHBOARD_TOP_LIST_LIMIT,
  from?: string,
  to?: string,
) {
  const boundedLimit = Math.max(1, Math.min(FULL_TOP_LIST_LIMIT, limit));
  const snapshots = await getHistoricalSnapshots(spotifyUserId, range, from, to);
  const recentPlayTopLists = await getRecentPlayTopLists(spotifyUserId, range, boundedLimit, from, to, snapshots);

  if (recentPlayTopLists) {
    return {
      ...recentPlayTopLists,
      sourceLabel: "Shared SoundScope listening history",
    } satisfies TopListsData;
  }

  return getSpotifyTopListsFromSnapshots(snapshots, range, boundedLimit, from, to);
}









