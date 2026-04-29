import { getCachedValue, invalidateCachedValue } from "@/lib/runtime-cache";
import { deriveGenreBasedMoodInsights } from "@/lib/moods";
import { invalidateDashboardSectionRuntimeCache, writeStoredPlaylistsSectionCache } from "@/lib/dashboard-section-cache";
import { getDatabase, hasMongoConfig } from "@/lib/mongodb";
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

export type PublicProfileSyncState = {
  spotifyUserId: string;
  profileUrl: string;
  status: "idle" | "running" | "completed" | "failed";
  phase: string;
  processedPlaylists: number;
  totalPlaylists: number;
  startedAt?: string;
  finishedAt?: string;
  updatedAt?: string;
  durationMs?: number;
  error?: string;
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

type StoredPublicProfileSyncState = PublicProfileSyncState & {
  id: string;
};

const PUBLIC_PROFILE_TTL_MS = 1000 * 60 * 5;
const PUBLIC_PLAYLIST_PREVIEW_LIMIT = 6;
const PUBLIC_PLAYLIST_PAGE_SIZE = 50;
const PUBLIC_PLAYLIST_MAX_PAGES = 20;
const PUBLIC_PROFILE_CACHE_VERSION = "v5";
const PUBLIC_PROFILE_FETCH_TIMEOUT_MS = 8_000;
const PUBLIC_PROFILE_SYNC_COLLECTION = "public_profile_sync_status";
const PUBLIC_PROFILE_SYNC_STALE_MS = 1000 * 60 * 10;

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

function getPublicProfileCacheKeys(spotifyUserId: string, profileUrl?: string) {
  const resolved = profileUrl ?? "default";
  return [
    `public-profile:${PUBLIC_PROFILE_CACHE_VERSION}:${spotifyUserId}:${resolved}:2`,
    `public-profile:${PUBLIC_PROFILE_CACHE_VERSION}:${spotifyUserId}:${resolved}:${PUBLIC_PLAYLIST_PREVIEW_LIMIT}`,
  ];
}

function invalidatePublicProfileRuntimeCache(spotifyUserId: string, profileUrl?: string) {
  getPublicProfileCacheKeys(spotifyUserId, profileUrl).forEach((key) => invalidateCachedValue(key));
}

function defaultSyncState(spotifyUserId: string, profileUrl?: string): PublicProfileSyncState {
  return {
    spotifyUserId,
    profileUrl: profileUrl ?? `https://open.spotify.com/user/${spotifyUserId}`,
    status: "idle",
    phase: "Waiting to start",
    processedPlaylists: 0,
    totalPlaylists: 0,
  };
}

async function writePublicProfileSyncState(
  spotifyUserId: string,
  profileUrl: string,
  updates: Partial<PublicProfileSyncState>,
) {
  if (!hasMongoConfig()) {
    return;
  }

  const db = await getDatabase();
  if (!db) {
    return;
  }

  const now = new Date().toISOString();
  await db.collection<StoredPublicProfileSyncState>(PUBLIC_PROFILE_SYNC_COLLECTION).updateOne(
    { id: spotifyUserId },
    {
      $set: {
        id: spotifyUserId,
        spotifyUserId,
        profileUrl,
        updatedAt: now,
        ...updates,
      },
    },
    { upsert: true },
  );
}

export async function getPublicProfileSyncState(
  spotifyUserId: string,
  profileUrl?: string,
): Promise<PublicProfileSyncState> {
  const fallback = defaultSyncState(spotifyUserId, profileUrl);

  if (!hasMongoConfig()) {
    return fallback;
  }

  try {
    const db = await getDatabase();
    if (!db) {
      return fallback;
    }

    const stored = await db
      .collection<StoredPublicProfileSyncState>(PUBLIC_PROFILE_SYNC_COLLECTION)
      .findOne({ id: spotifyUserId });

    if (!stored) {
      return fallback;
    }

    return {
      spotifyUserId: stored.spotifyUserId,
      profileUrl: stored.profileUrl,
      status: stored.status,
      phase: stored.phase,
      processedPlaylists: stored.processedPlaylists,
      totalPlaylists: stored.totalPlaylists,
      startedAt: stored.startedAt,
      finishedAt: stored.finishedAt,
      updatedAt: stored.updatedAt,
      durationMs: stored.durationMs,
      error: stored.error,
    };
  } catch {
    return fallback;
  }
}

function estimateSyncDurationMs(playlists: SpotifyPlaylist[]) {
  const totalTracks = playlists.reduce((sum, playlist) => sum + (playlist.tracks?.total ?? 0), 0);
  return 1500 + playlists.length * 900 + totalTracks * 180;
}

async function fetchVisiblePublicPlaylists(accessToken: string | null, spotifyUserId: string, resolvedProfileUrl: string, profileHtml: string | null) {
  if (!accessToken) {
    return {
      playlists: [] as SpotifyPlaylist[],
      total: 0,
    } satisfies PublicPlaylistFetchResult;
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

  return {
    playlists: [...dedupedPlaylists.values()],
    total: Math.max(apiPlaylistResult.total, dedupedPlaylists.size),
  } satisfies PublicPlaylistFetchResult;
}

export async function runPublicProfileInsightsSync(
  spotifyUserId: string,
  profileUrl?: string,
): Promise<PublicProfileSyncState> {
  const resolvedProfileUrl = profileUrl ?? `https://open.spotify.com/user/${spotifyUserId}`;
  const existing = await getPublicProfileSyncState(spotifyUserId, resolvedProfileUrl);

  if (
    existing.status === "running" &&
    existing.updatedAt &&
    Date.now() - new Date(existing.updatedAt).getTime() < PUBLIC_PROFILE_SYNC_STALE_MS
  ) {
    return existing;
  }

  const startedAt = new Date().toISOString();
  await writePublicProfileSyncState(spotifyUserId, resolvedProfileUrl, {
    status: "running",
    phase: "Loading public Spotify profile",
    processedPlaylists: 0,
    totalPlaylists: 0,
    startedAt,
    finishedAt: undefined,
    durationMs: undefined,
    error: undefined,
  });

  try {
    const [profileHtml, accessToken] = await Promise.all([
      fetchProfilePageHtml(resolvedProfileUrl).catch(() => null),
      getSpotifyClientCredentialsToken().catch(() => null),
    ]);

    await writePublicProfileSyncState(spotifyUserId, resolvedProfileUrl, {
      status: "running",
      phase: accessToken ? "Loading public playlists" : "Spotify app token unavailable",
      processedPlaylists: 0,
      totalPlaylists: 0,
      startedAt,
      error: accessToken ? undefined : "Could not fetch a Spotify app token for public playlist analysis.",
    });

    if (!accessToken) {
      const finishedAt = new Date().toISOString();
      const durationMs = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
      const failedState: PublicProfileSyncState = {
        spotifyUserId,
        profileUrl: resolvedProfileUrl,
        status: "failed",
        phase: "Spotify app token unavailable",
        processedPlaylists: 0,
        totalPlaylists: 0,
        startedAt,
        finishedAt,
        updatedAt: finishedAt,
        durationMs,
        error: "Missing or invalid Spotify client credentials for public playlist analysis.",
      };
      await writePublicProfileSyncState(spotifyUserId, resolvedProfileUrl, failedState);
      return failedState;
    }

    const playlistFetchResult = await fetchVisiblePublicPlaylists(accessToken, spotifyUserId, resolvedProfileUrl, profileHtml);
    const publicPlaylists = playlistFetchResult.playlists;
    const totalPlaylists = Math.max(playlistFetchResult.total, publicPlaylists.length);

    if (publicPlaylists.length > 0) {
      await seedStoredPublicPlaylistSnapshot(spotifyUserId, publicPlaylists, []).catch(() => undefined);
      invalidateDashboardSectionRuntimeCache(spotifyUserId);
      await writeStoredPlaylistsSectionCache(spotifyUserId).catch(() => undefined);
      invalidatePublicProfileRuntimeCache(spotifyUserId, profileUrl);
    }

    await writePublicProfileSyncState(spotifyUserId, resolvedProfileUrl, {
      status: "running",
      phase: publicPlaylists.length > 0 ? "Analyzing public playlists" : "No public playlists found",
      processedPlaylists: 0,
      totalPlaylists,
      startedAt,
      error: undefined,
    });

    const playlistInsights: PlaylistInsight[] = [];

    for (let index = 0; index < publicPlaylists.length; index += 1) {
      const playlist = publicPlaylists[index];
      const nextInsights = await getPublicPlaylistInsights(accessToken, [playlist], 1).catch(() => [] as PlaylistInsight[]);

      if (nextInsights[0]) {
        playlistInsights.push(nextInsights[0]);
      }

      await writePublicProfileSyncState(spotifyUserId, resolvedProfileUrl, {
        status: "running",
        phase: `Analyzing public playlists (${index + 1}/${publicPlaylists.length})`,
        processedPlaylists: index + 1,
        totalPlaylists,
        startedAt,
        durationMs: Date.now() - new Date(startedAt).getTime(),
      });
    }

    if (publicPlaylists.length > 0) {
      await seedStoredPublicPlaylistSnapshot(spotifyUserId, publicPlaylists, playlistInsights).catch(() => undefined);
      invalidateDashboardSectionRuntimeCache(spotifyUserId);
      await writeStoredPlaylistsSectionCache(spotifyUserId).catch(() => undefined);
      invalidatePublicProfileRuntimeCache(spotifyUserId, profileUrl);
    }

    const finishedAt = new Date().toISOString();
    const completedState: PublicProfileSyncState = {
      spotifyUserId,
      profileUrl: resolvedProfileUrl,
      status: "completed",
      phase: publicPlaylists.length > 0 ? "Public playlist insights ready" : "No public playlists found",
      processedPlaylists: publicPlaylists.length,
      totalPlaylists,
      startedAt,
      finishedAt,
      updatedAt: finishedAt,
      durationMs: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
      error: undefined,
    };

    await writePublicProfileSyncState(spotifyUserId, resolvedProfileUrl, completedState);
    return completedState;
  } catch (error) {
    const finishedAt = new Date().toISOString();
    const failedState: PublicProfileSyncState = {
      spotifyUserId,
      profileUrl: resolvedProfileUrl,
      status: "failed",
      phase: "Public playlist sync failed",
      processedPlaylists: existing.processedPlaylists ?? 0,
      totalPlaylists: existing.totalPlaylists ?? 0,
      startedAt,
      finishedAt,
      updatedAt: finishedAt,
      durationMs: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
      error: error instanceof Error ? error.message : String(error),
    };

    await writePublicProfileSyncState(spotifyUserId, resolvedProfileUrl, failedState).catch(() => undefined);
    return failedState;
  }
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
    const [profileHtml, accessToken] = await Promise.all([
      fetchProfilePageHtml(resolvedProfileUrl).catch(() => null),
      getSpotifyClientCredentialsToken().catch(() => null),
    ]);
    const user = accessToken ? await fetchPublicSpotifyUser(accessToken, spotifyUserId).catch(() => null) : null;
    const recentArtists = profileHtml ? scrapeRecentArtistsFromProfileHtml(profileHtml) : storedFallback?.recentArtists ?? [];

    if (!accessToken) {
      if (!user && !profileHtml) {
        return storedFallback;
      }

      return storedFallback
        ? {
          ...storedFallback,
          displayName: user?.display_name ?? (profileHtml ? scrapeDisplayNameFromProfileHtml(profileHtml) : storedFallback.displayName),
          imageUrl: user?.images?.[0]?.url ?? storedFallback.imageUrl,
          profileUrl: user?.external_urls?.spotify ?? resolvedProfileUrl,
          recentArtists,
          recentArtistsVisible: recentArtists.length > 0,
        }
        : profileHtml
          ? {
            spotifyUserId,
            displayName: scrapeDisplayNameFromProfileHtml(profileHtml),
            imageUrl: undefined,
            profileUrl: resolvedProfileUrl,
            publicPlaylistCount: 0,
            publicPlaylists: [],
            playlistInsights: [],
            moodData: [],
            moodSource: "Public Spotify profile HTML only",
            recentArtists,
            recentArtistsVisible: recentArtists.length > 0,
            fetchedAt: new Date().toISOString(),
          }
          : null;
    }

    if (!user && !profileHtml && !storedFallback) {
      return null;
    }

    const playlistFetchResult = await fetchVisiblePublicPlaylists(accessToken, spotifyUserId, resolvedProfileUrl, profileHtml);
    const publicPlaylists = playlistFetchResult.playlists;

    if (publicPlaylists.length > 0) {
      await seedStoredPublicPlaylistSnapshot(spotifyUserId, publicPlaylists, []).catch(() => undefined);
      invalidateDashboardSectionRuntimeCache(spotifyUserId);
      await writeStoredPlaylistsSectionCache(spotifyUserId).catch(() => undefined);
    }

    const fallbackAfterSeed = publicPlaylists.length > 0
      ? await buildStoredPublicProfileFallback(spotifyUserId, resolvedProfileUrl, playlistInsightLimit).catch(() => storedFallback)
      : storedFallback;
    const playlistInsights = fallbackAfterSeed?.playlistInsights.slice(0, playlistInsightLimit) ?? [];
    const moodInsights = deriveGenreBasedMoodInsights(extractGenreSeedsFromPlaylistInsights(fallbackAfterSeed?.playlistInsights ?? playlistInsights));
    const resolvedPlaylists = publicPlaylists.length > 0 ? publicPlaylists : fallbackAfterSeed?.publicPlaylists ?? [];

    return {
      spotifyUserId,
      displayName: user?.display_name ?? (profileHtml ? scrapeDisplayNameFromProfileHtml(profileHtml) : storedFallback?.displayName ?? "Spotify listener"),
      imageUrl: user?.images?.[0]?.url ?? storedFallback?.imageUrl,
      profileUrl: user?.external_urls?.spotify ?? resolvedProfileUrl,
      publicPlaylistCount: Math.max(playlistFetchResult.total, resolvedPlaylists.length, fallbackAfterSeed?.publicPlaylistCount ?? 0),
      publicPlaylists: resolvedPlaylists,
      playlistInsights,
      moodData: moodInsights.moodData,
      moodSource: `${moodInsights.moodSource} (public playlist sync continues in the background)`,
      recentArtists,
      recentArtistsVisible: recentArtists.length > 0,
      fetchedAt: new Date().toISOString(),
    };
  });
}

export function getEstimatedPublicPlaylistInsightTime(playlists: SpotifyPlaylist[]) {
  return Math.max(1, Math.round(estimateSyncDurationMs(playlists) / 1000));
}

export async function getPublicSpotifyPlaylistDetail(playlistId: string) {
  const accessToken = await getSpotifyClientCredentialsToken();
  return getPublicPlaylistDetail(accessToken, playlistId);
}
