import { FavoritePickerTargetSummary, FavoritePickerTargetType, FavoritePickerTrack } from "@/lib/favorite-picker";
import { AuthSession, getAuthorizedSession, hasSpotifyConnection } from "@/lib/auth";
import { getSpotifyClientCredentialsToken, spotifyFetch } from "@/lib/spotify";
import { SpotifyPlaylist, SpotifyPlaylistTrackItem, SpotifyPlaylistTracksResponse, SpotifyTrack } from "@/lib/types";

type SpotifyImage = { url: string };

type SpotifyArtistSummary = {
  id: string;
  name: string;
  images?: SpotifyImage[];
  external_urls?: { spotify?: string };
};

type SpotifyAlbumTrack = {
  id: string;
  name: string;
  duration_ms?: number;
  external_urls?: { spotify?: string };
  artists: Array<{ id?: string; name: string }>;
};

type SpotifyAlbum = {
  id: string;
  name: string;
  total_tracks?: number;
  images?: SpotifyImage[];
  artists: Array<{ id?: string; name: string }>;
  external_urls?: { spotify?: string };
  tracks?: {
    items: SpotifyAlbumTrack[];
    next?: string | null;
    total?: number;
    limit?: number;
    offset?: number;
  };
};

type SpotifyArtistAlbumsResponse = {
  items: Array<{
    id: string;
    name: string;
    images?: SpotifyImage[];
    album_group?: string;
    album_type?: string;
    external_urls?: { spotify?: string };
  }>;
  next: string | null;
  limit: number;
  offset: number;
};

type SpotifySearchResponse = {
  artists?: {
    items: Array<SpotifyArtistSummary | null>;
    total?: number;
  };
  albums?: {
    items: Array<SpotifyAlbum | null>;
    total?: number;
  };
  playlists?: {
    items: Array<(SpotifyPlaylist & { external_urls?: { spotify?: string } }) | null>;
    total?: number;
  };
};

type PickerTargetInput = {
  id: string;
  type: FavoritePickerTargetType;
};

export type FavoritePickerSearchType = FavoritePickerTargetType;

export type FavoritePickerSearchResultPage = {
  results: FavoritePickerTargetSummary[];
  page: number;
  total: number;
  totalPages: number;
  type: FavoritePickerSearchType;
};

const SEARCH_TARGET_LIMIT = 8;
const ARTIST_ALBUM_BATCH_SIZE = 4;

function uniqueById<T extends { id: string }>(items: T[]) {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const item of items) {
    if (seen.has(item.id)) {
      continue;
    }

    seen.add(item.id);
    result.push(item);
  }

  return result;
}

function normalizeInput(value: string) {
  return value.trim();
}

function isSearchArtistResult(value: SpotifyArtistSummary | null | undefined): value is SpotifyArtistSummary {
  return Boolean(value?.id && value?.name);
}

function isSearchAlbumResult(value: SpotifyAlbum | null | undefined): value is SpotifyAlbum {
  return Boolean(value?.id && value?.name && Array.isArray(value.artists));
}

function isSearchPlaylistResult(
  value: (SpotifyPlaylist & { external_urls?: { spotify?: string } }) | null | undefined,
): value is SpotifyPlaylist & { external_urls?: { spotify?: string } } {
  return Boolean(value?.id && value?.name);
}

function getTrackDedupKey(track: SpotifyTrack | SpotifyAlbumTrack) {
  if ("id" in track && track.id) {
    return `spotify:${track.id}`;
  }

  const artistLabel = track.artists.map((artist) => artist.name.trim().toLowerCase()).join(",");
  return `fallback:${track.name.trim().toLowerCase()}::${artistLabel}`;
}

async function getPickerAccessToken(session: AuthSession | null) {
  if (session && hasSpotifyConnection(session)) {
    const authorized = await getAuthorizedSession(session);
    return authorized.accessToken;
  }

  return getSpotifyClientCredentialsToken();
}

function toTargetSummary(target: {
  id: string;
  type: FavoritePickerTargetType;
  name: string;
  subtitle: string;
  imageUrl?: string;
  spotifyUrl?: string;
  trackCount?: number;
}): FavoritePickerTargetSummary {
  return target;
}

