import { getDatabase, hasMongoConfig } from "@/lib/mongodb";
import { spotifyFetch, spotifyFetchOptional } from "@/lib/spotify";
import { getCachedValue } from "@/lib/runtime-cache";
import {
  NowPlayingState,
  SpotifyCurrentlyPlayingResponse,
  SpotifyRecentlyPlayedItem,
  SpotifyRecentlyPlayedResponse,
  StoredRecentPlay,
} from "@/lib/types";

const RECENT_PLAYS_COLLECTION = "spotify_recent_plays";
const RECENT_PLAY_LOOKBACK_LIMIT = 500;
const RECENT_PLAY_SYNC_TTL_MS = 1000 * 60 * 5;
const MAX_RECENT_PLAY_SYNC_ITEMS = 5000;
const recentPlaySyncStatus = new Map<string, {
  state: "idle" | "syncing";
  startedAt?: string;
  syncedAt?: string;
  syncedCount: number;
  mode?: "incremental" | "full";
  error?: string;
}>();

function getPlaylistIdFromContext(context?: SpotifyRecentlyPlayedItem["context"] | SpotifyCurrentlyPlayingResponse["context"]) {
  if (context?.type !== "playlist") {
    return undefined;
  }

  if (context.uri) {
    const uriMatch = context.uri.match(/^spotify:playlist:(.+)$/);
    if (uriMatch?.[1]) {
      return uriMatch[1];
    }
  }

  if (context.href) {
    const hrefMatch = context.href.match(/\/playlists\/([^/?]+)/);
    if (hrefMatch?.[1]) {
      return hrefMatch[1];
    }
  }

  return undefined;
}

export async function getPlayingFrom(accessToken: string, response: SpotifyCurrentlyPlayingResponse) {
  const playlistId = getPlaylistIdFromContext(response.context);

  if (playlistId) {
    try {
      const playlistPath = response.context?.href ? `${response.context.href.replace("https://api.spotify.com/v1", "")}?fields=id,name,images` : `/playlists/${playlistId}?fields=id,name,images`;
      const playlist = await spotifyFetch<{ id: string; name: string; images?: Array<{ url: string }> }>(playlistPath, accessToken);
      return {
        type: "playlist",
        label: playlist.name,
        playlistId: playlist.id,
        imageUrl: playlist.images?.[0]?.url ?? response.item?.album.images?.[0]?.url,
      };
    } catch {
      return {
        type: "playlist",
        label: "Spotify playlist",
        playlistId,
        imageUrl: response.item?.album.images?.[0]?.url,
      };
    }
  }

  if (response.context?.type === "album" || response.context?.type === "artist" || !response.context?.type) {
    return {
      type: response.context?.type ?? "album",
      label: response.item?.album.name ?? "Unknown release",
      imageUrl: response.item?.album.images?.[0]?.url,
    };
  }

  if (response.context?.type === "collection") {
    return {
      type: "collection",
      label: "Your library",
      imageUrl: response.item?.album.images?.[0]?.url,
    };
  }

  return {
    type: response.context?.type ?? "unknown",
    label: response.item?.album.name ?? "Unknown source",
    imageUrl: response.item?.album.images?.[0]?.url,
  };
}

export async function getCurrentPlaybackSource(accessToken: string) {
  const response = await spotifyFetchOptional<SpotifyCurrentlyPlayingResponse>("/me/player/currently-playing", accessToken);

  if (!response?.item) {
    return undefined;
  }

  return getPlayingFrom(accessToken, response);
}

function toStoredRecentPlay(spotifyUserId: string, item: SpotifyRecentlyPlayedItem): StoredRecentPlay {
  const playlistId = getPlaylistIdFromContext(item.context);

  return {
    spotifyUserId,
    trackId: item.track.id,
    playedAt: item.played_at,
    trackName: item.track.name,
    artistName: item.track.artists.map((artist) => artist.name).join(", "),
    artistIds: item.track.artists.map((artist) => artist.id).filter((id): id is string => Boolean(id)),
    albumName: item.track.album.name,
    durationMs: item.track.duration_ms,
    imageUrl: item.track.album.images?.[0]?.url,
    playlistId,
    sourceType: item.context?.type,
  };
}

