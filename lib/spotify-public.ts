import { invalidateDashboardSectionRuntimeCache, writeStoredPlaylistsSectionCache } from "@/lib/dashboard-section-cache";
import { deriveGenreBasedMoodInsights } from "@/lib/moods";
import { getCachedValue, invalidateCachedValue } from "@/lib/runtime-cache";
import { getSpotifyClientCredentialsToken, spotifyFetch } from "@/lib/spotify";
import {
  getPlaylistPageDataFromHistory,
  getPublicPlaylistDetail,
  getPublicPlaylistInsights,
  getStoredPlaylistLibrary,
  seedStoredPublicPlaylistSnapshot,
} from "@/lib/spotify-playlists";
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

type PublicProfileSourceData = {
  resolvedProfileUrl: string;
  profileHtml: string | null;
  accessToken: string | null;
  user: PublicSpotifyUser | null;
  recentArtists: PublicProfileArtist[];
  publicPlaylists: SpotifyPlaylist[];
  publicPlaylistCount: number;
};

const PUBLIC_PROFILE_TTL_MS = 1000 * 60 * 5;
const PUBLIC_PLAYLIST_PREVIEW_LIMIT = 6;
const PUBLIC_PLAYLIST_PAGE_SIZE = 50;
const PUBLIC_PLAYLIST_MAX_PAGES = 20;
const PUBLIC_PROFILE_CACHE_VERSION = "v5";
const PUBLIC_PROFILE_FETCH_TIMEOUT_MS = 8_000;
const PUBLIC_PROFILE_SYNC_TTL_MS = 1000 * 60;
const PUBLIC_PROFILE_PREVIEW_LIMITS = [2, PUBLIC_PLAYLIST_PREVIEW_LIMIT] as const;

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

function getPublicProfileCacheKey(spotifyUserId: string, profileUrl: string | undefined, playlistInsightLimit: number) {
  return `public-profile:${PUBLIC_PROFILE_CACHE_VERSION}:${spotifyUserId}:${profileUrl ?? "default"}:${playlistInsightLimit}`;
}