function toFavoritePickerTrack(
  track: SpotifyTrack | SpotifyAlbumTrack,
  sourceTarget: FavoritePickerTargetSummary,
  fallbackImageUrl?: string,
  fallbackAlbumName?: string,
) {
  const artists = track.artists.map((artist) => artist.name);
  const imageUrl = "album" in track ? track.album.images?.[0]?.url ?? fallbackImageUrl : fallbackImageUrl;
  const albumName = "album" in track ? track.album.name : fallbackAlbumName ?? sourceTarget.name;

  return {
    id: getTrackDedupKey(track),
    spotifyId: track.id,
    name: track.name,
    artists,
    artistLabel: artists.join(", "),
    albumName,
    imageUrl,
    spotifyUrl: track.id ? `https://open.spotify.com/track/${track.id}` : undefined,
    sourceTargetIds: [sourceTarget.id],
    sourceLabels: [`${sourceTarget.type}: ${sourceTarget.name}`],
  } satisfies FavoritePickerTrack;
}

function mergeTracks(tracks: FavoritePickerTrack[]) {
  const merged = new Map<string, FavoritePickerTrack>();

  tracks.forEach((track) => {
    const existing = merged.get(track.id);

    if (!existing) {
      merged.set(track.id, track);
      return;
    }

    const sourceTargetIds = [...new Set([...existing.sourceTargetIds, ...track.sourceTargetIds])];
    const sourceLabels = [...new Set([...existing.sourceLabels, ...track.sourceLabels])];

    merged.set(track.id, {
      ...existing,
      spotifyId: existing.spotifyId ?? track.spotifyId,
      imageUrl: existing.imageUrl ?? track.imageUrl,
      spotifyUrl: existing.spotifyUrl ?? track.spotifyUrl,
      sourceTargetIds,
      sourceLabels,
    });
  });

  return [...merged.values()];
}

export function parseFavoritePickerInput(input: string): PickerTargetInput | null {
  const normalized = normalizeInput(input);

  if (!normalized) {
    return null;
  }

  if (normalized.startsWith("spotify:")) {
    const parts = normalized.split(":");
    if (parts.length >= 3) {
      const type = parts[1];
      const id = parts[2];

      if ((type === "playlist" || type === "album" || type === "artist") && id) {
        return { type, id };
      }
    }
  }

  try {
    const url = new URL(normalized);
    const match = url.pathname.match(/^\/(playlist|album|artist)\/([^/?]+)/);

    if (!match) {
      return null;
    }

    return {
      type: match[1] as FavoritePickerTargetType,
      id: match[2],
    };
  } catch {
    return null;
  }
}

async function fetchPlaylist(accessToken: string, playlistId: string) {
  return spotifyFetch<SpotifyPlaylist & { external_urls?: { spotify?: string } }>(
    `/playlists/${playlistId}?fields=id,name,images,external_urls,owner(display_name),tracks(total)`,
    accessToken,
  );
}

async function fetchPlaylistTracks(accessToken: string, playlistId: string) {
  const tracks: SpotifyTrack[] = [];
  let offset = 0;

  while (true) {
    const response = await spotifyFetch<SpotifyPlaylistTracksResponse>(
      `/playlists/${playlistId}/items?limit=100&offset=${offset}`,
      accessToken,
    );

    const pageTracks = response.items
      .map((item: SpotifyPlaylistTrackItem) => item.track ?? item.item)
      .filter((track): track is SpotifyTrack => Boolean(track?.id && track?.name && track?.album?.name && track?.artists?.length));

    tracks.push(...pageTracks);

    if (!response.next || response.items.length === 0) {
      break;
    }

    offset += response.items.length;
  }

  return tracks;
}

async function fetchAlbum(accessToken: string, albumId: string) {
  return spotifyFetch<SpotifyAlbum>(`/albums/${albumId}`, accessToken);
}

async function fetchAlbumTracks(accessToken: string, albumId: string) {
  const firstPage = await spotifyFetch<SpotifyAlbum>(`/albums/${albumId}`, accessToken);
  const tracks = [...(firstPage.tracks?.items ?? [])];
  let offset = firstPage.tracks?.items.length ?? 0;
  const total = firstPage.tracks?.total ?? tracks.length;

  while (offset < total) {
    const page = await spotifyFetch<{ items: SpotifyAlbumTrack[]; next: string | null; total: number }>(
      `/albums/${albumId}/tracks?limit=50&offset=${offset}`,
      accessToken,
    );

    tracks.push(...page.items);
    if (!page.next || page.items.length === 0) {
      break;
    }

    offset += page.items.length;
  }

  return {
    album: firstPage,
    tracks,
  };
}