async function fetchRecentPlayHistory(
  accessToken: string,
  options?: { limit?: number; stopAfterPlayedAt?: string; fullBackfill?: boolean },
) {
  const items: SpotifyRecentlyPlayedItem[] = [];
  const seenKeys = new Set<string>();
  const boundedLimit = Math.max(1, Math.min(MAX_RECENT_PLAY_SYNC_ITEMS, options?.limit ?? MAX_RECENT_PLAY_SYNC_ITEMS));
  const stopAfterPlayedAtMs = options?.stopAfterPlayedAt ? new Date(options.stopAfterPlayedAt).getTime() : Number.NaN;
  let before: string | undefined;

  while (items.length < boundedLimit) {
    const pageSize = Math.min(50, boundedLimit - items.length);
    const searchParams = new URLSearchParams({ limit: String(pageSize) });

    if (before) {
      searchParams.set("before", before);
    }

    const response = await spotifyFetch<SpotifyRecentlyPlayedResponse>(`/me/player/recently-played?${searchParams.toString()}`, accessToken);
    const pageItems = response.items ?? [];

    if (pageItems.length === 0) {
      break;
    }

    let reachedExisting = false;

    for (const item of pageItems) {
      const playedAtMs = new Date(item.played_at).getTime();
      if (!options?.fullBackfill && Number.isFinite(stopAfterPlayedAtMs) && Number.isFinite(playedAtMs) && playedAtMs <= stopAfterPlayedAtMs) {
        reachedExisting = true;
        continue;
      }

      const dedupeKey = `${item.track.id}:${item.played_at}`;
      if (seenKeys.has(dedupeKey)) {
        continue;
      }

      seenKeys.add(dedupeKey);
      items.push(item);

      if (items.length >= boundedLimit) {
        break;
      }
    }

    const spotifyBeforeCursor = response.cursors?.before;
    const oldestItem = pageItems[pageItems.length - 1];
    const oldestPlayedAtMs = oldestItem ? new Date(oldestItem.played_at).getTime() : Number.NaN;

    if (
      items.length >= boundedLimit ||
      pageItems.length < pageSize ||
      (!spotifyBeforeCursor && !Number.isFinite(oldestPlayedAtMs)) ||
      reachedExisting
    ) {
      break;
    }

    before = spotifyBeforeCursor ?? String(oldestPlayedAtMs - 1);
  }

  return items;
}

async function getLatestStoredRecentPlay(spotifyUserId: string) {
  if (!hasMongoConfig()) {
    return null;
  }

  const db = await getDatabase();
  if (!db) {
    return null;
  }

  return db
    .collection<StoredRecentPlay>(RECENT_PLAYS_COLLECTION)
    .find({ spotifyUserId })
    .sort({ playedAt: -1 })
    .limit(1)
    .next();
}

