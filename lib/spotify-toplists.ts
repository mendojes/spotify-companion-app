import { getDatabase, hasMongoConfig } from "@/lib/mongodb";
import { spotifyFetch } from "@/lib/spotify";
import {
  SpotifyArtist,
  SpotifyDashboardSnapshot,
  SpotifyTimeRange,
  SpotifyTopArtistsResponse,
  SpotifyTopTracksResponse,
  TopListAlbum,
  TopListArtist,
  TopListRange,
  TopListTrack,
  TopListsData,
} from "@/lib/types";

export const DASHBOARD_TOP_LIST_LIMIT = 5;
export const FULL_TOP_LIST_LIMIT = 50;
const SNAPSHOT_HISTORY_COLLECTION = "spotify_snapshots_history";

type SnapshotListPair = {
  artists: SpotifyArtist[];
  tracks: SpotifyTopTracksResponse["items"];
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

function deriveAlbums(tracks: TopListTrack[], limit: number): TopListAlbum[] {
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

function aggregateArtists(snapshots: SpotifyDashboardSnapshot[], range: TopListRange, limit: number, from?: string, to?: string): TopListArtist[] {
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

function aggregateTracks(snapshots: SpotifyDashboardSnapshot[], range: TopListRange, limit: number, from?: string, to?: string): TopListTrack[] {
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

async function getHistoricalSnapshots(spotifyUserId: string, range: TopListRange, from?: string, to?: string) {
  if (!hasMongoConfig()) {
    return [] as SpotifyDashboardSnapshot[];
  }

  try {
    const db = await getDatabase();
    if (!db) {
      return [] as SpotifyDashboardSnapshot[];
    }

    const window = getWindow(range, from, to);
    const fetchedAt: { $gte?: string; $lte?: string } = {};

    if (window.from) {
      fetchedAt.$gte = window.from;
    }

    if (window.to) {
      fetchedAt.$lte = window.to;
    }

    const query = Object.keys(fetchedAt).length > 0 ? { spotifyUserId, fetchedAt } : { spotifyUserId };

    return db
      .collection<SpotifyDashboardSnapshot>(SNAPSHOT_HISTORY_COLLECTION)
      .find(query)
      .sort({ fetchedAt: -1 })
      .limit(range === "all" || range === "year" ? 365 : 180)
      .toArray();
  } catch {
    return [] as SpotifyDashboardSnapshot[];
  }
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
  const albums = deriveAlbums(tracks, boundedLimit);

  return {
    range,
    artists,
    tracks,
    albums,
    sourceLabel: "Spotify affinity fallback",
    generatedAt: new Date().toISOString(),
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

  if (snapshots.length === 0) {
    const fallback = await getFallbackSpotifyTopLists(accessToken, range, boundedLimit);
    return {
      ...fallback,
      from,
      to,
    };
  }

  const artists = aggregateArtists(snapshots, range, boundedLimit, from, to);
  const tracks = aggregateTracks(snapshots, range, boundedLimit, from, to);
  const albums = deriveAlbums(tracks, boundedLimit);

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

export async function getSpotifyTopListsFromHistory(
  spotifyUserId: string,
  range: TopListRange,
  limit = DASHBOARD_TOP_LIST_LIMIT,
  from?: string,
  to?: string,
) {
  const boundedLimit = Math.max(1, Math.min(FULL_TOP_LIST_LIMIT, limit));
  const snapshots = await getHistoricalSnapshots(spotifyUserId, range, from, to);

  if (snapshots.length === 0) {
    return null;
  }

  const artists = aggregateArtists(snapshots, range, boundedLimit, from, to);
  const tracks = aggregateTracks(snapshots, range, boundedLimit, from, to);
  const albums = deriveAlbums(tracks, boundedLimit);

  return {
    range,
    artists,
    tracks,
    albums,
    sourceLabel: snapshots.length > 1 ? "Shared SoundScope history" : "Latest public SoundScope snapshot",
    generatedAt: snapshots[0]?.fetchedAt ?? new Date().toISOString(),
    from,
    to,
  } satisfies TopListsData;
}
