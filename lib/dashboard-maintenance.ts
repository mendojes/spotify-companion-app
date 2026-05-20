import { createHash } from "node:crypto";
import type { WithId } from "mongodb";
import { getDatabase, hasMongoConfig } from "@/lib/mongodb";
import { writeStoredDashboardOverviewCache } from "@/lib/dashboard-overview";
import {
  invalidateDashboardSectionRuntimeCache,
  writeStoredDashboardSectionCache,
  writeStoredPlaylistsSectionCache,
  writeStoredTopListsSectionEntry,
} from "@/lib/dashboard-section-cache";
import { backfillMissingArtistMetadataForUser } from "@/lib/spotify-dashboard";
import { deleteImportedLastFmScrobbles, deleteUnresolvedImportedLastFmScrobbles, normalizeImportedLastFmScrobbles, refreshLastFmImportCaches } from "@/lib/lastfm-import";
import { ensureStoredPlaylistTrackCache, getStoredPlaylistTrackDiagnostics } from "@/lib/spotify-playlists";
import { getStoredTrackMetadataMap, TRACK_METADATA_COLLECTION } from "@/lib/track-metadata-cache";
import { TopListsData, StoredRecentPlay } from "@/lib/types";

const RECENT_PLAYS_COLLECTION = "spotify_recent_plays";
const USER_TRACK_LIBRARY_COLLECTION = "spotify_user_track_library";
const PLAYLIST_TRACK_CACHE_COLLECTION = "spotify_playlist_track_cache";
const USER_ARTIST_LIBRARY_COLLECTION = "spotify_user_artist_library";
const USER_ALBUM_LIBRARY_COLLECTION = "spotify_user_album_library";
const USER_LIBRARY_STATE_COLLECTION = "spotify_user_library_state";
const ALL_TIME_TOP_LISTS_STATE_COLLECTION = "dashboard_all_time_top_lists_state";
const ARTIST_METADATA_COLLECTION = "spotify_artist_metadata";
const ALBUM_METADATA_COLLECTION = "spotify_album_metadata";
const TOP_LISTS_CACHE_COLLECTION = "dashboard_top_lists_cache";
const MAINTENANCE_HISTORY_COLLECTION = "dashboard_maintenance_history";

const PAGE_SIZE = 2_000;
const MAX_RUNTIME_MS = 22_000;

export type MaintenanceAction =
  | "rebuild-playlist-cache"
  | "rebuild-overview-cache"
  | "rebuild-top-list-caches"
  | "backfill-artist-metadata"
  | "delete-lastfm-imports"
  | "delete-unresolved-lastfm-imports"
  | "delete-non-spotify-track-metadata"
  | "normalize-lastfm-imports"
  | "retry-unresolved-lastfm-imports"
  | "refresh-track-library-full"
  | "refresh-track-library-incremental"
  | "refresh-artist-library-full"
  | "refresh-artist-library-incremental"
  | "refresh-album-library-full"
  | "refresh-album-library-incremental"
  | "refresh-all-time-full"
  | "refresh-all-time-incremental";

export type RetryUnresolvedBatchProfile = "cache-only" | "conservative" | "balanced" | "aggressive" | "very-aggressive";

type MaintenanceProgressReporter = (detail: string) => Promise<void> | void;

type UserTrackLibraryDoc = {
  spotifyUserId: string;
  trackId: string;
  trackName: string;
  artistName: string;
  normalizedTrackArtistKey?: string;
  normalizedNameKey?: string;
  artistNames?: string[];
  artistIds?: string[];
  albumId?: string;
  albumName: string;
  durationMs?: number;
  imageUrl?: string;
  totalPlayCount: number;
  lastPlayedAt: string;
  updatedAt: string;
};

type UserArtistLibraryDoc = {
  spotifyUserId: string;
  artistKey: string;
  artistId?: string;
  name: string;
  genres?: string[];
  imageUrl?: string;
  totalPlayCount: number;
  lastPlayedAt: string;
  updatedAt: string;
};

type UserAlbumLibraryDoc = {
  spotifyUserId: string;
  albumKey: string;
  albumId?: string;
  name: string;
  artistName: string;
  artistNames?: string[];
  artistIds?: string[];
  imageUrl?: string;
  trackIds?: string[];
  totalPlayCount: number;
  lastPlayedAt: string;
  updatedAt: string;
};

type StoredAlbumMetadataDoc = {
  albumKey: string;
  albumId?: string;
  name: string;
  artistName: string;
  artistNames?: string[];
  artistIds?: string[];
  imageUrl?: string;
  trackIds?: string[];
  updatedAt: string;
};

type UserLibraryStateDoc = {
  spotifyUserId: string;
  action: string;
  mode: "full" | "incremental";
  lastProcessedPlayedAt?: string;
  buildComplete?: boolean;
  updatedAt: string;
};

type AllTimeTopListsStateDoc = {
  spotifyUserId: string;
  lastComputedPlayedAt?: string;
  mode: "full" | "incremental";
  updatedAt: string;
};

export type MaintenanceHistoryEntry = {
  spotifyUserId: string;
  action: MaintenanceAction;
  status: "running" | "success" | "error";
  detail: string;
  partial?: boolean;
  startedAt: string;
  finishedAt?: string;
  updatedAt: string;
};

