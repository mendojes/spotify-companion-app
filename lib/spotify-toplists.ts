import { spotifyFetch } from "@/lib/spotify";
import {
  SpotifyArtist,
  SpotifyTimeRange,
  SpotifyTopArtistsResponse,
  SpotifyTopTracksResponse,
  TopListAlbum,
  TopListArtist,
  TopListTrack,
  TopListsData,
} from "@/lib/types";

export const DASHBOARD_TOP_LIST_LIMIT = 5;
export const FULL_TOP_LIST_LIMIT = 50;

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
    genres: artist.genres,
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

export async function getSpotifyTopLists(
  accessToken: string,
  range: SpotifyTimeRange,
  limit = DASHBOARD_TOP_LIST_LIMIT,
): Promise<TopListsData> {
  const boundedLimit = Math.max(1, Math.min(FULL_TOP_LIST_LIMIT, limit));

  const [artistsResponse, tracksResponse] = await Promise.all([
    spotifyFetch<SpotifyTopArtistsResponse>(`/me/top/artists?time_range=${range}&limit=${boundedLimit}`, accessToken),
    spotifyFetch<SpotifyTopTracksResponse>(`/me/top/tracks?time_range=${range}&limit=${boundedLimit}`, accessToken),
  ]);

  const artists = toArtistList(artistsResponse.items, boundedLimit);
  const tracks = toTrackList(tracksResponse.items, boundedLimit);
  const albums = deriveAlbums(tracks, boundedLimit);

  return {
    range,
    artists,
    tracks,
    albums,
    sourceLabel: "Live Spotify top items",
    generatedAt: new Date().toISOString(),
  };
}