export async function syncRecentPlays(accessToken: string, spotifyUserId: string, options?: { fullBackfill?: boolean }) {
  const latestStoredRecent = options?.fullBackfill ? null : await getLatestStoredRecentPlay(spotifyUserId).catch(() => null);
  const recentItems = await fetchRecentPlayHistory(accessToken, {
    stopAfterPlayedAt: latestStoredRecent?.playedAt,
    fullBackfill: options?.fullBackfill,
  });
  const recentPlays = recentItems.map((item) => toStoredRecentPlay(spotifyUserId, item));

  if (!hasMongoConfig()) {
    return recentPlays;
  }

  const db = await getDatabase();
  if (!db) {
    return recentPlays;
  }

  if (recentPlays.length > 0) {
    await db.collection<StoredRecentPlay>(RECENT_PLAYS_COLLECTION).bulkWrite(
      recentPlays.map((play) => ({
        updateOne: {
          filter: {
            spotifyUserId: play.spotifyUserId,
            playedAt: play.playedAt,
            trackId: play.trackId,
          },
          update: { $set: play },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  }

  return recentPlays;
}

export function getRecentPlaySyncStatus(spotifyUserId: string) {
  return recentPlaySyncStatus.get(spotifyUserId) ?? {
    state: "idle" as const,
    syncedCount: 0,
    error: undefined,
  };
}

async function runRecentPlaySync(
  accessToken: string,
  spotifyUserId: string,
  options?: { fullBackfill?: boolean },
) {
  const previousStatus = recentPlaySyncStatus.get(spotifyUserId);
  recentPlaySyncStatus.set(spotifyUserId, {
    state: "syncing",
    startedAt: new Date().toISOString(),
    syncedAt: previousStatus?.syncedAt,
    syncedCount: previousStatus?.syncedCount ?? 0,
    mode: options?.fullBackfill ? "full" : "incremental",
    error: undefined,
  });

  try {
    const recentPlays = await syncRecentPlays(accessToken, spotifyUserId, options);
    recentPlaySyncStatus.set(spotifyUserId, {
      state: "idle",
      syncedAt: new Date().toISOString(),
      syncedCount: recentPlays.length,
      mode: options?.fullBackfill ? "full" : "incremental",
      error: undefined,
    });
    return recentPlays;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not sync recent plays.";
    recentPlaySyncStatus.set(spotifyUserId, {
      state: "idle",
      syncedAt: previousStatus?.syncedAt,
      syncedCount: previousStatus?.syncedCount ?? 0,
      mode: options?.fullBackfill ? "full" : "incremental",
      error: message,
    });
    throw error;
  }
}

export async function syncRecentPlaysIfNeeded(
  accessToken: string,
  spotifyUserId: string,
  options?: { force?: boolean; fullBackfill?: boolean },
) {
  const syncKey = `recent-play-sync:${spotifyUserId}`;

  if (options?.force) {
    return runRecentPlaySync(accessToken, spotifyUserId, { fullBackfill: options.fullBackfill });
  }

  return getCachedValue(syncKey, RECENT_PLAY_SYNC_TTL_MS, async () => {
    return runRecentPlaySync(accessToken, spotifyUserId, { fullBackfill: options?.fullBackfill });
  });
}

function filterRecentPlaysForRange(recentPlays: StoredRecentPlay[], range: "week" | "month" | "all") {
  if (range === "all") {
    return recentPlays;
  }

  const days = range === "week" ? 7 : 30;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return recentPlays.filter((play) => new Date(play.playedAt).getTime() >= cutoff);
}

export async function getStoredRecentPlaysForRange(spotifyUserId: string, range: "week" | "month" | "all", limit = RECENT_PLAY_LOOKBACK_LIMIT) {
  const recentPlays = await getStoredRecentPlays(spotifyUserId, limit);
  return filterRecentPlaysForRange(recentPlays, range);
}

export async function getStoredRecentPlaysPage(
  spotifyUserId: string,
  options?: { limit?: number; beforePlayedAt?: string },
) {
  const limit = Math.max(1, Math.min(500, options?.limit ?? 100));

  if (!hasMongoConfig()) {
    return {
      recentPlays: [] as StoredRecentPlay[],
      nextCursor: null as string | null,
    };
  }

  const db = await getDatabase();
  if (!db) {
    return {
      recentPlays: [] as StoredRecentPlay[],
      nextCursor: null as string | null,
    };
  }

  const filter: { spotifyUserId: string; playedAt?: { $lt: string } } = { spotifyUserId };
  if (options?.beforePlayedAt) {
    filter.playedAt = { $lt: options.beforePlayedAt };
  }

  const recentPlays = await db
    .collection<StoredRecentPlay>(RECENT_PLAYS_COLLECTION)
    .find(filter)
    .sort({ playedAt: -1 })
    .limit(limit + 1)
    .toArray();

  const hasMore = recentPlays.length > limit;
  const visibleRecentPlays = hasMore ? recentPlays.slice(0, limit) : recentPlays;

  return {
    recentPlays: visibleRecentPlays,
    nextCursor: hasMore ? visibleRecentPlays[visibleRecentPlays.length - 1]?.playedAt ?? null : null,
  };
}

export async function getStoredRecentPlays(spotifyUserId: string, limit = RECENT_PLAY_LOOKBACK_LIMIT) {
  if (!hasMongoConfig()) {
    return [] as StoredRecentPlay[];
  }

  const db = await getDatabase();
  if (!db) {
    return [] as StoredRecentPlay[];
  }

  return db
    .collection<StoredRecentPlay>(RECENT_PLAYS_COLLECTION)
    .find({ spotifyUserId })
    .sort({ playedAt: -1 })
    .limit(limit)
    .toArray();
}

export async function getNowPlaying(accessToken: string): Promise<NowPlayingState> {
  const response = await spotifyFetchOptional<SpotifyCurrentlyPlayingResponse>("/me/player/currently-playing", accessToken);

  if (!response?.item) {
    return { isPlaying: false };
  }

  return {
    isPlaying: response.is_playing,
    progressMs: response.progress_ms,
    track: {
      id: response.item.id,
      title: response.item.name,
      artist: response.item.artists.map((artist) => artist.name).join(", "),
      album: response.item.album.name,
      imageUrl: response.item.album.images?.[0]?.url,
      durationMs: response.item.duration_ms,
    },
    playingFrom: await getPlayingFrom(accessToken, response),
  };
}

