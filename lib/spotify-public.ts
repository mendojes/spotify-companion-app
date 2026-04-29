import { getCachedValue } from "@/lib/runtime-cache";
import { deriveGenreBasedMoodInsights } from "@/lib/moods";
import { invalidateDashboardSectionRuntimeCache, writeStoredPlaylistsSectionCache } from "@/lib/dashboard-section-cache";
import {
  getPlaylistPageDataFromHistory,
  getPublicPlaylistDetail,
  getPublicPlaylistInsights,
  getStoredPlaylistLibrary,
  seedStoredPublicPlaylistSnapshot,
} from "@/lib/spotify-playlists";
import { getSpotifyClientCredentialsToken, spotifyFetch } from "@/lib/spotify";
import { MoodPoint, PlaylistInsight, SpotifyPlaylist, SpotifyPlaylistsResponse } from "@/lib/types";

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
  moodData: MoodPoint[];
  moodSource: string;
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

type PublicPlaylistFetchResult = {
  playlists: SpotifyPlaylist[];
  total: number;
};

const PUBLIC_PROFILE_TTL_MS = 1000 * 60 * 5;
const PUBLIC_PLAYLIST_PREVIEW_LIMIT = 6;
const PUBLIC_PLAYLIST_PAGE_SIZE = 50;
const PUBLIC_PLAYLIST_MAX_PAGES = 20;
const PUBLIC_PROFILE_CACHE_VERSION = "v4";
const PUBLIC_PROFILE_FETCH_TIMEOUT_MS = 8_000;

async function fetchPublicSpotifyUser(accessToken: string, spotifyUserId: string) {
  return spotifyFetch<PublicSpotifyUser>(`/users/${spotifyUserId}`, accessToken);
}