async function fetchArtist(accessToken: string, artistId: string) {
  return spotifyFetch<SpotifyArtistSummary>(`/artists/${artistId}`, accessToken);
}

async function fetchArtistAlbums(accessToken: string, artistId: string) {
  const albums: SpotifyArtistAlbumsResponse["items"] = [];
  let offset = 0;

  while (true) {
    const response = await spotifyFetch<SpotifyArtistAlbumsResponse>(
      `/artists/${artistId}/albums?include_groups=album,single,compilation&limit=50&offset=${offset}`,
      accessToken,
    );

    albums.push(...response.items);

    if (!response.next || response.items.length === 0) {
      break;
    }

    offset += response.items.length;
  }

  return uniqueById(albums.map((album) => ({ ...album, id: album.id })));
}

async function fetchArtistTracks(accessToken: string, target: FavoritePickerTargetSummary) {
  const artistAlbums = await fetchArtistAlbums(accessToken, target.id);
  const tracks: FavoritePickerTrack[] = [];

  for (let index = 0; index < artistAlbums.length; index += ARTIST_ALBUM_BATCH_SIZE) {
    const batch = artistAlbums.slice(index, index + ARTIST_ALBUM_BATCH_SIZE);
    const albums = await Promise.all(
      batch.map((album) => fetchAlbumTracks(accessToken, album.id).catch(() => null)),
    );

    albums.forEach((result) => {
      if (!result) {
        return;
      }

      result.tracks.forEach((track) => {
        tracks.push(toFavoritePickerTrack(track, target, result.album.images?.[0]?.url, result.album.name));
      });
    });
  }

  return mergeTracks(tracks);
}

export async function getFavoritePickerSearchResults(session: AuthSession | null, query: string) {
  return getFavoritePickerSearchResultsPage(session, query, "playlist", 1);
}

export async function getFavoritePickerSearchResultsPage(
  session: AuthSession | null,
  query: string,
  type: FavoritePickerSearchType,
  page = 1,
): Promise<FavoritePickerSearchResultPage> {
  const normalizedQuery = normalizeInput(query);

  if (!normalizedQuery) {
    return {
      results: [],
      page: 1,
      total: 0,
      totalPages: 0,
      type,
    };
  }

  const accessToken = await getPickerAccessToken(session);
  const safePage = Math.max(1, page);
  const searchParams = new URLSearchParams({
    q: normalizedQuery,
    type,
    limit: String(SEARCH_TARGET_LIMIT),
    offset: String((safePage - 1) * SEARCH_TARGET_LIMIT),
  });

  const response = await spotifyFetch<SpotifySearchResponse>(`/search?${searchParams.toString()}`, accessToken);

  if (type === "artist") {
    const items = (response.artists?.items ?? []).filter(isSearchArtistResult);
    const total = response.artists?.total ?? items.length;

    return {
      results: items.map((artist) => toTargetSummary({
        id: artist.id,
        type: "artist",
        name: artist.name,
        subtitle: "Artist",
        imageUrl: artist.images?.[0]?.url,
        spotifyUrl: artist.external_urls?.spotify,
      })),
      page: safePage,
      total,
      totalPages: Math.max(1, Math.ceil(total / SEARCH_TARGET_LIMIT)),
      type,
    };
  }

  if (type === "album") {
    const items = (response.albums?.items ?? []).filter(isSearchAlbumResult);
    const total = response.albums?.total ?? items.length;

    return {
      results: items.map((album) => toTargetSummary({
        id: album.id,
        type: "album",
        name: album.name,
        subtitle: `Album by ${album.artists.map((artist) => artist.name).join(", ")}`,
        imageUrl: album.images?.[0]?.url,
        spotifyUrl: album.external_urls?.spotify,
        trackCount: album.total_tracks,
      })),
      page: safePage,
      total,
      totalPages: Math.max(1, Math.ceil(total / SEARCH_TARGET_LIMIT)),
      type,
    };
  }

  const items = (response.playlists?.items ?? []).filter(isSearchPlaylistResult);
  const total = response.playlists?.total ?? items.length;

  return {
    results: items.map((playlist) => toTargetSummary({
      id: playlist.id,
      type: "playlist",
      name: playlist.name,
      subtitle: playlist.owner?.display_name ? `Playlist by ${playlist.owner.display_name}` : "Playlist",
      imageUrl: playlist.images?.[0]?.url,
      spotifyUrl: playlist.external_urls?.spotify,
      trackCount: playlist.tracks?.total,
    })),
    page: safePage,
    total,
    totalPages: Math.max(1, Math.ceil(total / SEARCH_TARGET_LIMIT)),
    type,
  };
}