export function invalidatePublicSpotifyProfileCache(spotifyUserId: string, profileUrl?: string) {
  for (const limit of PUBLIC_PROFILE_PREVIEW_LIMITS) {
    invalidateCachedValue(getPublicProfileCacheKey(spotifyUserId, profileUrl, limit));
  }

  if (profileUrl) {
    for (const limit of PUBLIC_PROFILE_PREVIEW_LIMITS) {
      invalidateCachedValue(getPublicProfileCacheKey(spotifyUserId, undefined, limit));
    }
  }
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

function buildMinimalPublicProfileInsights(
  spotifyUserId: string,
  resolvedProfileUrl: string,
  playlistInsightLimit: number,
  profileHtml: string | null,
  recentArtists: PublicProfileArtist[],
  storedFallback: PublicSpotifyProfileInsights | null,
  user?: PublicSpotifyUser | null,
): PublicSpotifyProfileInsights | null {
  if (storedFallback) {
    return {
      ...storedFallback,
      displayName: user?.display_name ?? (profileHtml ? scrapeDisplayNameFromProfileHtml(profileHtml) : storedFallback.displayName),
      imageUrl: user?.images?.[0]?.url ?? storedFallback.imageUrl,
      profileUrl: user?.external_urls?.spotify ?? resolvedProfileUrl,
      recentArtists,
      recentArtistsVisible: recentArtists.length > 0,
      fetchedAt: new Date().toISOString(),
    };
  }

  if (!profileHtml && !user) {
    return null;
  }

  return {
    spotifyUserId,
    displayName: user?.display_name ?? (profileHtml ? scrapeDisplayNameFromProfileHtml(profileHtml) : "Spotify listener"),
    imageUrl: user?.images?.[0]?.url,
    profileUrl: user?.external_urls?.spotify ?? resolvedProfileUrl,
    publicPlaylistCount: 0,
    publicPlaylists: [],
    playlistInsights: [] as PlaylistInsight[],
    moodData: [] as MoodPoint[],
    moodSource: "Public profile HTML only",
    recentArtists,
    recentArtistsVisible: recentArtists.length > 0,
    fetchedAt: new Date().toISOString(),
  };
}

async function fetchPublicProfileSourceData(
  spotifyUserId: string,
  profileUrl?: string,
): Promise<PublicProfileSourceData> {
  const resolvedProfileUrl = profileUrl ?? `https://open.spotify.com/user/${spotifyUserId}`;
  const [profileHtml, accessToken] = await Promise.all([
    fetchProfilePageHtml(resolvedProfileUrl).catch(() => null),
    getSpotifyClientCredentialsToken().catch(() => null),
  ]);
  const recentArtists = profileHtml ? scrapeRecentArtistsFromProfileHtml(profileHtml) : [];

  if (!accessToken) {
    return {
      resolvedProfileUrl,
      profileHtml,
      accessToken: null,
      user: null,
      recentArtists,
      publicPlaylists: [],
      publicPlaylistCount: 0,
    };
  }

  const userPromise = fetchPublicSpotifyUser(accessToken, spotifyUserId).catch(() => null);
  const apiPlaylistPromise = fetchAllPublicPlaylists(accessToken, spotifyUserId).catch(() => ({
    playlists: [] as SpotifyPlaylist[],
    total: 0,
  }));
  const [user, apiPlaylistResult] = await Promise.all([userPromise, apiPlaylistPromise]);

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

  return {
    resolvedProfileUrl,
    profileHtml,
    accessToken,
    user,
    recentArtists,
    publicPlaylists,
    publicPlaylistCount: Math.max(apiPlaylistResult.total, publicPlaylists.length),
  };
}

async function seedPublicProfileSnapshot(
  spotifyUserId: string,
  publicPlaylists: SpotifyPlaylist[],
  playlistInsights: PlaylistInsight[] = [],
) {
  if (publicPlaylists.length === 0) {
    return;
  }

  await seedStoredPublicPlaylistSnapshot(spotifyUserId, publicPlaylists, playlistInsights).catch(() => undefined);
  invalidateDashboardSectionRuntimeCache(spotifyUserId);
  await writeStoredPlaylistsSectionCache(spotifyUserId).catch(() => undefined);
}

export async function refreshPublicSpotifyProfileInsights(spotifyUserId: string, profileUrl?: string) {
  return getCachedValue(
    `public-profile-sync:${spotifyUserId}:${profileUrl ?? "default"}`,
    PUBLIC_PROFILE_SYNC_TTL_MS,
    async () => {
      const sourceData = await fetchPublicProfileSourceData(spotifyUserId, profileUrl);

      if (!sourceData.accessToken || sourceData.publicPlaylists.length === 0) {
        invalidatePublicSpotifyProfileCache(spotifyUserId, profileUrl);
        return {
          refreshed: false,
          playlistCount: sourceData.publicPlaylistCount,
        };
      }

      const playlistInsights = await getPublicPlaylistInsights(
        sourceData.accessToken,
        sourceData.publicPlaylists,
        sourceData.publicPlaylists.length,
      ).catch(() => [] as PlaylistInsight[]);

      await seedPublicProfileSnapshot(spotifyUserId, sourceData.publicPlaylists, playlistInsights);
      invalidatePublicSpotifyProfileCache(spotifyUserId, profileUrl);

      return {
        refreshed: true,
        playlistCount: sourceData.publicPlaylistCount,
      };
    },
  );
}

export async function getPublicSpotifyProfileInsights(
  spotifyUserId: string,
  profileUrl?: string,
  options?: { playlistInsightLimit?: number },
) {
  const playlistInsightLimit = options?.playlistInsightLimit ?? PUBLIC_PLAYLIST_PREVIEW_LIMIT;

  return getCachedValue(
    getPublicProfileCacheKey(spotifyUserId, profileUrl, playlistInsightLimit),
    PUBLIC_PROFILE_TTL_MS,
    async (): Promise<PublicSpotifyProfileInsights | null> => {
      const sourceData = await fetchPublicProfileSourceData(spotifyUserId, profileUrl);
      const storedFallback = await buildStoredPublicProfileFallback(
        spotifyUserId,
        sourceData.resolvedProfileUrl,
        playlistInsightLimit,
      ).catch(() => null);

      if (!sourceData.accessToken) {
        return buildMinimalPublicProfileInsights(
          spotifyUserId,
          sourceData.resolvedProfileUrl,
          playlistInsightLimit,
          sourceData.profileHtml,
          sourceData.recentArtists,
          storedFallback,
          sourceData.user,
        );
      }

      if (sourceData.publicPlaylists.length > 0) {
        await seedPublicProfileSnapshot(spotifyUserId, sourceData.publicPlaylists);
      }

      const fallbackAfterSeed = sourceData.publicPlaylists.length > 0
        ? await buildStoredPublicProfileFallback(
          spotifyUserId,
          sourceData.resolvedProfileUrl,
          playlistInsightLimit,
        ).catch(() => storedFallback)
        : storedFallback;

      const playlistInsights = fallbackAfterSeed?.playlistInsights.slice(0, playlistInsightLimit) ?? [];
      const moodInsights = deriveGenreBasedMoodInsights(extractGenreSeedsFromPlaylistInsights(
        fallbackAfterSeed?.playlistInsights ?? playlistInsights,
      ));
      const resolvedPlaylists = sourceData.publicPlaylists.length > 0
        ? sourceData.publicPlaylists
        : fallbackAfterSeed?.publicPlaylists ?? [];

      return {
        spotifyUserId,
        displayName: sourceData.user?.display_name
          ?? (sourceData.profileHtml ? scrapeDisplayNameFromProfileHtml(sourceData.profileHtml) : storedFallback?.displayName ?? "Spotify listener"),
        imageUrl: sourceData.user?.images?.[0]?.url ?? storedFallback?.imageUrl,
        profileUrl: sourceData.user?.external_urls?.spotify ?? sourceData.resolvedProfileUrl,
        publicPlaylistCount: Math.max(
          sourceData.publicPlaylistCount,
          resolvedPlaylists.length,
          fallbackAfterSeed?.publicPlaylistCount ?? 0,
        ),
        publicPlaylists: resolvedPlaylists,
        playlistInsights,
        moodData: moodInsights.moodData,
        moodSource: playlistInsights.length > 0 ? `${moodInsights.moodSource} (stored public playlist cache)` : "Public profile snapshot pending deeper analysis",
        recentArtists: sourceData.recentArtists,
        recentArtistsVisible: sourceData.recentArtists.length > 0,
        fetchedAt: new Date().toISOString(),
      };
    },
  );
}

export async function getPublicSpotifyPlaylistDetail(playlistId: string) {
  const accessToken = await getSpotifyClientCredentialsToken();
  return getPublicPlaylistDetail(accessToken, playlistId);
}