async function fetchAllPublicPlaylists(accessToken: string, spotifyUserId: string): Promise<PublicPlaylistFetchResult> {
  const playlists: SpotifyPlaylist[] = [];
  let offset = 0;
  let total = 0;
  let pageCount = 0;

  while (pageCount < PUBLIC_PLAYLIST_MAX_PAGES) {
    const response = await spotifyFetch<SpotifyPlaylistsResponse>(
      `/users/${spotifyUserId}/playlists?limit=${PUBLIC_PLAYLIST_PAGE_SIZE}&offset=${offset}`,
      accessToken,
    );
    total = Math.max(total, response.total ?? 0);

    playlists.push(...response.items);
    pageCount += 1;

    if (!response.next || response.items.length === 0) {
      break;
    }

    offset += response.items.length;
  }

  return {
    playlists,
    total: Math.max(total, playlists.length),
  };
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
    signal: AbortSignal.timeout(PUBLIC_PROFILE_FETCH_TIMEOUT_MS),
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

function scrapeRecentArtistsFromProfileHtml(html: string) {
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

async function scrapeRecentArtistsFromProfile(profileUrl: string) {
  const html = await fetchProfilePageHtml(profileUrl);

  if (!html) {
    return [] as PublicProfileArtist[];
  }

  return scrapeRecentArtistsFromProfileHtml(html);
}

async function scrapePublicPlaylistsFromProfile(profileUrl: string, accessToken: string) {
  const html = await fetchProfilePageHtml(profileUrl);

  if (!html) {
    return [] as SpotifyPlaylist[];
  }
  const playlistIds = scrapePlaylistIdsFromProfileHtml(html).slice(0, PUBLIC_PLAYLIST_PAGE_SIZE);

  if (playlistIds.length === 0) {
    return [] as SpotifyPlaylist[];
  }

  const playlists = await Promise.all(
    playlistIds.map((playlistId) => fetchPlaylistById(accessToken, playlistId).catch(() => null)),
  );

  return playlists.filter((playlist): playlist is SpotifyPlaylist => Boolean(playlist));
}

function extractGenreSeedsFromPlaylistInsights(playlistInsights: PlaylistInsight[]) {
  return playlistInsights.flatMap((playlist) => {
    const summary = playlist.topGenresSummary?.trim();

    if (!summary || summary.toLowerCase().startsWith("loading")) {
      return [] as string[];
    }

    return summary
      .replace(/\sand\s/gi, ", ")
      .split(",")
      .map((genre) => genre.trim())
      .filter(Boolean);
  });
}

async function buildStoredPublicProfileFallback(
  spotifyUserId: string,
  profileUrl: string,
  playlistInsightLimit: number,
): Promise<PublicSpotifyProfileInsights | null> {
  const [storedPlaylists, storedPageData] = await Promise.all([
    getStoredPlaylistLibrary(spotifyUserId).catch(() => [] as SpotifyPlaylist[]),
    getPlaylistPageDataFromHistory(spotifyUserId, "last_listened_desc").catch(() => null),
  ]);

  if (storedPlaylists.length === 0 && !storedPageData) {
    return null;
  }

  const playlistInsights = storedPageData?.playlists.slice(0, playlistInsightLimit) ?? [];
  const moodInsights = deriveGenreBasedMoodInsights(
    extractGenreSeedsFromPlaylistInsights(storedPageData?.playlists ?? playlistInsights),
  );

  return {
    spotifyUserId,
    displayName: "Spotify listener",
    profileUrl,
    publicPlaylistCount: Math.max(storedPageData?.playlistCount ?? 0, storedPlaylists.length),
    publicPlaylists: storedPlaylists,
    playlistInsights,
    moodData: moodInsights.moodData,
    moodSource: `${moodInsights.moodSource} (stored public playlist cache)`,
    recentArtists: [],
    recentArtistsVisible: false,
    fetchedAt: storedPageData?.lastSyncedAt ?? new Date().toISOString(),
  };
}

export async function getPublicSpotifyProfileInsights(
  spotifyUserId: string,
  profileUrl?: string,
  options?: { playlistInsightLimit?: number },
) {
  const playlistInsightLimit = options?.playlistInsightLimit ?? PUBLIC_PLAYLIST_PREVIEW_LIMIT;

  return getCachedValue(`public-profile:${PUBLIC_PROFILE_CACHE_VERSION}:${spotifyUserId}:${profileUrl ?? "default"}:${playlistInsightLimit}`, PUBLIC_PROFILE_TTL_MS, async (): Promise<PublicSpotifyProfileInsights | null> => {
    const resolvedProfileUrl = profileUrl ?? `https://open.spotify.com/user/${spotifyUserId}`;
    const storedFallback = await buildStoredPublicProfileFallback(spotifyUserId, resolvedProfileUrl, playlistInsightLimit).catch(() => null);
    const profileHtml = await fetchProfilePageHtml(resolvedProfileUrl).catch(() => null);
    const accessToken = await getSpotifyClientCredentialsToken().catch(() => null);
    const user = accessToken ? await fetchPublicSpotifyUser(accessToken, spotifyUserId).catch(() => null) : null;
    const recentArtists = profileHtml ? scrapeRecentArtistsFromProfileHtml(profileHtml) : storedFallback?.recentArtists ?? [];

    if (!accessToken) {
      if (storedFallback) {
        return {
          ...storedFallback,
          displayName: profileHtml
            ? scrapeDisplayNameFromProfileHtml(profileHtml)
            : storedFallback.displayName,
          profileUrl: resolvedProfileUrl,
          recentArtists,
          recentArtistsVisible: recentArtists.length > 0,
          fetchedAt: new Date().toISOString(),
        };
      }

      if (profileHtml) {
        return {
          spotifyUserId,
          displayName: scrapeDisplayNameFromProfileHtml(profileHtml),
          imageUrl: undefined,
          profileUrl: resolvedProfileUrl,
          publicPlaylistCount: 0,
          publicPlaylists: [],
          playlistInsights: [],
          moodData: [],
          moodSource: "Public profile HTML only",
          recentArtists,
          recentArtistsVisible: recentArtists.length > 0,
          fetchedAt: new Date().toISOString(),
        };
      }

      return null;
    }

    const apiPlaylistResult = await fetchAllPublicPlaylists(accessToken, spotifyUserId).catch(() => ({
      playlists: [] as SpotifyPlaylist[],
      total: 0,
    }));
    const scrapedPlaylists = apiPlaylistResult.playlists.length > 0
      ? [] as SpotifyPlaylist[]
      : profileHtml
        ? await Promise.all(
          scrapePlaylistIdsFromProfileHtml(profileHtml)
            .slice(0, PUBLIC_PLAYLIST_PAGE_SIZE)
            .map((playlistId) => fetchPlaylistById(accessToken, playlistId).catch(() => null)),
        ).then((playlists) => playlists.filter((playlist): playlist is SpotifyPlaylist => Boolean(playlist)))
        : await scrapePublicPlaylistsFromProfile(resolvedProfileUrl, accessToken).catch(() => [] as SpotifyPlaylist[]);
    const dedupedPlaylists = new Map<string, SpotifyPlaylist>();

    [...apiPlaylistResult.playlists, ...scrapedPlaylists].forEach((playlist) => {
      if (playlist?.id && !dedupedPlaylists.has(playlist.id)) {
        dedupedPlaylists.set(playlist.id, playlist);
      }
    });

    const publicPlaylists = [...dedupedPlaylists.values()];
    const seedInsightLimit = Math.min(
      publicPlaylists.length,
      Math.max(playlistInsightLimit, PUBLIC_PLAYLIST_PREVIEW_LIMIT),
    );
    const seededPlaylistInsights = publicPlaylists.length > 0
      ? await getPublicPlaylistInsights(accessToken, publicPlaylists, seedInsightLimit).catch(() => [] as PlaylistInsight[])
      : [] as PlaylistInsight[];

    if (publicPlaylists.length > 0) {
      await seedStoredPublicPlaylistSnapshot(spotifyUserId, publicPlaylists, seededPlaylistInsights).catch(() => undefined);
      invalidateDashboardSectionRuntimeCache(spotifyUserId);
      await writeStoredPlaylistsSectionCache(spotifyUserId).catch(() => undefined);
    }

    const fallbackAfterSeed = publicPlaylists.length > 0
      ? await buildStoredPublicProfileFallback(spotifyUserId, resolvedProfileUrl, playlistInsightLimit).catch(() => storedFallback)
      : storedFallback;
    const playlistInsights = seededPlaylistInsights.length > 0
      ? seededPlaylistInsights.slice(0, playlistInsightLimit)
      : fallbackAfterSeed?.playlistInsights.slice(0, playlistInsightLimit) ?? [];
    const moodSourceInsights = (fallbackAfterSeed?.playlistInsights.length ?? 0) > seededPlaylistInsights.length
      ? fallbackAfterSeed?.playlistInsights ?? seededPlaylistInsights
      : seededPlaylistInsights;
    const moodInsights = deriveGenreBasedMoodInsights(extractGenreSeedsFromPlaylistInsights(moodSourceInsights));
    const resolvedPlaylists = publicPlaylists.length > 0 ? publicPlaylists : fallbackAfterSeed?.publicPlaylists ?? [];

    return {
      spotifyUserId,
      displayName: user?.display_name ?? (profileHtml ? scrapeDisplayNameFromProfileHtml(profileHtml) : storedFallback?.displayName ?? "Spotify listener"),
      imageUrl: user?.images?.[0]?.url ?? storedFallback?.imageUrl,
      profileUrl: user?.external_urls?.spotify ?? resolvedProfileUrl,
      publicPlaylistCount: Math.max(apiPlaylistResult.total, resolvedPlaylists.length, fallbackAfterSeed?.publicPlaylistCount ?? 0),
      publicPlaylists: resolvedPlaylists,
      playlistInsights,
      moodData: moodInsights.moodData,
      moodSource: seededPlaylistInsights.length > 0 ? moodInsights.moodSource : `${moodInsights.moodSource} (stored public playlist cache)`,
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