export async function getFavoritePickerPlaylistLibrary(session: AuthSession | null) {
  if (!session || !hasSpotifyConnection(session)) {
    return [] as FavoritePickerTargetSummary[];
  }

  const authorized = await getAuthorizedSession(session);
  const results: FavoritePickerTargetSummary[] = [];
  let offset = 0;

  while (true) {
    const page = await spotifyFetch<{ items: SpotifyPlaylist[]; next: string | null }>(
      `/me/playlists?limit=50&offset=${offset}`,
      authorized.accessToken,
    );

    results.push(...page.items.map((playlist) => toTargetSummary({
      id: playlist.id,
      type: "playlist",
      name: playlist.name,
      subtitle: playlist.owner?.display_name ? `Your library • ${playlist.owner.display_name}` : "Your library",
      imageUrl: playlist.images?.[0]?.url,
      trackCount: playlist.tracks?.total,
      spotifyUrl: `https://open.spotify.com/playlist/${playlist.id}`,
    })));

    if (!page.next || page.items.length === 0) {
      break;
    }

    offset += page.items.length;
  }

  return uniqueById(results);
}

async function resolveSingleTarget(accessToken: string, target: PickerTargetInput) {
  if (target.type === "playlist") {
    const playlist = await fetchPlaylist(accessToken, target.id);
    const summary = toTargetSummary({
      id: playlist.id,
      type: "playlist",
      name: playlist.name,
      subtitle: playlist.owner?.display_name ? `Playlist by ${playlist.owner.display_name}` : "Playlist",
      imageUrl: playlist.images?.[0]?.url,
      spotifyUrl: playlist.external_urls?.spotify ?? `https://open.spotify.com/playlist/${playlist.id}`,
      trackCount: playlist.tracks?.total,
    });
    const playlistTracks = await fetchPlaylistTracks(accessToken, target.id);

    return {
      target: summary,
      tracks: mergeTracks(playlistTracks.map((track) => toFavoritePickerTrack(track, summary))),
    };
  }

  if (target.type === "album") {
    const { album, tracks } = await fetchAlbumTracks(accessToken, target.id);
    const summary = toTargetSummary({
      id: album.id,
      type: "album",
      name: album.name,
      subtitle: `Album by ${album.artists.map((artist) => artist.name).join(", ")}`,
      imageUrl: album.images?.[0]?.url,
      spotifyUrl: album.external_urls?.spotify ?? `https://open.spotify.com/album/${album.id}`,
      trackCount: album.total_tracks ?? tracks.length,
    });

    return {
      target: summary,
      tracks: mergeTracks(tracks.map((track) => toFavoritePickerTrack(track, summary, album.images?.[0]?.url, album.name))),
    };
  }

  const artist = await fetchArtist(accessToken, target.id);
  const artistSummary = toTargetSummary({
    id: artist.id,
    type: "artist",
    name: artist.name,
    subtitle: "Artist discography",
    imageUrl: artist.images?.[0]?.url,
    spotifyUrl: artist.external_urls?.spotify ?? `https://open.spotify.com/artist/${artist.id}`,
  });

  return {
    target: artistSummary,
    tracks: await fetchArtistTracks(accessToken, artistSummary),
  };
}

export async function resolveFavoritePickerTargets(
  session: AuthSession | null,
  inputs: Array<PickerTargetInput | string>,
) {
  const parsedTargets = uniqueById(inputs
    .map((input) => typeof input === "string" ? parseFavoritePickerInput(input) : input)
    .filter((target): target is PickerTargetInput => Boolean(target)));

  if (parsedTargets.length === 0) {
    return {
      targets: [] as FavoritePickerTargetSummary[],
      tracks: [] as FavoritePickerTrack[],
    };
  }

  const accessToken = await getPickerAccessToken(session);
  const results = await Promise.all(parsedTargets.map((target) => resolveSingleTarget(accessToken, target).catch(() => null)));
  const validResults = results.filter((result): result is NonNullable<typeof result> => Boolean(result));

  return {
    targets: validResults.map((result) => result.target),
    tracks: mergeTracks(validResults.flatMap((result) => result.tracks)),
  };
}
