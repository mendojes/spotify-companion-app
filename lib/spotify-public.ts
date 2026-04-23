import { getCachedValue } from "@/lib/runtime-cache";
import { getPublicPlaylistDetail, getPublicPlaylistInsights } from "@/lib/spotify-playlists";
import { getSpotifyClientCredentialsToken, spotifyFetch } from "@/lib/spotify";
import { PlaylistInsight, SpotifyPlaylist, SpotifyPlaylistsResponse } from "@/lib/types";

export type PublicProfileArtist = {
  id: string;
  name: string;
  imageUrl?: string;
  spotifyUrl: string;
};

export type PublicSpotifyProfileInsights = {
  spotifyUserId: string;
  displayName: string;
  imageUrl?: string;
  profileUrl: string;
  publicPlaylistCount: number;
  publicPlaylists: SpotifyPlaylist[];
  playlistInsights: PlaylistInsight[];
  recentArtists: PublicProfileArtist[];
  recentArtistsVisible: boolean;
  fetchedAt: string;
};

type PublicSpotifyUser = {
  id: string;
  display_name?: string | null;
  images?: Array<{ url: string }>;
  external_urls?: {
    spotify?: string;
  };
};

const PUBLIC_PROFILE_TTL_MS = 1000 * 60 * 30;
const PUBLIC_PLAYLIST_LIMIT = 6;
const PUBLIC_PROFILE_CACHE_VERSION = "v2";

async function fetchPublicSpotifyUser(accessToken: string, spotifyUserId: string) {
  return spotifyFetch<PublicSpotifyUser>(`/users/${spotifyUserId}`, accessToken);
}

async function fetchAllPublicPlaylists(accessToken: string, spotifyUserId: string, limit = PUBLIC_PLAYLIST_LIMIT) {
  const playlists: SpotifyPlaylist[] = [];
  let offset = 0;

  while (playlists.length < limit) {
    const response = await spotifyFetch<SpotifyPlaylistsResponse>(
      `/users/${spotifyUserId}/playlists?limit=${Math.min(50, limit)}&offset=${offset}`,
      accessToken,
    );

    playlists.push(...response.items);

    if (!response.next || response.items.length === 0) {
      break;
    }

    offset += response.items.length;
  }

  return playlists.slice(0, limit);
}

async function fetchPlaylistById(accessToken: string, playlistId: string) {
  return spotifyFetch<SpotifyPlaylist>(`/playlists/${playlistId}`, accessToken);
}

function getScriptPayloads(html: string) {
  return [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1]?.trim()).filter(Boolean) as string[];
}

async function fetchProfilePageHtml(profileUrl: string) {
  const response = await fetch(profileUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 SoundScope",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    return null;
  }

  return response.text();
}

function scrapePlaylistIdsFromProfileHtml(html: string) {
  const matches = [...html.matchAll(/\/playlist\/([A-Za-z0-9]{22})/g)];
  const uniqueIds = new Set<string>();

  matches.forEach((match) => {
    if (match[1]) {
      uniqueIds.add(match[1]);
    }
  });

  return [...uniqueIds];
}

function scrapeDisplayNameFromProfileHtml(html: string) {
  const ogTitleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i);
  if (ogTitleMatch?.[1]) {
    return ogTitleMatch[1];
  }

  const titleMatch = html.match(/<title>([^<]+)\s+on\s+Spotify<\/title>/i);
  return titleMatch?.[1] ?? "Spotify listener";
}

function normalizeArtistCandidate(value: unknown): PublicProfileArtist | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const id = typeof candidate.id === "string"
    ? candidate.id
    : typeof candidate.uri === "string" && candidate.uri.startsWith("spotify:artist:")
      ? candidate.uri.slice("spotify:artist:".length)
      : null;
  const name = typeof candidate.name === "string" ? candidate.name : null;

  if (!id || !name) {
    return null;
  }

  let imageUrl: string | undefined;
  const images = candidate.images;

  if (Array.isArray(images)) {
    const firstImage = images.find((image) => image && typeof image === "object" && typeof (image as { url?: unknown }).url === "string") as
      | { url: string }
      | undefined;
    imageUrl = firstImage?.url;
  }

  return {
    id,
    name,
    imageUrl,
    spotifyUrl: `https://open.spotify.com/artist/${id}`,
  };
}

function collectRecentArtistCandidates(value: unknown, path: string[] = [], results: PublicProfileArtist[] = []) {
  if (Array.isArray(value)) {
    const normalized = value
      .map((item) => normalizeArtistCandidate(item))
      .filter((item): item is PublicProfileArtist => Boolean(item));

    if (normalized.length > 0 && path.some((segment) => segment.toLowerCase().includes("recent"))) {
      results.push(...normalized);
    }

    value.forEach((item) => collectRecentArtistCandidates(item, path, results));
    return results;
  }

  if (!value || typeof value !== "object") {
    return results;
  }

  Object.entries(value as Record<string, unknown>).forEach(([key, nested]) => {
    collectRecentArtistCandidates(nested, [...path, key], results);
  });

  return results;
}

