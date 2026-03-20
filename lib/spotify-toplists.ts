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

const TOP_LIST_LIMIT = 15;

function deriveAlbums(tracks: TopListTrack[]): TopListAlbum[] {
  const albumMap = new Map<string, Omit<TopListAlbum, "rank">>();

  tracks.forEach((track) => {
    const key = `${track.album}::${track.artist}`.toLowerCase();
    const weight = TOP_LIST_LIMIT - track.rank + 1;
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
    .slice(0, 10)
    .map((album, index) => ({
      ...album,
      rank: index + 1,
    }));
}

function toArtistList(items: SpotifyArtist[]): TopListArtist[] {
  return items.slice(0, TOP_LIST_LIMIT).map((artist, index) => ({
    id: artist.id,
    rank: index + 1,
    name: artist.name,
    genres: artist.genres,
    imageUrl: artist.images?.[0]?.url,
  }));
}

function toTrackList(items: SpotifyTopTracksResponse["items"]): TopListTrack[] {
  return items.slice(0, TOP_LIST_LIMIT).map((track, index) => ({
    id: track.id,
    rank: index + 1,
    title: track.name,
    artist: track.artists.map((artist) => artist.name).join(", "),
    album: track.album.name,
    popularity: track.popularity,
    imageUrl: track.album.images?.[0]?.url,
  }));
}

export async function getSpotifyTopLists(accessToken: string, range: SpotifyTimeRange): Promise<TopListsData> {
  const [artistsResponse, tracksResponse] = await Promise.all([
    spotifyFetch<SpotifyTopArtistsResponse>(`/me/top/artists?time_range=${range}&limit=${TOP_LIST_LIMIT}`, accessToken),
    spotifyFetch<SpotifyTopTracksResponse>(`/me/top/tracks?time_range=${range}&limit=${TOP_LIST_LIMIT}`, accessToken),
  ]);

  const artists = toArtistList(artistsResponse.items);
  const tracks = toTrackList(tracksResponse.items);
  const albums = deriveAlbums(tracks);

  return {
    range,
    artists,
    tracks,
    albums,
    sourceLabel: "Live Spotify top items",
    generatedAt: new Date().toISOString(),
  };
}