export type CachedLastFmResolutionSuggestion = {
  trackId: string;
  trackName: string;
  artistName: string;
  artistNames?: string[];
  albumName: string;
  imageUrl?: string;
  playlistId?: string;
  playlistName?: string;
  score: number;
  titleScore: number;
  artistScore: number;
  albumScore: number;
  romanizedTitleScore: number;
  source: "playlist-cache" | "track-library" | "track-metadata";
};

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeLooseText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[â€œâ€"'"`Â´â€™]/g, "")
    .replace(/[()[\]{}]/g, " ")
    .replace(/[\/\\|:_\-â€“â€”,.;!?]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function tokenizeLooseText(value: string) {
  return normalizeLooseText(value)
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);
}

function containsNonLatinCharacters(value: string) {
  return /[^\u0000-\u024f]/.test(value);
}

function computeTokenOverlapScore(left: string, right: string) {
  const leftTokens = tokenizeLooseText(left);
  const rightTokens = tokenizeLooseText(right);
  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return 0;
  }

  const rightSet = new Set(rightTokens);
  const matched = leftTokens.filter((token) => rightSet.has(token)).length;
  return matched / Math.max(leftTokens.length, rightTokens.length);
}

function computeLooseFieldScore(left: string, right: string) {
  const normalizedLeft = normalizeLooseText(left);
  const normalizedRight = normalizeLooseText(right);
  if (!normalizedLeft || !normalizedRight) {
    return 0;
  }
  if (normalizedLeft === normalizedRight) {
    return 1;
  }
  if (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)) {
    return 0.92;
  }
  return computeTokenOverlapScore(normalizedLeft, normalizedRight);
}

function isSpotifyTrackId(trackId?: string) {
  return typeof trackId === "string" && /^[A-Za-z0-9]{22}$/.test(trackId.trim());
}

function isSyntheticLastFmTrackId(trackId?: string) {
  return typeof trackId === "string" && /^lastfm:/i.test(trackId.trim());
}

function isMongoTimeoutError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return message.includes("timed out") || message.includes("mongonetworktimeouterror");
}

function isUnresolvedImportedPlay(play: Pick<StoredRecentPlay, "sourceType" | "trackId">) {
  return play.sourceType === "lastfm_import" && !isSpotifyTrackId(play.trackId);
}

function toSafeTrackId(play: Pick<StoredRecentPlay, "trackId" | "trackName" | "artistName" | "albumName">) {
  if (play.trackId?.trim()) {
    return play.trackId.trim();
  }

  const base = `${play.trackName}::${play.artistName}::${play.albumName}`;
  return `local:${createHash("sha1").update(base).digest("hex").slice(0, 24)}`;
}

function toArtistKeys(play: Pick<StoredRecentPlay, "artistIds" | "artistNames" | "artistName">) {
  const ids = play.artistIds ?? [];
  const names = play.artistNames?.length ? play.artistNames : play.artistName.split(/,\s*/).filter(Boolean);
  if (ids.length > 0 && names.length > 0) {
    return ids.map((artistId, index) => ({
      artistKey: artistId,
      artistId,
      name: names[index] ?? names[0] ?? play.artistName,
    }));
  }

  return [{
    artistKey: `name:${normalizeText(play.artistName)}`,
    artistId: undefined,
    name: play.artistName,
  }];
}

function toAlbumKey(play: Pick<StoredRecentPlay, "albumName" | "artistName">) {
  return `${normalizeText(play.albumName)}::${normalizeText(play.artistName)}`;
}

async function getLatestPlayedAt(spotifyUserId: string) {
  const db = await getDatabase({ forceRetry: true });
  if (!db) {
    return "";
  }

  const latest = await db.collection<StoredRecentPlay>(RECENT_PLAYS_COLLECTION)
    .find({ spotifyUserId })
    .sort({ playedAt: -1 })
    .limit(1)
    .project({ playedAt: 1 })
    .toArray();

  return latest[0]?.playedAt ?? "";
}

async function readUserLibraryState(spotifyUserId: string, action: string) {
  const db = await getDatabase({ forceRetry: true });
  if (!db) {
    return null;
  }

  return db.collection<UserLibraryStateDoc>(USER_LIBRARY_STATE_COLLECTION).findOne({ spotifyUserId, action }) as Promise<UserLibraryStateDoc | null>;
}

async function writeUserLibraryState(
  spotifyUserId: string,
  action: string,
  patch: Partial<UserLibraryStateDoc> & Pick<UserLibraryStateDoc, "mode">,
) {
  const db = await getDatabase({ forceRetry: true });
  if (!db) {
    return;
  }

  await db.collection<UserLibraryStateDoc>(USER_LIBRARY_STATE_COLLECTION).updateOne(
    { spotifyUserId, action },
    {
      $set: {
        spotifyUserId,
        action,
        updatedAt: new Date().toISOString(),
        ...patch,
      },
    },
    { upsert: true },
  );
}

async function upsertTrackMetadataCacheEntry(record: Omit<UserTrackLibraryDoc, "spotifyUserId" | "totalPlayCount" | "lastPlayedAt" | "updatedAt">) {
  if (!hasMongoConfig()) {
    return;
  }

  const db = await getDatabase({ forceRetry: true });
  if (!db) {
    return;
  }

  await db.collection(TRACK_METADATA_COLLECTION).updateOne(
    { trackId: record.trackId },
    {
      $set: {
        trackId: record.trackId,
        trackName: record.trackName,
        artistName: record.artistName,
        normalizedTrackArtistKey: record.normalizedTrackArtistKey,
        normalizedNameKey: record.normalizedNameKey,
        artistNames: record.artistNames,
        artistIds: record.artistIds,
        albumId: record.albumId,
        albumName: record.albumName,
        durationMs: record.durationMs,
        imageUrl: record.imageUrl,
        updatedAt: new Date().toISOString(),
      },
    },
    { upsert: true },
  );
}

function buildTrackBulkOps(
  spotifyUserId: string,
  plays: StoredRecentPlay[],
  metadataByTrackId: Map<string, Awaited<ReturnType<typeof getStoredTrackMetadataMap>> extends Map<string, infer T> ? T : never>,
) {
  const grouped = new Map<string, UserTrackLibraryDoc>();
  plays.forEach((play) => {
    const trackId = toSafeTrackId(play);
    const metadata = metadataByTrackId.get(trackId);
    const existing = grouped.get(trackId);
    const base: UserTrackLibraryDoc = {
      spotifyUserId,
      trackId,
      trackName: metadata?.trackName ?? play.trackName,
      artistName: metadata?.artistName ?? play.artistName,
      normalizedTrackArtistKey: `${normalizeText(metadata?.trackName ?? play.trackName)}::${normalizeText(metadata?.artistName ?? play.artistName)}`,
      normalizedNameKey: `${normalizeText(metadata?.trackName ?? play.trackName)}::${normalizeText(metadata?.artistName ?? play.artistName)}::${normalizeText(metadata?.albumName ?? play.albumName)}`,
      artistNames: metadata?.artistNames ?? play.artistNames,
      artistIds: metadata?.artistIds ?? play.artistIds,
      albumId: metadata?.albumId,
      albumName: metadata?.albumName ?? play.albumName,
      durationMs: metadata?.durationMs ?? play.durationMs,
      imageUrl: metadata?.imageUrl ?? play.imageUrl,
      totalPlayCount: (existing?.totalPlayCount ?? 0) + 1,
      lastPlayedAt: existing?.lastPlayedAt && existing.lastPlayedAt > play.playedAt ? existing.lastPlayedAt : play.playedAt,
      updatedAt: new Date().toISOString(),
    };
    grouped.set(trackId, base);
  });

  return [...grouped.values()].map((record) => ({
    updateOne: {
      filter: { spotifyUserId, trackId: record.trackId },
      update: {
        $set: {
          trackName: record.trackName,
          artistName: record.artistName,
          normalizedTrackArtistKey: record.normalizedTrackArtistKey,
          normalizedNameKey: record.normalizedNameKey,
          artistNames: record.artistNames,
          artistIds: record.artistIds,
          albumId: record.albumId,
          albumName: record.albumName,
          durationMs: record.durationMs,
          imageUrl: record.imageUrl,
          lastPlayedAt: record.lastPlayedAt,
          updatedAt: record.updatedAt,
        },
        $inc: {
          totalPlayCount: record.totalPlayCount,
        },
      },
      upsert: true,
    },
  }));
}

function buildArtistBulkOps(spotifyUserId: string, plays: StoredRecentPlay[]) {
  const grouped = new Map<string, UserArtistLibraryDoc>();
  plays.forEach((play) => {
    toArtistKeys(play).forEach((artist) => {
      const existing = grouped.get(artist.artistKey);
      grouped.set(artist.artistKey, {
        spotifyUserId,
        artistKey: artist.artistKey,
        artistId: artist.artistId,
        name: artist.name,
        totalPlayCount: (existing?.totalPlayCount ?? 0) + 1,
        lastPlayedAt: existing?.lastPlayedAt && existing.lastPlayedAt > play.playedAt ? existing.lastPlayedAt : play.playedAt,
        updatedAt: new Date().toISOString(),
        genres: existing?.genres,
        imageUrl: existing?.imageUrl,
      });
    });
  });

  return [...grouped.values()].map((record) => ({
    updateOne: {
      filter: { spotifyUserId, artistKey: record.artistKey },
      update: {
        $set: {
          artistId: record.artistId,
          name: record.name,
          lastPlayedAt: record.lastPlayedAt,
          updatedAt: record.updatedAt,
        },
        $inc: {
          totalPlayCount: record.totalPlayCount,
        },
      },
      upsert: true,
    },
  }));
}

function buildAlbumBulkOps(
  spotifyUserId: string,
  plays: StoredRecentPlay[],
  metadataByTrackId: Map<string, Awaited<ReturnType<typeof getStoredTrackMetadataMap>> extends Map<string, infer T> ? T : never>,
) {
  const grouped = new Map<string, UserAlbumLibraryDoc>();
  plays.forEach((play) => {
    const trackId = toSafeTrackId(play);
    const metadata = metadataByTrackId.get(trackId);
    const resolvedAlbumName = metadata?.albumName ?? play.albumName;
    const resolvedArtistName = metadata?.artistName ?? play.artistName;
    const albumKey = `${normalizeText(resolvedAlbumName)}::${normalizeText(resolvedArtistName)}`;
    const existing = grouped.get(albumKey);
    grouped.set(albumKey, {
      spotifyUserId,
      albumKey,
      albumId: metadata?.albumId ?? existing?.albumId,
      name: resolvedAlbumName,
      artistName: resolvedArtistName,
      artistNames: metadata?.artistNames ?? play.artistNames,
      artistIds: metadata?.artistIds ?? play.artistIds,
      imageUrl: metadata?.imageUrl ?? play.imageUrl ?? existing?.imageUrl,
      trackIds: [...new Set([...(existing?.trackIds ?? []), trackId])],
      totalPlayCount: (existing?.totalPlayCount ?? 0) + 1,
      lastPlayedAt: existing?.lastPlayedAt && existing.lastPlayedAt > play.playedAt ? existing.lastPlayedAt : play.playedAt,
      updatedAt: new Date().toISOString(),
    });
  });

  return [...grouped.values()].map((record) => ({
    updateOne: {
      filter: { spotifyUserId, albumKey: record.albumKey },
      update: {
        $set: {
          albumId: record.albumId,
          name: record.name,
          artistName: record.artistName,
          artistNames: record.artistNames,
          artistIds: record.artistIds,
          imageUrl: record.imageUrl,
          trackIds: record.trackIds,
          lastPlayedAt: record.lastPlayedAt,
          updatedAt: record.updatedAt,
        },
        $inc: {
          totalPlayCount: record.totalPlayCount,
        },
      },
      upsert: true,
    },
  }));
}

async function upsertAlbumMetadataEntries(records: UserAlbumLibraryDoc[]) {
  if (!hasMongoConfig() || records.length === 0) {
    return;
  }

  const db = await getDatabase({ forceRetry: true });
  if (!db) {
    return;
  }

  const deduped = new Map<string, StoredAlbumMetadataDoc>();
  records.forEach((record) => {
    deduped.set(record.albumKey, {
      albumKey: record.albumKey,
      albumId: record.albumId,
      name: record.name,
      artistName: record.artistName,
      artistNames: record.artistNames,
      artistIds: record.artistIds,
      imageUrl: record.imageUrl,
      trackIds: record.trackIds,
      updatedAt: new Date().toISOString(),
    });
  });

  await db.collection<StoredAlbumMetadataDoc>(ALBUM_METADATA_COLLECTION).bulkWrite(
    [...deduped.values()].map((record) => ({
      updateOne: {
        filter: { albumKey: record.albumKey },
        update: {
          $set: record,
        },
        upsert: true,
      },
    })),
    { ordered: false },
  );
}

export async function writeMaintenanceHistoryEntry(
  spotifyUserId: string,
  action: MaintenanceAction,
  status: MaintenanceHistoryEntry["status"],
  detail: string,
  options?: {
    partial?: boolean;
    startedAt?: string;
  },
) {
  if (!hasMongoConfig()) {
    return;
  }

  const db = await getDatabase({ forceRetry: true });
  if (!db) {
    return;
  }

  const updatedAt = new Date().toISOString();
  await db.collection<MaintenanceHistoryEntry>(MAINTENANCE_HISTORY_COLLECTION).updateOne(
    { spotifyUserId, action },
    {
      $set: {
        spotifyUserId,
        action,
        status,
        detail,
        partial: options?.partial,
        updatedAt,
        startedAt: options?.startedAt ?? updatedAt,
        finishedAt: status === "running" ? undefined : updatedAt,
      },
    },
    { upsert: true },
  );
}

export async function listMaintenanceHistory(spotifyUserId: string) {
  if (!hasMongoConfig()) {
    return [] as MaintenanceHistoryEntry[];
  }

  const db = await getDatabase({ forceRetry: true });
  if (!db) {
    return [] as MaintenanceHistoryEntry[];
  }

  return db.collection<MaintenanceHistoryEntry>(MAINTENANCE_HISTORY_COLLECTION)
    .find({ spotifyUserId })
    .sort({ updatedAt: -1 })
    .toArray() as Promise<MaintenanceHistoryEntry[]>;
}

async function clearUserLibraryCollections(spotifyUserId: string, target: "tracks" | "artists" | "albums" | "all") {
  const db = await getDatabase({ forceRetry: true });
  if (!db) {
    return;
  }

  const ops: Promise<unknown>[] = [];
  if (target === "tracks" || target === "all") {
    ops.push(db.collection(USER_TRACK_LIBRARY_COLLECTION).deleteMany({ spotifyUserId }));
  }
  if (target === "artists" || target === "all") {
    ops.push(db.collection(USER_ARTIST_LIBRARY_COLLECTION).deleteMany({ spotifyUserId }));
  }
  if (target === "albums" || target === "all") {
    ops.push(db.collection(USER_ALBUM_LIBRARY_COLLECTION).deleteMany({ spotifyUserId }));
  }
  await Promise.all(ops);
}

async function purgeSyntheticLastFmTrackArtifacts(spotifyUserId: string) {
  const db = await getDatabase({ forceRetry: true });
  if (!db) {
    return;
  }

  await Promise.all([
    db.collection(USER_TRACK_LIBRARY_COLLECTION).deleteMany({
      spotifyUserId,
      $or: [
        { trackId: { $regex: "^lastfm:" } },
        { trackId: { $regex: "^local:" } },
      ],
    }),
    db.collection(TRACK_METADATA_COLLECTION).deleteMany({
      $or: [
        { trackId: { $regex: "^lastfm:" } },
        { trackId: { $regex: "^local:" } },
      ],
    }),
  ]);
}

export async function syncUserLibraryFromRecentPlays(
  spotifyUserId: string,
  target: "tracks" | "artists" | "albums" | "all",
  mode: "full" | "incremental",
  onProgress?: MaintenanceProgressReporter,
) {
  if (!hasMongoConfig()) {
    return { partial: false, processedPlays: 0, lastProcessedPlayedAt: "", buildComplete: true };
  }

  const db = await getDatabase({ forceRetry: true });
  if (!db) {
    return { partial: false, processedPlays: 0, lastProcessedPlayedAt: "", buildComplete: true };
  }

  if (target === "tracks" || target === "all") {
    await purgeSyntheticLastFmTrackArtifacts(spotifyUserId);
  }

  const action = `library:${target}`;
  let state = await readUserLibraryState(spotifyUserId, action);
  if (!state || state.mode !== mode || state.buildComplete || mode === "full" && !state.lastProcessedPlayedAt) {
    if (mode === "full") {
      await clearUserLibraryCollections(spotifyUserId, target);
    }
    const nextLastProcessedPlayedAt = mode === "incremental" ? state?.lastProcessedPlayedAt ?? "" : "";
    state = {
      spotifyUserId,
      action,
      mode,
      lastProcessedPlayedAt: nextLastProcessedPlayedAt,
      buildComplete: false,
      updatedAt: new Date().toISOString(),
    } as UserLibraryStateDoc;
    await writeUserLibraryState(spotifyUserId, action, {
      mode,
      lastProcessedPlayedAt: nextLastProcessedPlayedAt,
      buildComplete: false,
    });
  }

  const startedAt = Date.now();
  let processedPlays = 0;
  let cursor = state?.lastProcessedPlayedAt ?? "";

  while (Date.now() - startedAt < MAX_RUNTIME_MS) {
    const plays = await db.collection<StoredRecentPlay>(RECENT_PLAYS_COLLECTION)
      .find({
        spotifyUserId,
        ...(cursor ? { playedAt: { $gt: cursor } } : {}),
      })
      .sort({ playedAt: 1 })
      .limit(PAGE_SIZE)
      .toArray();

    if (plays.length === 0) {
      await writeUserLibraryState(spotifyUserId, action, {
        mode,
        lastProcessedPlayedAt: cursor,
        buildComplete: true,
      });
      return { partial: false, processedPlays, lastProcessedPlayedAt: cursor, buildComplete: true };
    }

    const eligiblePlays = plays.filter((play) => !isUnresolvedImportedPlay(play));
    const skippedImportedCount = plays.length - eligiblePlays.length;
    await onProgress?.(
      skippedImportedCount > 0
        ? `Processing ${target} library batch ending at ${plays[plays.length - 1]?.playedAt ?? "unknown time"} while skipping ${skippedImportedCount} unresolved Last.fm imports`
        : `Processing ${target} library batch ending at ${plays[plays.length - 1]?.playedAt ?? "unknown time"}`,
    );
    const trackIds = [...new Set(eligiblePlays.map((play) => toSafeTrackId(play)))];
    const metadataByTrackId = await getStoredTrackMetadataMap(trackIds);
    const bulkWrites: Promise<unknown>[] = [];
    if (target === "tracks" || target === "all") {
      const trackOps = buildTrackBulkOps(spotifyUserId, eligiblePlays, metadataByTrackId);
      if (trackOps.length > 0) {
        bulkWrites.push(db.collection(USER_TRACK_LIBRARY_COLLECTION).bulkWrite(trackOps, { ordered: false }));
      }
      await Promise.all(eligiblePlays.slice(0, 25).map((play) => upsertTrackMetadataCacheEntry({
        trackId: toSafeTrackId(play),
        trackName: metadataByTrackId.get(toSafeTrackId(play))?.trackName ?? play.trackName,
        artistName: metadataByTrackId.get(toSafeTrackId(play))?.artistName ?? play.artistName,
        normalizedTrackArtistKey: `${normalizeText(metadataByTrackId.get(toSafeTrackId(play))?.trackName ?? play.trackName)}::${normalizeText(metadataByTrackId.get(toSafeTrackId(play))?.artistName ?? play.artistName)}`,
        normalizedNameKey: `${normalizeText(metadataByTrackId.get(toSafeTrackId(play))?.trackName ?? play.trackName)}::${normalizeText(metadataByTrackId.get(toSafeTrackId(play))?.artistName ?? play.artistName)}::${normalizeText(metadataByTrackId.get(toSafeTrackId(play))?.albumName ?? play.albumName)}`,
        artistNames: metadataByTrackId.get(toSafeTrackId(play))?.artistNames ?? play.artistNames,
        artistIds: metadataByTrackId.get(toSafeTrackId(play))?.artistIds ?? play.artistIds,
        albumId: metadataByTrackId.get(toSafeTrackId(play))?.albumId,
        albumName: metadataByTrackId.get(toSafeTrackId(play))?.albumName ?? play.albumName,
        durationMs: metadataByTrackId.get(toSafeTrackId(play))?.durationMs ?? play.durationMs,
        imageUrl: metadataByTrackId.get(toSafeTrackId(play))?.imageUrl ?? play.imageUrl,
      }).catch(() => undefined)));
    }
    if (target === "artists" || target === "all") {
      const artistOps = buildArtistBulkOps(spotifyUserId, eligiblePlays);
      if (artistOps.length > 0) {
        bulkWrites.push(db.collection(USER_ARTIST_LIBRARY_COLLECTION).bulkWrite(artistOps, { ordered: false }));
      }
    }
    if (target === "albums" || target === "all") {
      const albumOps = buildAlbumBulkOps(spotifyUserId, eligiblePlays, metadataByTrackId);
      if (albumOps.length > 0) {
        bulkWrites.push(db.collection(USER_ALBUM_LIBRARY_COLLECTION).bulkWrite(albumOps, { ordered: false }));
        await upsertAlbumMetadataEntries(albumOps.map((op) => ({
          spotifyUserId,
          albumKey: op.updateOne.filter.albumKey,
          albumId: op.updateOne.update.$set.albumId,
          name: op.updateOne.update.$set.name,
          artistName: op.updateOne.update.$set.artistName,
          artistNames: op.updateOne.update.$set.artistNames,
          artistIds: op.updateOne.update.$set.artistIds,
          imageUrl: op.updateOne.update.$set.imageUrl,
          trackIds: op.updateOne.update.$set.trackIds,
          totalPlayCount: op.updateOne.update.$inc.totalPlayCount,
          lastPlayedAt: op.updateOne.update.$set.lastPlayedAt,
          updatedAt: op.updateOne.update.$set.updatedAt,
        } as UserAlbumLibraryDoc))).catch(() => undefined);
      }
    }
    await Promise.all(bulkWrites);

    processedPlays += eligiblePlays.length;
    cursor = plays[plays.length - 1]?.playedAt ?? cursor;
    await writeUserLibraryState(spotifyUserId, action, {
      mode,
      lastProcessedPlayedAt: cursor,
      buildComplete: false,
    });
  }

  return { partial: true, processedPlays, lastProcessedPlayedAt: cursor, buildComplete: false };
}

async function loadArtistMetadataMapForUser(spotifyUserId: string) {
  const db = await getDatabase({ forceRetry: true });
  if (!db) {
    return new Map<string, { imageUrl?: string; genres?: string[] }>();
  }

  const records = await db.collection<{ artistId: string; imageUrl?: string; genres?: string[] }>(ARTIST_METADATA_COLLECTION)
    .find({})
    .toArray();
  return new Map(records.map((record) => [record.artistId, { imageUrl: record.imageUrl, genres: record.genres }]));
}

export async function buildAllTimeTopListsFromUserLibraries(
  spotifyUserId: string,
  mode: "full" | "incremental",
) {
  if (!hasMongoConfig()) {
    return { partial: false, lastComputedPlayedAt: "" };
  }

  const librarySync = await syncUserLibraryFromRecentPlays(spotifyUserId, "all", mode);
  const db = await getDatabase({ forceRetry: true });
  if (!db) {
    return { partial: librarySync.partial, lastComputedPlayedAt: librarySync.lastProcessedPlayedAt };
  }

  const [tracks, artists, albums, latestPlayedAt, artistMeta] = await Promise.all([
    db.collection<UserTrackLibraryDoc>(USER_TRACK_LIBRARY_COLLECTION).find({ spotifyUserId }).sort({ totalPlayCount: -1, lastPlayedAt: -1 }).limit(50).toArray(),
    db.collection<UserArtistLibraryDoc>(USER_ARTIST_LIBRARY_COLLECTION).find({ spotifyUserId }).sort({ totalPlayCount: -1, lastPlayedAt: -1 }).limit(50).toArray(),
    db.collection<UserAlbumLibraryDoc>(USER_ALBUM_LIBRARY_COLLECTION).find({ spotifyUserId }).sort({ totalPlayCount: -1, lastPlayedAt: -1 }).limit(50).toArray(),
    getLatestPlayedAt(spotifyUserId),
    loadArtistMetadataMapForUser(spotifyUserId),
  ]);

  const data: TopListsData = {
    range: "all",
    sourceLabel: "Listening Lore permanent library counts",
    generatedAt: new Date().toISOString(),
    artists: artists.map((artist, index) => ({
      id: artist.artistId ?? artist.artistKey,
      rank: index + 1,
      name: artist.name,
      genres: artist.artistId ? (artistMeta.get(artist.artistId)?.genres ?? []) : [],
      imageUrl: artist.artistId ? artistMeta.get(artist.artistId)?.imageUrl : artist.imageUrl,
      listenCount: artist.totalPlayCount,
    })),
    tracks: tracks.map((track, index) => ({
      id: track.trackId,
      rank: index + 1,
      title: track.trackName,
      artist: track.artistName,
      album: track.albumName,
      popularity: 0,
      imageUrl: track.imageUrl,
      listenCount: track.totalPlayCount,
    })),
    albums: albums.map((album, index) => ({
      id: album.albumId ?? album.albumKey,
      rank: index + 1,
      name: album.name,
      artist: album.artistName,
      trackCount: 0,
      score: album.totalPlayCount,
      imageUrl: album.imageUrl,
      listenCount: album.totalPlayCount,
    })),
  };

  await writeStoredTopListsSectionEntry(spotifyUserId, "all", data);
  await db.collection<AllTimeTopListsStateDoc>(ALL_TIME_TOP_LISTS_STATE_COLLECTION).updateOne(
    { spotifyUserId },
    {
      $set: {
        spotifyUserId,
        lastComputedPlayedAt: latestPlayedAt,
        mode,
        updatedAt: new Date().toISOString(),
      },
    },
    { upsert: true },
  );

  return { partial: librarySync.partial, lastComputedPlayedAt: latestPlayedAt };
}

async function findCachedTrackByNames(
  spotifyUserId: string,
  play: Pick<StoredRecentPlay, "trackName" | "artistName" | "albumName">,
  preferredPlaylistId?: string,
) {
  const db = await getDatabase({ forceRetry: true });
  if (!db) {
    return null;
  }

  const normalizedTrack = normalizeText(play.trackName);
  const normalizedArtist = normalizeText(play.artistName);
  const normalizedAlbum = normalizeText(play.albumName);

  const recentTrack = await db.collection<UserTrackLibraryDoc>(USER_TRACK_LIBRARY_COLLECTION)
    .find({
      spotifyUserId,
      normalizedTrackArtistKey: `${normalizedTrack}::${normalizedArtist}`,
      trackId: { $regex: "^[A-Za-z0-9]{22}$" },
    })
    .sort({ totalPlayCount: -1, lastPlayedAt: -1 })
    .limit(1)
    .toArray();
  if (recentTrack[0]) {
    return recentTrack[0];
  }

  const globalTracks = await db.collection<{ trackId: string; trackName: string; artistName: string; normalizedTrackArtistKey?: string; normalizedNameKey?: string; albumId?: string; albumName: string; artistNames?: string[]; artistIds?: string[]; imageUrl?: string; durationMs?: number }>(TRACK_METADATA_COLLECTION)
    .find({
      trackId: { $regex: "^[A-Za-z0-9]{22}$" },
      $or: [
        { normalizedNameKey: `${normalizedTrack}::${normalizedArtist}::${normalizedAlbum}` },
        { normalizedTrackArtistKey: `${normalizedTrack}::${normalizedArtist}` },
      ],
    })
    .toArray();

  return globalTracks.find((track) =>
    track.normalizedNameKey === `${normalizedTrack}::${normalizedArtist}::${normalizedAlbum}`,
  ) ?? globalTracks.find((track) =>
    track.normalizedTrackArtistKey === `${normalizedTrack}::${normalizedArtist}`,
  ) ?? await (async () => {
    const playlistTracks = await db.collection<{
      trackId?: string;
      title?: string;
      artistNames?: string[];
      albumName?: string;
      normalizedTrackArtistKey?: string;
      normalizedNameKey?: string;
      imageUrl?: string;
      classification?: string;
    }>(PLAYLIST_TRACK_CACHE_COLLECTION)
      .find({
        spotifyUserId,
        ...(preferredPlaylistId ? { playlistId: preferredPlaylistId } : {}),
        classification: "analyzable",
        $or: [
          { normalizedNameKey: `${normalizedTrack}::${normalizedArtist}::${normalizedAlbum}` },
          { normalizedTrackArtistKey: `${normalizedTrack}::${normalizedArtist}` },
        ],
        trackId: { $regex: "^[A-Za-z0-9]{22}$" },
      })
      .limit(25)
      .toArray();

    const exactPlaylistMatch = playlistTracks.find((track) =>
      track.normalizedNameKey === `${normalizedTrack}::${normalizedArtist}::${normalizedAlbum}`,
    ) ?? playlistTracks.find((track) =>
      track.normalizedTrackArtistKey === `${normalizedTrack}::${normalizedArtist}`,
    );

    if (!exactPlaylistMatch?.trackId || !exactPlaylistMatch.title) {
      return null;
    }

    return {
      trackId: exactPlaylistMatch.trackId,
      trackName: exactPlaylistMatch.title,
      artistName: exactPlaylistMatch.artistNames?.join(", ") ?? play.artistName,
      normalizedTrackArtistKey: exactPlaylistMatch.normalizedTrackArtistKey,
      normalizedNameKey: exactPlaylistMatch.normalizedNameKey,
      artistNames: exactPlaylistMatch.artistNames,
      artistIds: undefined,
      albumId: undefined,
      albumName: exactPlaylistMatch.albumName ?? play.albumName,
      imageUrl: exactPlaylistMatch.imageUrl,
      durationMs: undefined,
    };
  })();
}

type CachedResolutionTrack = {
  trackId: string;
  trackName: string;
  artistName: string;
  normalizedTrackKey?: string;
  normalizedTrackArtistKey?: string;
  normalizedNameKey?: string;
  normalizedArtistKey?: string;
  normalizedAlbumArtistKey?: string;
  artistNames?: string[];
  artistIds?: string[];
  albumId?: string;
  albumName: string;
  imageUrl?: string;
  durationMs?: number;
};

type CachedPlaylistTrackCandidate = {
  playlistId?: string;
  trackId?: string;
  title?: string;
  artistNames?: string[];
  albumName?: string;
  normalizedTrackKey?: string;
  normalizedTrackArtistKey?: string;
  normalizedNameKey?: string;
  normalizedArtistKey?: string;
  normalizedAlbumArtistKey?: string;
  imageUrl?: string;
  classification?: string;
};

type UnresolvedImportGroup = {
  trackName: string;
  artistName: string;
  albumName: string;
  playCount: number;
  latestPlayedAt: string;
  lastfmResolutionAttemptedAt?: string;
  lastfmResolutionSkippedAt?: string;
};

type StoredPlaylistLibraryDoc = {
  spotifyUserId: string;
  id: string;
  name: string;
};

function buildStoredPlayNameKey(play: Pick<StoredRecentPlay, "trackName" | "artistName" | "albumName">) {
  return `${normalizeText(play.trackName)}::${normalizeText(play.artistName)}::${normalizeText(play.albumName)}`;
}

function buildStoredPlayTrackArtistKey(play: Pick<StoredRecentPlay, "trackName" | "artistName">) {
  return `${normalizeText(play.trackName)}::${normalizeText(play.artistName)}`;
}

function buildStoredPlayArtistKey(play: Pick<StoredRecentPlay, "artistName">) {
  return normalizeText(play.artistName);
}

function buildStoredPlayAlbumArtistKey(play: Pick<StoredRecentPlay, "albumName" | "artistName">) {
  return `${normalizeText(play.albumName)}::${normalizeText(play.artistName)}`;
}

function buildUnresolvedImportGroupKey(group: Pick<UnresolvedImportGroup, "trackName" | "artistName" | "albumName">) {
  return `${normalizeText(group.trackName)}::${normalizeText(group.artistName)}::${normalizeText(group.albumName)}`;
}

const KATAKANA_START = 0x30A1;
const KATAKANA_END = 0x30F6;

const JAPANESE_DIGRAPHS: Array<[string, string]> = [
  ["\u304d\u3083", "kya"], ["\u304d\u3085", "kyu"], ["\u304d\u3087", "kyo"],
  ["\u304e\u3083", "gya"], ["\u304e\u3085", "gyu"], ["\u304e\u3087", "gyo"],
  ["\u3057\u3083", "sha"], ["\u3057\u3085", "shu"], ["\u3057\u3087", "sho"],
  ["\u3058\u3083", "ja"], ["\u3058\u3085", "ju"], ["\u3058\u3087", "jo"],
  ["\u3061\u3083", "cha"], ["\u3061\u3085", "chu"], ["\u3061\u3087", "cho"],
  ["\u3062\u3083", "ja"], ["\u3062\u3085", "ju"], ["\u3062\u3087", "jo"],
  ["\u306b\u3083", "nya"], ["\u306b\u3085", "nyu"], ["\u306b\u3087", "nyo"],
  ["\u3072\u3083", "hya"], ["\u3072\u3085", "hyu"], ["\u3072\u3087", "hyo"],
  ["\u3073\u3083", "bya"], ["\u3073\u3085", "byu"], ["\u3073\u3087", "byo"],
  ["\u3074\u3083", "pya"], ["\u3074\u3085", "pyu"], ["\u3074\u3087", "pyo"],
  ["\u307f\u3083", "mya"], ["\u307f\u3085", "myu"], ["\u307f\u3087", "myo"],
  ["\u308a\u3083", "rya"], ["\u308a\u3085", "ryu"], ["\u308a\u3087", "ryo"],
  ["\u3094\u3041", "va"], ["\u3094\u3043", "vi"], ["\u3094\u3047", "ve"], ["\u3094\u3049", "vo"], ["\u3094\u3085", "vyu"],
  ["\u3075\u3041", "fa"], ["\u3075\u3043", "fi"], ["\u3075\u3047", "fe"], ["\u3075\u3049", "fo"], ["\u3075\u3085", "fyu"],
  ["\u3066\u3043", "ti"], ["\u3067\u3043", "di"], ["\u3068\u3045", "tu"], ["\u3069\u3045", "du"],
  ["\u3064\u3041", "tsa"], ["\u3064\u3043", "tsi"], ["\u3064\u3047", "tse"], ["\u3064\u3049", "tso"],
  ["\u3046\u3043", "wi"], ["\u3046\u3047", "we"], ["\u3046\u3049", "wo"],
  ["\u3057\u3047", "she"], ["\u3058\u3047", "je"], ["\u3061\u3047", "che"],
];

const JAPANESE_MONOGRAPHS = new Map<string, string>([
  ["\u3042", "a"], ["\u3044", "i"], ["\u3046", "u"], ["\u3048", "e"], ["\u304a", "o"],
  ["\u304b", "ka"], ["\u304d", "ki"], ["\u304f", "ku"], ["\u3051", "ke"], ["\u3053", "ko"],
  ["\u304c", "ga"], ["\u304e", "gi"], ["\u3050", "gu"], ["\u3052", "ge"], ["\u3054", "go"],
  ["\u3055", "sa"], ["\u3057", "shi"], ["\u3059", "su"], ["\u305b", "se"], ["\u305d", "so"],
  ["\u3056", "za"], ["\u3058", "ji"], ["\u305a", "zu"], ["\u305c", "ze"], ["\u305e", "zo"],
  ["\u305f", "ta"], ["\u3061", "chi"], ["\u3064", "tsu"], ["\u3066", "te"], ["\u3068", "to"],
  ["\u3060", "da"], ["\u3062", "ji"], ["\u3065", "zu"], ["\u3067", "de"], ["\u3069", "do"],
  ["\u306a", "na"], ["\u306b", "ni"], ["\u306c", "nu"], ["\u306d", "ne"], ["\u306e", "no"],
  ["\u306f", "ha"], ["\u3072", "hi"], ["\u3075", "fu"], ["\u3078", "he"], ["\u307b", "ho"],
  ["\u3070", "ba"], ["\u3073", "bi"], ["\u3076", "bu"], ["\u3079", "be"], ["\u307c", "bo"],
  ["\u3071", "pa"], ["\u3074", "pi"], ["\u3077", "pu"], ["\u307a", "pe"], ["\u307d", "po"],
  ["\u307e", "ma"], ["\u307f", "mi"], ["\u3080", "mu"], ["\u3081", "me"], ["\u3082", "mo"],
  ["\u3084", "ya"], ["\u3086", "yu"], ["\u3088", "yo"],
  ["\u3089", "ra"], ["\u308a", "ri"], ["\u308b", "ru"], ["\u308c", "re"], ["\u308d", "ro"],
  ["\u308f", "wa"], ["\u3092", "o"], ["\u3093", "n"],
  ["\u3041", "a"], ["\u3043", "i"], ["\u3045", "u"], ["\u3047", "e"], ["\u3049", "o"],
  ["\u3083", "ya"], ["\u3085", "yu"], ["\u3087", "yo"],
  ["\u308e", "wa"], ["\u3094", "vu"],
]);

function toHiragana(value: string) {
  return [...value].map((character) => {
    const code = character.charCodeAt(0);
    if (code >= KATAKANA_START && code <= KATAKANA_END) {
      return String.fromCharCode(code - 0x60);
    }
    return character;
  }).join("");
}

function getLastRomanizedVowel(value: string) {
  const match = value.match(/[aeiou](?!.*[aeiou])/);
  return match?.[0] ?? "";
}

function romanizeJapaneseKana(value: string) {
  const hiraganaValue = toHiragana(value.normalize("NFKC"));
  let output = "";

  for (let index = 0; index < hiraganaValue.length; index += 1) {
    const digraph = hiraganaValue.slice(index, index + 2);
    const digraphMatch = JAPANESE_DIGRAPHS.find(([kana]) => kana === digraph)?.[1];
    if (digraphMatch) {
      output += digraphMatch;
      index += 1;
      continue;
    }

    const character = hiraganaValue[index];

    if (character === "\u3063") {
      const nextDigraph = hiraganaValue.slice(index + 1, index + 3);
      const nextDigraphMatch = JAPANESE_DIGRAPHS.find(([kana]) => kana === nextDigraph)?.[1];
      const nextSingleMatch = JAPANESE_MONOGRAPHS.get(hiraganaValue[index + 1] ?? "");
      const nextSound = nextDigraphMatch ?? nextSingleMatch ?? "";
      if (nextSound) {
        output += nextSound[0];
      }
      continue;
    }

    if (character === "\u30fc") {
      output += getLastRomanizedVowel(output);
      continue;
    }

    output += JAPANESE_MONOGRAPHS.get(character) ?? character;
  }

  return output;
}

function scoreCachedResolutionCandidate(
  group: Pick<UnresolvedImportGroup, "trackName" | "artistName" | "albumName">,
  candidate: CachedResolutionTrack,
  preferredPlaylistId?: string,
  sameAlbumArtistCandidateCount = 0,
) {
  const titleScore = computeLooseFieldScore(candidate.trackName, group.trackName);
  const artistScore = computeLooseFieldScore(candidate.artistName, group.artistName);
  const albumScore = computeLooseFieldScore(candidate.albumName, group.albumName);
  const score = titleScore * 0.5 + artistScore * 0.3 + albumScore * 0.2;
  const isNonLatinTrackQuery = containsNonLatinCharacters(group.trackName);
  const hasExactTrackTitle = titleScore >= 0.99;
  const scriptMismatch = containsNonLatinCharacters(candidate.trackName) !== isNonLatinTrackQuery;
  const romanizedTitleScore = computeTokenOverlapScore(
    normalizeLooseText(romanizeJapaneseKana(candidate.trackName)),
    normalizeLooseText(romanizeJapaneseKana(group.trackName)),
  );
  const accepted =
    (titleScore >= 0.95 && albumScore >= 0.8 && score >= 0.68) ||
    (isNonLatinTrackQuery && titleScore >= 0.99 && score >= 0.48) ||
    (romanizedTitleScore >= 0.94 && artistScore >= 0.58 && score >= 0.44) ||
    (titleScore >= 0.9 && artistScore >= 0.58 && score >= 0.74 && albumScore >= 0.2) ||
    (hasExactTrackTitle && (artistScore >= 0.3 || albumScore >= 0.3) && score >= 0.58) ||
    (preferredPlaylistId && scriptMismatch && sameAlbumArtistCandidateCount === 1 && artistScore >= 0.95 && albumScore >= 0.95) ||
    (preferredPlaylistId && hasExactTrackTitle && (artistScore >= 0.18 || albumScore >= 0.18) && score >= 0.48);

  return {
    accepted,
    score,
    titleScore,
    artistScore,
    albumScore,
    romanizedTitleScore,
  };
}

async function getCachedTrackMatchesForGroups(
  db: Awaited<ReturnType<typeof getDatabase>>,
  spotifyUserId: string,
  groups: Array<Pick<UnresolvedImportGroup, "trackName" | "artistName" | "albumName">>,
  preferredPlaylistId?: string,
  preloadedSelectedPlaylistTracks?: CachedPlaylistTrackCandidate[],
) {
  if (!db || groups.length === 0) {
    return new Map<string, CachedResolutionTrack>();
  }

  const uniqueNameKeys = [...new Set(groups.map((group) => buildStoredPlayNameKey(group)))];
  const uniqueTrackArtistKeys = [...new Set(groups.map((group) => buildStoredPlayTrackArtistKey(group)))];
  const uniqueTrackKeys = [...new Set(groups.map((group) => normalizeText(group.trackName)))];
  const uniqueArtistKeys = [...new Set(groups.map((group) => buildStoredPlayArtistKey(group)))];
  const uniqueAlbumArtistKeys = [...new Set(groups.map((group) => buildStoredPlayAlbumArtistKey(group)))];

  const [libraryTracks, globalTracks, playlistTracksFromDb] = await Promise.all([
    db.collection<UserTrackLibraryDoc>(USER_TRACK_LIBRARY_COLLECTION)
      .find({
        spotifyUserId,
        trackId: { $regex: "^[A-Za-z0-9]{22}$" },
        $or: [
          { normalizedNameKey: { $in: uniqueNameKeys } },
          { normalizedTrackArtistKey: { $in: uniqueTrackArtistKeys } },
        ],
      })
      .sort({ totalPlayCount: -1, lastPlayedAt: -1 })
      .toArray(),
    db.collection<CachedResolutionTrack>(TRACK_METADATA_COLLECTION)
      .find({
        trackId: { $regex: "^[A-Za-z0-9]{22}$" },
        $or: [
          { normalizedNameKey: { $in: uniqueNameKeys } },
          { normalizedTrackArtistKey: { $in: uniqueTrackArtistKeys } },
        ],
      })
      .toArray(),
    preloadedSelectedPlaylistTracks
      ? Promise.resolve([] as CachedPlaylistTrackCandidate[])
      : db.collection<CachedPlaylistTrackCandidate>(PLAYLIST_TRACK_CACHE_COLLECTION)
        .find({
          spotifyUserId,
          ...(preferredPlaylistId ? { playlistId: preferredPlaylistId } : {}),
          classification: "analyzable",
          trackId: { $regex: "^[A-Za-z0-9]{22}$" },
          $or: [
            { normalizedTrackKey: { $in: uniqueTrackKeys } },
            { normalizedNameKey: { $in: uniqueNameKeys } },
            { normalizedTrackArtistKey: { $in: uniqueTrackArtistKeys } },
            { normalizedArtistKey: { $in: uniqueArtistKeys } },
            { normalizedAlbumArtistKey: { $in: uniqueAlbumArtistKeys } },
          ],
        })
        .toArray(),
  ]);
  const playlistTracks = preloadedSelectedPlaylistTracks ?? playlistTracksFromDb;

  const byExactNameKey = new Map<string, CachedResolutionTrack>();
  const byTrackArtistKey = new Map<string, CachedResolutionTrack>();

  const applyCandidate = (candidate: CachedResolutionTrack) => {
    if (candidate.normalizedNameKey && !byExactNameKey.has(candidate.normalizedNameKey)) {
      byExactNameKey.set(candidate.normalizedNameKey, candidate);
    }
    if (candidate.normalizedTrackArtistKey && !byTrackArtistKey.has(candidate.normalizedTrackArtistKey)) {
      byTrackArtistKey.set(candidate.normalizedTrackArtistKey, candidate);
    }
  };

  libraryTracks.forEach((candidate) => applyCandidate(candidate));
  globalTracks.forEach((candidate) => applyCandidate(candidate));
  playlistTracks
    .filter((candidate): candidate is typeof candidate & { trackId: string; title: string } => Boolean(candidate.trackId && candidate.title))
    .forEach((candidate) => {
      applyCandidate({
        trackId: candidate.trackId,
        playlistId: candidate.playlistId,
        trackName: candidate.title,
        artistName: candidate.artistNames?.join(", ") ?? "",
        normalizedTrackKey: candidate.normalizedTrackKey ?? normalizeText(candidate.title),
        normalizedTrackArtistKey: candidate.normalizedTrackArtistKey,
        normalizedNameKey: candidate.normalizedNameKey,
        normalizedArtistKey: candidate.normalizedArtistKey,
        normalizedAlbumArtistKey: candidate.normalizedAlbumArtistKey,
        artistNames: candidate.artistNames,
        artistIds: undefined,
        albumId: undefined,
        albumName: candidate.albumName ?? "",
        imageUrl: candidate.imageUrl,
        durationMs: undefined,
      });
    });

  const resolved = new Map<string, CachedResolutionTrack>();
  for (const group of groups) {
    const exactKey = buildStoredPlayNameKey(group);
    const trackArtistKey = buildStoredPlayTrackArtistKey(group);
    const exactMatch = byExactNameKey.get(exactKey) ?? byTrackArtistKey.get(trackArtistKey);
    if (exactMatch) {
      resolved.set(buildUnresolvedImportGroupKey(group), exactMatch);
      continue;
    }

    const normalizedTrackKey = normalizeText(group.trackName);
    const normalizedArtistKey = buildStoredPlayArtistKey(group);
    const normalizedAlbumArtistKey = buildStoredPlayAlbumArtistKey(group);
    const playlistCandidates = playlistTracks
      .filter((candidate): candidate is typeof candidate & { trackId: string; title: string } =>
        Boolean(candidate.trackId && candidate.title) && (
          (candidate.normalizedTrackKey ?? normalizeText(candidate.title ?? "")) === normalizedTrackKey ||
          candidate.normalizedTrackArtistKey === trackArtistKey ||
          candidate.normalizedNameKey === exactKey ||
          candidate.normalizedArtistKey === normalizedArtistKey ||
          candidate.normalizedAlbumArtistKey === normalizedAlbumArtistKey
        ),
      )
      .map((candidate) => {
        const title = candidate.title ?? "";
        return ({
        trackId: candidate.trackId,
        trackName: title,
        artistName: candidate.artistNames?.join(", ") ?? "",
        normalizedTrackKey: candidate.normalizedTrackKey ?? normalizeText(title),
        normalizedTrackArtistKey: candidate.normalizedTrackArtistKey,
        normalizedNameKey: candidate.normalizedNameKey,
        normalizedArtistKey: candidate.normalizedArtistKey,
        normalizedAlbumArtistKey: candidate.normalizedAlbumArtistKey,
        artistNames: candidate.artistNames,
        artistIds: undefined,
        albumId: undefined,
        albumName: candidate.albumName ?? "",
        imageUrl: candidate.imageUrl,
        durationMs: undefined,
      } satisfies CachedResolutionTrack);
      });
    const sameAlbumArtistCandidateCount = playlistCandidates.filter((candidate) => candidate.normalizedAlbumArtistKey === normalizedAlbumArtistKey).length;

    let bestCandidate: CachedResolutionTrack | undefined;
    let bestScore = 0;
    for (const candidate of playlistCandidates) {
      const scored = scoreCachedResolutionCandidate(group, candidate, preferredPlaylistId, sameAlbumArtistCandidateCount);
      if (!scored.accepted || scored.score <= bestScore) {
        continue;
      }
      bestCandidate = candidate;
      bestScore = scored.score;
    }

    const match = bestCandidate;
    if (match) {
      resolved.set(buildUnresolvedImportGroupKey(group), match);
    }
  }

  return resolved;
}

export async function listCachedResolutionSuggestionsForImportedGroup(
  spotifyUserId: string,
  group: Pick<UnresolvedImportGroup, "trackName" | "artistName" | "albumName">,
  options?: {
    preferredPlaylistId?: string;
    limit?: number;
  },
) {
  if (!hasMongoConfig()) {
    return [] as CachedLastFmResolutionSuggestion[];
  }

  const db = await getDatabase({ forceRetry: true });
  if (!db) {
    return [] as CachedLastFmResolutionSuggestion[];
  }

  const preferredPlaylistId = options?.preferredPlaylistId;
  const limit = Math.max(1, Math.min(options?.limit ?? 5, 10));
  const exactKey = buildStoredPlayNameKey(group);
  const trackArtistKey = buildStoredPlayTrackArtistKey(group);
  const normalizedTrackKey = normalizeText(group.trackName);
  const normalizedArtistKey = buildStoredPlayArtistKey(group);
  const normalizedAlbumArtistKey = buildStoredPlayAlbumArtistKey(group);
  const artistNameTokens = group.artistName.split(/,\s*/).map((token) => token.trim()).filter(Boolean);

  const [libraryTracks, globalTracks, playlistTracks] = await Promise.all([
    db.collection<UserTrackLibraryDoc>(USER_TRACK_LIBRARY_COLLECTION)
      .find({
        spotifyUserId,
        trackId: { $regex: "^[A-Za-z0-9]{22}$" },
        $or: [
          { normalizedNameKey: exactKey },
          { normalizedTrackArtistKey: trackArtistKey },
        ],
      })
      .sort({ totalPlayCount: -1, lastPlayedAt: -1 })
      .limit(limit)
      .toArray(),
    db.collection<CachedResolutionTrack>(TRACK_METADATA_COLLECTION)
      .find({
        trackId: { $regex: "^[A-Za-z0-9]{22}$" },
        $or: [
          { normalizedNameKey: exactKey },
          { normalizedTrackArtistKey: trackArtistKey },
        ],
      })
      .limit(limit)
      .toArray(),
    db.collection<CachedPlaylistTrackCandidate>(PLAYLIST_TRACK_CACHE_COLLECTION)
      .find({
        spotifyUserId,
        ...(preferredPlaylistId ? { playlistId: preferredPlaylistId } : {}),
        classification: "analyzable",
        trackId: { $regex: "^[A-Za-z0-9]{22}$" },
        $or: [
          { normalizedTrackKey: normalizedTrackKey },
          { normalizedNameKey: exactKey },
          { normalizedTrackArtistKey: trackArtistKey },
          { normalizedArtistKey: normalizedArtistKey },
          { normalizedAlbumArtistKey: normalizedAlbumArtistKey },
          { albumName: group.albumName },
          ...(artistNameTokens.length > 0 ? [{ artistNames: { $in: artistNameTokens } }] : []),
        ],
      })
      .limit(50)
      .toArray(),
  ]);
  const playlistIds = [...new Set(
    playlistTracks
      .map((candidate) => candidate.playlistId)
      .filter((playlistId): playlistId is string => Boolean(playlistId)),
  )];
  const playlistNamesById = playlistIds.length > 0
    ? new Map(
      (await db.collection<StoredPlaylistLibraryDoc>("spotify_playlist_library")
        .find({
          spotifyUserId,
          id: { $in: playlistIds },
        })
        .project({ _id: 0, id: 1, name: 1, spotifyUserId: 1 })
        .toArray())
        .map((playlist) => [playlist.id, playlist.name]),
    )
    : new Map<string, string>();

  const playlistResolutionCandidates = playlistTracks
    .filter((candidate): candidate is typeof candidate & { trackId: string; title: string } => Boolean(candidate.trackId && candidate.title))
    .map((candidate) => ({
      playlistId: candidate.playlistId,
      trackId: candidate.trackId,
      trackName: candidate.title,
      artistName: candidate.artistNames?.join(", ") ?? "",
      normalizedTrackKey: candidate.normalizedTrackKey ?? normalizeText(candidate.title),
      normalizedTrackArtistKey: candidate.normalizedTrackArtistKey,
      normalizedNameKey: candidate.normalizedNameKey,
      normalizedArtistKey: candidate.normalizedArtistKey,
      normalizedAlbumArtistKey: candidate.normalizedAlbumArtistKey,
      artistNames: candidate.artistNames,
      artistIds: undefined,
      albumId: undefined,
      albumName: candidate.albumName ?? "",
      imageUrl: candidate.imageUrl,
      durationMs: undefined,
      playlistName: candidate.playlistId ? playlistNamesById.get(candidate.playlistId) : undefined,
      source: "playlist-cache" as const,
    }));

  const sameAlbumArtistCandidateCount = playlistResolutionCandidates
    .filter((candidate) => candidate.normalizedAlbumArtistKey === normalizedAlbumArtistKey)
    .length;

  const mergedCandidates = [
    ...libraryTracks.map((candidate) => ({ ...candidate, source: "track-library" as const })),
    ...globalTracks.map((candidate) => ({ ...candidate, source: "track-metadata" as const })),
    ...playlistResolutionCandidates,
  ];

  const deduped = new Map<string, CachedLastFmResolutionSuggestion>();
  for (const candidate of mergedCandidates) {
    if (!candidate.trackId) {
      continue;
    }

    const scored = scoreCachedResolutionCandidate(group, candidate, preferredPlaylistId, sameAlbumArtistCandidateCount);
    const isExactCacheHit =
      candidate.normalizedNameKey === exactKey ||
      candidate.normalizedTrackArtistKey === trackArtistKey;
    if (!scored.accepted && !isExactCacheHit) {
      continue;
    }

    const suggestion: CachedLastFmResolutionSuggestion = {
      trackId: candidate.trackId,
      trackName: candidate.trackName,
      artistName: candidate.artistName,
      artistNames: candidate.artistNames,
      albumName: candidate.albumName,
      imageUrl: candidate.imageUrl,
      playlistId: "playlistId" in candidate ? candidate.playlistId : undefined,
      playlistName: "playlistName" in candidate ? candidate.playlistName : undefined,
      score: scored.score,
      titleScore: scored.titleScore,
      artistScore: scored.artistScore,
      albumScore: scored.albumScore,
      romanizedTitleScore: scored.romanizedTitleScore,
      source: candidate.source,
    };

    const existing = deduped.get(candidate.trackId);
    if (!existing || suggestion.score > existing.score) {
      deduped.set(candidate.trackId, suggestion);
    }
  }

  return [...deduped.values()]
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      if (right.romanizedTitleScore !== left.romanizedTitleScore) {
        return right.romanizedTitleScore - left.romanizedTitleScore;
      }
      return right.titleScore - left.titleScore;
    })
    .slice(0, limit);
}

export async function normalizeImportedLastFmWithPermanentCache(
  spotifyUserId: string,
  accessToken: string,
  onProgress?: MaintenanceProgressReporter,
  profile: RetryUnresolvedBatchProfile = "balanced",
  preferredPlaylistId?: string,
) {
  const profileSettings = {
    "cache-only": {
      prepassPlayLimit: 3000,
      distinctTrackLimit: 3000,
      perTrackTimeoutMs: 0,
      maxRuntimeMs: 0,
      interTrackDelayMs: 0,
      skipSpotifyLookup: true,
      prepassMaxRuntimeMs: 240_000,
      prepassBatchSize: 250,
    },
    conservative: {
      prepassPlayLimit: 120,
      distinctTrackLimit: 25,
      perTrackTimeoutMs: 2200,
      maxRuntimeMs: 20_000,
      interTrackDelayMs: 0,
      skipSpotifyLookup: false,
      prepassMaxRuntimeMs: 60_000,
      prepassBatchSize: 80,
    },
    balanced: {
      prepassPlayLimit: 240,
      distinctTrackLimit: 100,
      perTrackTimeoutMs: 2500,
      maxRuntimeMs: 45_000,
      interTrackDelayMs: 0,
      skipSpotifyLookup: false,
      prepassMaxRuntimeMs: 90_000,
      prepassBatchSize: 120,
    },
    aggressive: {
      prepassPlayLimit: 500,
      distinctTrackLimit: 250,
      perTrackTimeoutMs: 2800,
      maxRuntimeMs: 180_000,
      interTrackDelayMs: 125,
      skipSpotifyLookup: false,
      prepassMaxRuntimeMs: 120_000,
      prepassBatchSize: 150,
    },
    "very-aggressive": {
      prepassPlayLimit: 1200,
      distinctTrackLimit: 500,
      perTrackTimeoutMs: 3000,
      maxRuntimeMs: 240_000,
      interTrackDelayMs: 250,
      skipSpotifyLookup: false,
      prepassMaxRuntimeMs: 150_000,
      prepassBatchSize: 200,
    },
  }[profile];

  let preResolvedCount = 0;
  let prepassStoppedEarly = false;
  let prepassProcessedGroupCount = 0;
  let prepassResolvedPlayCount = 0;
  let prepassStopDetail: string | undefined;
  let playlistCacheDetail: string | undefined;
  const db = await getDatabase({ forceRetry: true });
  let preloadedSelectedPlaylistTracks: CachedPlaylistTrackCandidate[] | undefined;
  if (preferredPlaylistId) {
    await onProgress?.("Syncing selected playlist track cache before normalization");
    const syncResult = await ensureStoredPlaylistTrackCache(accessToken, spotifyUserId, preferredPlaylistId, {
      maxPages: profile === "cache-only" ? 20 : 4,
    }).catch(() => undefined);
    const diagnostics = await getStoredPlaylistTrackDiagnostics(
      spotifyUserId,
      preferredPlaylistId,
      syncResult?.totalTracks ?? 0,
    ).catch(() => undefined);
    if (diagnostics) {
      playlistCacheDetail = `Selected playlist cache: ${diagnostics.analyzableTracks}/${diagnostics.totalItems || diagnostics.fetchedItems || 0} analyzable tracks stored${diagnostics.completed ? " (complete)" : " (partial cache so far)"}.`;
    }
    if (db) {
      preloadedSelectedPlaylistTracks = await db.collection<CachedPlaylistTrackCandidate>(PLAYLIST_TRACK_CACHE_COLLECTION)
        .find({
          spotifyUserId,
          playlistId: preferredPlaylistId,
          classification: "analyzable",
          trackId: { $regex: "^[A-Za-z0-9]{22}$" },
        })
        .project({
          _id: 0,
          trackId: 1,
          title: 1,
          artistNames: 1,
          albumName: 1,
          normalizedTrackKey: 1,
          normalizedTrackArtistKey: 1,
          normalizedNameKey: 1,
          normalizedArtistKey: 1,
          normalizedAlbumArtistKey: 1,
          imageUrl: 1,
          classification: 1,
        })
        .toArray()
        .catch(() => [] as CachedPlaylistTrackCandidate[]);
    }
  }
  if (db) {
    try {
      const unresolvedSeedGroups: UnresolvedImportGroup[] = await db.collection<StoredRecentPlay>(RECENT_PLAYS_COLLECTION)
        .aggregate<UnresolvedImportGroup>([
          {
            $match: {
              $and: [
                {
                  spotifyUserId,
                  sourceType: "lastfm_import",
                },
                {
                  $or: [
                    { lastfmResolutionSkippedAt: { $exists: false } },
                    { lastfmResolutionSkippedAt: "" },
                  ],
                },
                {
                  $or: [
                    { trackId: { $regex: "^lastfm:" } },
                    { trackId: { $regex: "^local:" } },
                    { trackId: { $exists: false } },
                    { trackId: "" },
                  ],
                },
              ],
            },
          },
          {
            $group: {
              _id: {
                trackName: "$trackName",
                artistName: "$artistName",
                albumName: "$albumName",
              },
              playCount: { $sum: 1 },
              latestPlayedAt: { $max: "$playedAt" },
              lastfmResolutionAttemptedAt: { $min: "$lastfmResolutionAttemptedAt" },
              lastfmResolutionSkippedAt: { $max: "$lastfmResolutionSkippedAt" },
            },
          },
          {
            $sort: {
              lastfmResolutionAttemptedAt: 1,
              latestPlayedAt: -1,
            },
          },
          {
            $project: {
              _id: 0,
              trackName: "$_id.trackName",
              artistName: "$_id.artistName",
              albumName: "$_id.albumName",
              playCount: 1,
              latestPlayedAt: 1,
              lastfmResolutionAttemptedAt: 1,
              lastfmResolutionSkippedAt: 1,
            },
          },
        ])
        .limit(profileSettings.prepassPlayLimit)
        .toArray();

      const prepassStartedAt = Date.now();
      for (let index = 0; index < unresolvedSeedGroups.length; index += profileSettings.prepassBatchSize) {
        if (Date.now() - prepassStartedAt >= profileSettings.prepassMaxRuntimeMs) {
          prepassStoppedEarly = true;
          prepassStopDetail = `Saved partial cached-track matches after ${preResolvedCount} matched groups. Run it again to continue from the smaller remaining set.`;
          await onProgress?.(prepassStopDetail);
          break;
        }

        const batch: UnresolvedImportGroup[] = unresolvedSeedGroups.slice(index, index + profileSettings.prepassBatchSize);
        if (batch.length === 0) {
          continue;
        }

        prepassProcessedGroupCount += batch.length;
        await onProgress?.(`Checking cached libraries and playlist tracks for unresolved groups ${index + 1}-${index + batch.length}`);

        const cachedMatches = await getCachedTrackMatchesForGroups(
          db,
          spotifyUserId,
          batch,
          preferredPlaylistId,
          preloadedSelectedPlaylistTracks,
        );
        const matchedEntries = batch
          .map((group: UnresolvedImportGroup) => ({ group, cached: cachedMatches.get(buildUnresolvedImportGroupKey(group)) }))
          .filter((entry): entry is { group: UnresolvedImportGroup; cached: CachedResolutionTrack } => Boolean(entry.cached && isSpotifyTrackId(entry.cached.trackId)));

        if (matchedEntries.length === 0) {
          continue;
        }

        const matchingPlays: WithId<StoredRecentPlay>[] = await db.collection<StoredRecentPlay>(RECENT_PLAYS_COLLECTION)
          .find({
            spotifyUserId,
            sourceType: "lastfm_import",
            $or: matchedEntries.map(({ group }) => ({
              trackName: group.trackName,
              artistName: group.artistName,
              albumName: group.albumName,
            })),
          })
          .toArray();

        const groupMatchMap = new Map(
          matchedEntries.map(({ group, cached }) => [buildUnresolvedImportGroupKey(group), cached]),
        );

        const eligiblePlays = matchingPlays
          .map((play) => ({ play, cached: groupMatchMap.get(buildStoredPlayNameKey(play)) }))
          .filter((entry): entry is { play: WithId<StoredRecentPlay>; cached: CachedResolutionTrack } => Boolean(entry.cached));

        if (eligiblePlays.length === 0) {
          continue;
        }

        preResolvedCount += matchedEntries.length;
        prepassResolvedPlayCount += eligiblePlays.length;

        const playedAtValues: string[] = [...new Set(eligiblePlays.map((entry) => entry.play.playedAt))];
        const resolvedTrackIds: string[] = [...new Set(eligiblePlays.map((entry) => entry.cached.trackId))];
        const existingResolvedPlays = await db.collection<StoredRecentPlay>(RECENT_PLAYS_COLLECTION)
          .find({
            spotifyUserId,
            playedAt: { $in: playedAtValues },
            trackId: { $in: resolvedTrackIds },
          })
          .toArray();
        const existingByKey = new Map(existingResolvedPlays.map((play) => [`${play.playedAt}::${play.trackId}`, play]));
        const seenResolvedKeys = new Set<string>();

        const bulkOps = eligiblePlays.map(({ play, cached }: { play: WithId<StoredRecentPlay>; cached: CachedResolutionTrack }) => {
          const resolvedKey = `${play.playedAt}::${cached.trackId}`;
          const conflictingResolvedPlay = existingByKey.get(resolvedKey);

          if (conflictingResolvedPlay && String(conflictingResolvedPlay._id) !== String(play._id)) {
            return {
              deleteOne: {
                filter: { _id: play._id },
              },
            };
          }

          if (seenResolvedKeys.has(resolvedKey)) {
            return {
              deleteOne: {
                filter: { _id: play._id },
              },
            };
          }

          seenResolvedKeys.add(resolvedKey);

          return {
            updateOne: {
              filter: { _id: play._id },
              update: {
                $set: {
                  trackId: cached.trackId,
                  trackName: cached.trackName,
                  artistName: cached.artistName,
                  artistNames: cached.artistNames,
                  artistIds: cached.artistIds,
                  albumName: cached.albumName,
                  durationMs: cached.durationMs,
                  imageUrl: cached.imageUrl,
                },
              },
            },
          };
        });

        if (bulkOps.length > 0) {
          await db.collection<StoredRecentPlay>(RECENT_PLAYS_COLLECTION).bulkWrite(bulkOps, { ordered: false });
        }

        const uniqueCachedMatches: CachedResolutionTrack[] = [...new Map<string, CachedResolutionTrack>(eligiblePlays.map(({ cached }) => [cached.trackId, cached])).values()];
        await Promise.all(
          uniqueCachedMatches.map((cached: CachedResolutionTrack) =>
            upsertTrackMetadataCacheEntry({
              trackId: cached.trackId,
              trackName: cached.trackName,
              artistName: cached.artistName,
              artistNames: cached.artistNames,
              artistIds: cached.artistIds,
              albumId: cached.albumId,
              albumName: cached.albumName,
              durationMs: cached.durationMs,
              imageUrl: cached.imageUrl,
            }).catch(() => undefined),
          ),
        );
      }

      if (preResolvedCount > 0) {
        await onProgress?.(`Resolved ${preResolvedCount} unresolved song groups from permanent libraries and playlist cache before any Spotify lookup`);
      }
    } catch (error) {
      if (!isMongoTimeoutError(error)) {
        throw error;
      }

      prepassStoppedEarly = true;
      prepassStopDetail = `Mongo timed out during cached-track matching. Saved progress from completed batches and stopped early so you can continue from a smaller remaining set.`;
      await onProgress?.(prepassStopDetail);
    }
  }

  if (profileSettings.skipSpotifyLookup) {
    return {
      scannedTrackGroups: prepassProcessedGroupCount,
      processedTrackGroups: prepassProcessedGroupCount,
      matchedTrackGroups: preResolvedCount,
      unresolvedTrackGroups: Math.max(0, prepassProcessedGroupCount - preResolvedCount),
      updatedPlayCount: prepassResolvedPlayCount,
      deletedDuplicatePlayCount: 0,
      timedOutTrackGroups: 0,
      stoppedEarly: prepassStoppedEarly,
      processedNameKeys: [],
      debugSummary: [
        `Pre-resolved from permanent libraries / playlist cache: ${preResolvedCount}.`,
        `Scanned ${prepassProcessedGroupCount} unresolved song groups in cache-only mode.`,
        `Matched from cache: ${preResolvedCount} groups affecting ${prepassResolvedPlayCount} plays. Remaining in scanned batch: ${Math.max(0, prepassProcessedGroupCount - preResolvedCount)} groups.`,
        prepassStoppedEarly
          ? (prepassStopDetail ?? `Stopped early because the cache-only runtime budget (${Math.round(profileSettings.prepassMaxRuntimeMs / 1000)}s) was reached.`)
          : "Cache-only pass finished its local batch.",
        preferredPlaylistId
          ? "Playlist source restriction: selected playlist only."
          : "Playlist source restriction: all cached playlists.",
        playlistCacheDetail,
        "Spotify lookup mode: disabled (cache-only pass).",
      ].join("\n"),
    };
  }

  const result = await normalizeImportedLastFmScrobbles(spotifyUserId, accessToken, {
    limitDistinctTracks: profileSettings.distinctTrackLimit,
    perTrackTimeoutMs: profileSettings.perTrackTimeoutMs,
    maxRuntimeMs: profileSettings.maxRuntimeMs,
    interTrackDelayMs: profileSettings.interTrackDelayMs,
    skipSpotifyLookup: profileSettings.skipSpotifyLookup,
    onProgress,
  });

  if (preResolvedCount > 0 || prepassStoppedEarly) {
    result.debugSummary = [
      `Pre-resolved from permanent libraries / playlist cache: ${preResolvedCount}.`,
      `Cache prepass scanned ${prepassProcessedGroupCount} unresolved song groups${prepassStoppedEarly ? " before stopping early on its own runtime budget" : ""}.`,
      playlistCacheDetail ?? "",
      result.debugSummary ?? "",
    ].filter(Boolean).join("\n");
  }

  return result;
}

export async function runDashboardMaintenanceAction(
  action: MaintenanceAction,
  spotifyUserId: string,
  accessToken: string,
  onProgress?: MaintenanceProgressReporter,
  options?: {
    retryProfile?: RetryUnresolvedBatchProfile;
    playlistId?: string;
  },
) {
  if (action === "rebuild-playlist-cache") {
    await onProgress?.("Rebuilding playlist section cache");
    await writeStoredPlaylistsSectionCache(spotifyUserId);
    return { partial: false };
  }

  if (action === "rebuild-overview-cache") {
    await writeStoredDashboardOverviewCache(spotifyUserId, accessToken, undefined, {
      allowLiveEnrichment: false,
      includeTopLists: false,
      onProgress,
    });
    return { partial: false };
  }

  if (action === "rebuild-top-list-caches") {
    invalidateDashboardSectionRuntimeCache(spotifyUserId);
    await writeStoredDashboardSectionCache(spotifyUserId, {
      accessToken,
      includeRediscovery: false,
      includeAnalysis: false,
      includeAllTimeAnalysis: false,
      includeAllTimeTopLists: false,
      onProgress,
    });
    return { partial: false };
  }

  if (action === "backfill-artist-metadata") {
    const count = await backfillMissingArtistMetadataForUser(spotifyUserId, accessToken);
    return { partial: false, count };
  }

  if (action === "delete-lastfm-imports") {
    const result = await deleteImportedLastFmScrobbles(spotifyUserId);
    await refreshLastFmImportCaches(spotifyUserId, accessToken).catch(() => undefined);
    return { partial: false, ...result };
  }

  if (action === "delete-unresolved-lastfm-imports") {
    const result = await deleteUnresolvedImportedLastFmScrobbles(spotifyUserId);
    return { partial: false, ...result };
  }

  if (action === "delete-non-spotify-track-metadata") {
    if (!hasMongoConfig()) {
      return { partial: false, deletedCount: 0 };
    }

    const db = await getDatabase({ forceRetry: true });
    if (!db) {
      return { partial: false, deletedCount: 0 };
    }

    await onProgress?.("Deleting non-Spotify track metadata records from the permanent track cache");
    const allTrackMetadata = await db
      .collection<{ trackId?: string }>(TRACK_METADATA_COLLECTION)
      .find({}, { projection: { trackId: 1 } })
      .toArray();
    const nonSpotifyTrackIds = allTrackMetadata
      .map((record) => record.trackId?.trim())
      .filter((trackId): trackId is string => Boolean(trackId) && !isSpotifyTrackId(trackId));

    if (nonSpotifyTrackIds.length === 0) {
      return { partial: false, deletedCount: 0 };
    }

    const result = await db.collection(TRACK_METADATA_COLLECTION).deleteMany({
      trackId: { $in: nonSpotifyTrackIds },
    });
    return { partial: false, deletedCount: result.deletedCount ?? 0 };
  }

    if (action === "normalize-lastfm-imports") {
      const result = await normalizeImportedLastFmWithPermanentCache(spotifyUserId, accessToken, onProgress, options?.retryProfile ?? "balanced", options?.playlistId);
      return { partial: Boolean(result.stoppedEarly), result };
    }

    if (action === "retry-unresolved-lastfm-imports") {
      const result = await normalizeImportedLastFmWithPermanentCache(spotifyUserId, accessToken, onProgress, options?.retryProfile ?? "balanced", options?.playlistId);
      return { partial: Boolean(result.stoppedEarly), result };
    }

  if (action === "refresh-track-library-full") {
    return syncUserLibraryFromRecentPlays(spotifyUserId, "tracks", "full", onProgress);
  }
  if (action === "refresh-track-library-incremental") {
    return syncUserLibraryFromRecentPlays(spotifyUserId, "tracks", "incremental", onProgress);
  }
  if (action === "refresh-artist-library-full") {
    return syncUserLibraryFromRecentPlays(spotifyUserId, "artists", "full", onProgress);
  }
  if (action === "refresh-artist-library-incremental") {
    return syncUserLibraryFromRecentPlays(spotifyUserId, "artists", "incremental", onProgress);
  }
  if (action === "refresh-album-library-full") {
    return syncUserLibraryFromRecentPlays(spotifyUserId, "albums", "full", onProgress);
  }
  if (action === "refresh-album-library-incremental") {
    return syncUserLibraryFromRecentPlays(spotifyUserId, "albums", "incremental", onProgress);
  }
  if (action === "refresh-all-time-full") {
    return buildAllTimeTopListsFromUserLibraries(spotifyUserId, "full");
  }

  return buildAllTimeTopListsFromUserLibraries(spotifyUserId, "incremental");
}

export async function clearDashboardMaintenanceState(spotifyUserId: string) {
  if (!hasMongoConfig()) {
    return;
  }

  const db = await getDatabase({ forceRetry: true });
  if (!db) {
    return;
  }

  await Promise.all([
    db.collection<UserLibraryStateDoc>(USER_LIBRARY_STATE_COLLECTION).deleteMany({ spotifyUserId }),
    db.collection<AllTimeTopListsStateDoc>(ALL_TIME_TOP_LISTS_STATE_COLLECTION).deleteMany({ spotifyUserId }),
    db.collection<MaintenanceHistoryEntry>(MAINTENANCE_HISTORY_COLLECTION).deleteMany({ spotifyUserId }),
  ]);
}

export const DASHBOARD_MAINTENANCE_COLLECTIONS = {
  USER_TRACK_LIBRARY_COLLECTION,
  USER_ARTIST_LIBRARY_COLLECTION,
  USER_ALBUM_LIBRARY_COLLECTION,
  USER_LIBRARY_STATE_COLLECTION,
  ALL_TIME_TOP_LISTS_STATE_COLLECTION,
  ALBUM_METADATA_COLLECTION,
  MAINTENANCE_HISTORY_COLLECTION,
  TOP_LISTS_CACHE_COLLECTION,
};
