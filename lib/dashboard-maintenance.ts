import { createHash } from "node:crypto";
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
import { getStoredTrackMetadataMap, TRACK_METADATA_COLLECTION } from "@/lib/track-metadata-cache";
import { TopListsData, StoredRecentPlay } from "@/lib/types";

const RECENT_PLAYS_COLLECTION = "spotify_recent_plays";
const USER_TRACK_LIBRARY_COLLECTION = "spotify_user_track_library";
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

export type RetryUnresolvedBatchProfile = "conservative" | "balanced" | "aggressive";

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

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function isSpotifyTrackId(trackId?: string) {
  return typeof trackId === "string" && /^[A-Za-z0-9]{22}$/.test(trackId.trim());
}

function isSyntheticLastFmTrackId(trackId?: string) {
  return typeof trackId === "string" && /^lastfm:/i.test(trackId.trim());
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
  ) ?? null;
}

export async function normalizeImportedLastFmWithPermanentCache(
  spotifyUserId: string,
  accessToken: string,
  onProgress?: MaintenanceProgressReporter,
  profile: RetryUnresolvedBatchProfile = "balanced",
) {
  const profileSettings = {
    conservative: {
      prepassPlayLimit: 120,
      distinctTrackLimit: 25,
      perTrackTimeoutMs: 2200,
      maxRuntimeMs: 20_000,
    },
    balanced: {
      prepassPlayLimit: 240,
      distinctTrackLimit: 100,
      perTrackTimeoutMs: 2500,
      maxRuntimeMs: 45_000,
    },
    aggressive: {
      prepassPlayLimit: 500,
      distinctTrackLimit: 250,
      perTrackTimeoutMs: 2800,
      maxRuntimeMs: 90_000,
    },
  }[profile];

  const db = await getDatabase({ forceRetry: true });
  if (db) {
    const unresolvedSeedPlays = await db.collection<StoredRecentPlay>(RECENT_PLAYS_COLLECTION)
      .find({
        spotifyUserId,
        sourceType: "lastfm_import",
        $or: [
          { trackId: { $regex: "^lastfm:" } },
          { trackId: { $regex: "^local:" } },
          { trackId: { $exists: false } },
          { trackId: "" },
        ],
      })
      .sort({ lastfmResolutionAttemptedAt: 1, playedAt: -1 })
      .limit(profileSettings.prepassPlayLimit)
      .toArray();

    let preResolvedCount = 0;
    for (const play of unresolvedSeedPlays) {
      await onProgress?.(`Checking permanent libraries for ${play.trackName}`);
      const cached = await findCachedTrackByNames(spotifyUserId, play);
      if (!cached || !isSpotifyTrackId(cached.trackId)) {
        continue;
      }

      const conflictingResolvedPlay = await db.collection<StoredRecentPlay>(RECENT_PLAYS_COLLECTION).findOne({
        spotifyUserId,
        playedAt: play.playedAt,
        trackId: cached.trackId,
      });

      if (conflictingResolvedPlay && String(conflictingResolvedPlay._id) !== String(play._id)) {
        await db.collection<StoredRecentPlay>(RECENT_PLAYS_COLLECTION).deleteOne({ _id: play._id });
        preResolvedCount += 1;
        continue;
      }

      await db.collection<StoredRecentPlay>(RECENT_PLAYS_COLLECTION).updateOne(
        { _id: play._id },
        {
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
      );
      await upsertTrackMetadataCacheEntry({
        trackId: cached.trackId,
        trackName: cached.trackName,
        artistName: cached.artistName,
        artistNames: cached.artistNames,
        artistIds: cached.artistIds,
        albumId: cached.albumId,
        albumName: cached.albumName,
        durationMs: cached.durationMs,
        imageUrl: cached.imageUrl,
      }).catch(() => undefined);
      preResolvedCount += 1;
    }

    if (preResolvedCount > 0) {
      await onProgress?.(`Resolved ${preResolvedCount} imported scrobbles from permanent libraries before any Spotify lookup`);
    }
  }

  return normalizeImportedLastFmScrobbles(spotifyUserId, accessToken, {
    limitDistinctTracks: profileSettings.distinctTrackLimit,
    perTrackTimeoutMs: profileSettings.perTrackTimeoutMs,
    maxRuntimeMs: profileSettings.maxRuntimeMs,
    onProgress,
  });
}

export async function runDashboardMaintenanceAction(
  action: MaintenanceAction,
  spotifyUserId: string,
  accessToken: string,
  onProgress?: MaintenanceProgressReporter,
  options?: {
    retryProfile?: RetryUnresolvedBatchProfile;
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
    const result = await normalizeImportedLastFmWithPermanentCache(spotifyUserId, accessToken, onProgress, options?.retryProfile ?? "balanced");
    return { partial: Boolean(result.stoppedEarly), result };
  }

  if (action === "retry-unresolved-lastfm-imports") {
    const result = await normalizeImportedLastFmWithPermanentCache(spotifyUserId, accessToken, onProgress, options?.retryProfile ?? "balanced");
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