async function scrapeRecentArtistsFromProfile(profileUrl: string) {
  const html = await fetchProfilePageHtml(profileUrl);

  if (!html) {
    return [] as PublicProfileArtist[];
  }
  const scriptPayloads = getScriptPayloads(html);
  const results: PublicProfileArtist[] = [];

  for (const payload of scriptPayloads) {
    if (!payload.startsWith("{") && !payload.startsWith("[")) {
      continue;
    }

    try {
      const parsed = JSON.parse(payload);
      results.push(...collectRecentArtistCandidates(parsed));
    } catch {
      continue;
    }
  }

  const deduped = new Map<string, PublicProfileArtist>();
  results.forEach((artist) => {
    if (!deduped.has(artist.id)) {
      deduped.set(artist.id, artist);
    }
  });

  return [...deduped.values()].slice(0, 8);
}

async function scrapePublicPlaylistsFromProfile(profileUrl: string, accessToken: string) {
  const html = await fetchProfilePageHtml(profileUrl);

  if (!html) {
    return [] as SpotifyPlaylist[];
  }
  const playlistIds = scrapePlaylistIdsFromProfileHtml(html).slice(0, PUBLIC_PLAYLIST_LIMIT);

  if (playlistIds.length === 0) {
    return [] as SpotifyPlaylist[];
  }

  const playlists = await Promise.all(
    playlistIds.map((playlistId) => fetchPlaylistById(accessToken, playlistId).catch(() => null)),
  );

  return playlists.filter((playlist): playlist is SpotifyPlaylist => Boolean(playlist));
}

export async function getPublicSpotifyProfileInsights(spotifyUserId: string, profileUrl?: string) {
  return getCachedValue(`public-profile:${PUBLIC_PROFILE_CACHE_VERSION}:${spotifyUserId}:${profileUrl ?? "default"}`, PUBLIC_PROFILE_TTL_MS, async (): Promise<PublicSpotifyProfileInsights | null> => {
    const accessToken = await getSpotifyClientCredentialsToken();
    const resolvedProfileUrl = profileUrl ?? `https://open.spotify.com/user/${spotifyUserId}`;
    const profileHtml = await fetchProfilePageHtml(resolvedProfileUrl).catch(() => null);
    const user = await fetchPublicSpotifyUser(accessToken, spotifyUserId).catch(() => null);

    if (!user && !profileHtml) {
      return null;
    }

    const apiPlaylists = await fetchAllPublicPlaylists(accessToken, spotifyUserId, PUBLIC_PLAYLIST_LIMIT).catch(() => [] as SpotifyPlaylist[]);
    const scrapedPlaylists = profileHtml
      ? await Promise.all(
        scrapePlaylistIdsFromProfileHtml(profileHtml)
          .slice(0, PUBLIC_PLAYLIST_LIMIT)
          .map((playlistId) => fetchPlaylistById(accessToken, playlistId).catch(() => null)),
      ).then((playlists) => playlists.filter((playlist): playlist is SpotifyPlaylist => Boolean(playlist)))
      : await scrapePublicPlaylistsFromProfile(resolvedProfileUrl, accessToken).catch(() => [] as SpotifyPlaylist[]);
    const dedupedPlaylists = new Map<string, SpotifyPlaylist>();
    [...apiPlaylists, ...scrapedPlaylists].forEach((playlist) => {
      if (playlist?.id && !dedupedPlaylists.has(playlist.id)) {
        dedupedPlaylists.set(playlist.id, playlist);
      }
    });
    const publicPlaylists = [...dedupedPlaylists.values()].slice(0, PUBLIC_PLAYLIST_LIMIT);
    const playlistInsights = await getPublicPlaylistInsights(accessToken, publicPlaylists, publicPlaylists.length || PUBLIC_PLAYLIST_LIMIT).catch(() => [] as PlaylistInsight[]);
    const recentArtists = await scrapeRecentArtistsFromProfile(resolvedProfileUrl).catch(() => [] as PublicProfileArtist[]);

    return {
      spotifyUserId,
      displayName: user?.display_name ?? (profileHtml ? scrapeDisplayNameFromProfileHtml(profileHtml) : "Spotify listener"),
      imageUrl: user?.images?.[0]?.url,
      profileUrl: user?.external_urls?.spotify ?? resolvedProfileUrl,
      publicPlaylistCount: publicPlaylists.length,
      publicPlaylists,
      playlistInsights,
      recentArtists,
      recentArtistsVisible: recentArtists.length > 0,
      fetchedAt: new Date().toISOString(),
    };
  });
}

export async function getPublicSpotifyPlaylistDetail(playlistId: string) {
  const accessToken = await getSpotifyClientCredentialsToken();
  return getPublicPlaylistDetail(accessToken, playlistId);
}
