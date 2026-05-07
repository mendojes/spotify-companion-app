import { getDatabase, hasMongoConfig } from "@/lib/mongodb";
import { invalidateDashboardOverviewRuntimeCache, writeStoredDashboardOverviewCache } from "@/lib/dashboard-overview";
import { invalidateDashboardSectionRuntimeCache, writeStoredDashboardSectionCache } from "@/lib/dashboard-section-cache";
import { invalidateDashboardSnapshotCaches } from "@/lib/spotify-dashboard";
import { invalidateDashboardPlaylistPreviewCache, invalidatePlaylistInsightsCache } from "@/lib/spotify-playlists";
import { getSpotifyClientCredentialsToken, spotifyFetch } from "@/lib/spotify";
import { invalidateTopListHistoryCache } from "@/lib/spotify-toplists";
import { upsertStoredTrackMetadataFromRecentPlays } from "@/lib/track-metadata-cache";
import { SpotifyDashboardSnapshot, SpotifyRecentlyPlayedItem, SpotifyTrack, StoredRecentPlay } from "@/lib/types";

const RECENT_PLAYS_COLLECTION = "spotify_recent_plays";
const SNAPSHOT_HISTORY_COLLECTION = "spotify_snapshots_history";
const IMPORT_BATCH_SIZE = 500;
const LASTFM_IMPORT_SOURCE_TYPE = "lastfm_import";
const DEFAULT_DUPLICATE_WINDOW_MS = 1000 * 60 * 7;
const MIN_DUPLICATE_WINDOW_MS = 1000 * 60 * 3;
const MAX_DUPLICATE_WINDOW_MS = 1000 * 60 * 15;
const SNAPSHOT_CACHE_SCAN_LIMIT = 60;
const NORMALIZATION_TIMEOUT = Symbol("lastfm-normalization-timeout");

type TrackMetadataCandidate = {
  trackId?: string;
  trackName: string;
  artistName: string;
  artistNames?: string[];
  artistIds?: string[];
  albumName?: string;
  durationMs?: number;
  imageUrl?: string;
};

type SpotifySearchTracksResponse = {
  tracks?: {
    items: SpotifyTrack[];
  };
};

type ParsedCsvRow = Record<string, string>;

type ParsedLastFmPlay = StoredRecentPlay & {
  duplicateKey: string;
  nameKey: string;
  trackArtistKey: string;
};

export type LastFmImportResult = {
  totalRows: number;
  parsedRows: number;
  importedCount: number;
  duplicateCount: number;
  skippedRows: number;
  batchCount: number;
};

export type LastFmNormalizationResult = {
  scannedTrackGroups: number;
  processedTrackGroups: number;
  matchedTrackGroups: number;
  unresolvedTrackGroups: number;
  updatedPlayCount: number;
  deletedDuplicatePlayCount: number;
  timedOutTrackGroups: number;
  stoppedEarly: boolean;
};

export type LastFmImportPayload = {
  csvText: string;
  spotifyUserId: string;
};

const HEADER_ALIASES = {
  trackName: [
    "track",
    "track name",
    "name",
    "song",
    "title",
  ],
  artistName: [
    "artist",
    "artist name",
    "artists",
    "album artist",
  ],
  albumName: [
    "album",
    "album name",
    "release",
  ],
  playedAt: [
    "played at",
    "played_at",
    "timestamp",
    "date",
    "date utc",
    "utc_time",
    "utc time",
    "scrobbled at",
    "scrobble time",
    "time",
  ],
  unixTimestamp: [
    "uts",
    "unix timestamp",
    "unix time",
    "timestamp unix",
  ],
  trackId: [
    "spotify track id",
    "spotify_track_id",
    "spotify id",
    "spotify uri",
    "spotify_uri",
    "track id",
    "trackid",
    "mbid",
  ],
  durationMs: [
    "duration ms",
    "duration_ms",
    "duration",
    "length ms",
  ],
} as const;

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function buildTrackArtistKey(trackName: string, artistName: string) {
  return `${normalizeText(trackName)}::${normalizeText(artistName)}`;
}

function buildNameKey(trackName: string, artistName: string, albumName: string) {
  return `${normalizeText(trackName)}::${normalizeText(artistName)}::${normalizeText(albumName)}`;
}

function getDuplicateWindowMs(play: Pick<StoredRecentPlay, "durationMs">) {
  const durationWithBufferMs = (play.durationMs ?? 0) + 1000 * 90;
  return Math.min(
    MAX_DUPLICATE_WINDOW_MS,
    Math.max(MIN_DUPLICATE_WINDOW_MS, durationWithBufferMs || DEFAULT_DUPLICATE_WINDOW_MS),
  );
}

function addWindowToIso(playedAt: string, deltaMs: number) {
  return new Date(new Date(playedAt).getTime() + deltaMs).toISOString();
}

function toMetadataCandidateFromStoredPlay(play: StoredRecentPlay): TrackMetadataCandidate {
  return {
    trackId: play.trackId,
    trackName: play.trackName,
    artistName: play.artistName,
    artistNames: play.artistNames,
    artistIds: play.artistIds,
    albumName: play.albumName,
    durationMs: play.durationMs,
    imageUrl: play.imageUrl,
  };
}

function toMetadataCandidateFromSpotifyTrack(track: SpotifyTrack): TrackMetadataCandidate {
  return {
    trackId: track.id,
    trackName: track.name,
    artistName: track.artists.map((artist) => artist.name).join(", "),
    artistNames: track.artists.map((artist) => artist.name),
    artistIds: track.artists.map((artist) => artist.id).filter((id): id is string => Boolean(id)),
    albumName: track.album.name,
    durationMs: track.duration_ms,
    imageUrl: track.album.images?.[0]?.url,
  };
}

function collectSnapshotTrackCandidates(snapshot: SpotifyDashboardSnapshot) {
  return [
    ...snapshot.recent.map((item) => item.track),
    ...snapshot.topTracks,
    ...(snapshot.mediumTermTopTracks ?? []),
    ...(snapshot.longTermTopTracks ?? []),
  ];
}

function getMetadataQualityScore(candidate: TrackMetadataCandidate) {
  return [
    candidate.trackId ? 8 : 0,
    candidate.imageUrl ? 4 : 0,
    candidate.durationMs ? 3 : 0,
    candidate.albumName ? 2 : 0,
    candidate.artistIds?.length ? 2 : 0,
  ].reduce((sum, value) => sum + value, 0);
}

function chooseBetterMetadataCandidate(current: TrackMetadataCandidate | undefined, candidate: TrackMetadataCandidate) {
  if (!current) {
    return candidate;
  }

  return getMetadataQualityScore(candidate) > getMetadataQualityScore(current) ? candidate : current;
}

function buildMetadataMaps(candidates: TrackMetadataCandidate[]) {
  const byTrackId = new Map<string, TrackMetadataCandidate>();
  const byNameKey = new Map<string, TrackMetadataCandidate>();
  const byTrackArtistKey = new Map<string, TrackMetadataCandidate>();

  candidates.forEach((candidate) => {
    if (candidate.trackId) {
      byTrackId.set(candidate.trackId, chooseBetterMetadataCandidate(byTrackId.get(candidate.trackId), candidate));
    }

    const nameKey = buildNameKey(candidate.trackName, candidate.artistName, candidate.albumName ?? "");
    const trackArtistKey = buildTrackArtistKey(candidate.trackName, candidate.artistName);

    byNameKey.set(nameKey, chooseBetterMetadataCandidate(byNameKey.get(nameKey), candidate));
    byTrackArtistKey.set(trackArtistKey, chooseBetterMetadataCandidate(byTrackArtistKey.get(trackArtistKey), candidate));
  });

  return { byTrackId, byNameKey, byTrackArtistKey };
}

async function getCachedMetadataCandidates(
  db: Awaited<ReturnType<typeof getDatabase>>,
  spotifyUserId: string,
  plays: ParsedLastFmPlay[],
) {
  if (!db || plays.length === 0) {
    return [] as TrackMetadataCandidate[];
  }

  const uniqueTrackArtistPairs = [...new Map(
    plays.map((play) => [
      `${play.trackName}::${play.artistName}`,
      { trackName: play.trackName, artistName: play.artistName },
    ]),
  ).values()];
  const uniqueTrackIds = [...new Set(plays.map((play) => play.trackId).filter((trackId) => !trackId.startsWith("lastfm:")))];

  const [recentPlayCandidates, snapshots] = await Promise.all([
    db
      .collection<StoredRecentPlay>(RECENT_PLAYS_COLLECTION)
      .find({
        spotifyUserId,
        $or: [
          ...uniqueTrackIds.map((trackId) => ({ trackId })),
          ...uniqueTrackArtistPairs.map(({ trackName, artistName }) => ({ trackName, artistName })),
        ],
      })
      .sort({ playedAt: -1 })
      .limit(1000)
      .toArray(),
    db
      .collection<SpotifyDashboardSnapshot>(SNAPSHOT_HISTORY_COLLECTION)
      .find({ spotifyUserId })
      .sort({ fetchedAt: -1 })
      .limit(SNAPSHOT_CACHE_SCAN_LIMIT)
      .toArray(),
  ]);

  const snapshotCandidates = snapshots.flatMap((snapshot) => collectSnapshotTrackCandidates(snapshot).map(toMetadataCandidateFromSpotifyTrack));
  return [
    ...recentPlayCandidates.map(toMetadataCandidateFromStoredPlay),
    ...snapshotCandidates,
  ];
}

function applyMetadataCandidate(play: ParsedLastFmPlay, candidate?: TrackMetadataCandidate) {
  if (!candidate) {
    return play;
  }

  const resolvedArtistName = candidate.artistName || play.artistName;
  const resolvedAlbumName = candidate.albumName || play.albumName;

  return {
    ...play,
    trackId: candidate.trackId ?? play.trackId,
    trackName: candidate.trackName || play.trackName,
    artistName: resolvedArtistName,
    artistNames: candidate.artistNames?.length ? candidate.artistNames : play.artistNames,
    artistIds: candidate.artistIds?.length ? candidate.artistIds : play.artistIds,
    albumName: resolvedAlbumName,
    durationMs: candidate.durationMs ?? play.durationMs,
    imageUrl: candidate.imageUrl ?? play.imageUrl,
    nameKey: buildNameKey(play.trackName, resolvedArtistName, resolvedAlbumName),
    trackArtistKey: buildTrackArtistKey(play.trackName, resolvedArtistName),
  };
}

async function searchSpotifyTrackMetadata(accessToken: string, play: ParsedLastFmPlay) {
  const query = `track:${play.trackName} artist:${play.artistName}`;
  const response = await spotifyFetch<SpotifySearchTracksResponse>(
    `/search?type=track&limit=5&q=${encodeURIComponent(query)}`,
    accessToken,
  ).catch(() => null);
  const items = response?.tracks?.items ?? [];

  if (items.length === 0) {
    return undefined;
  }

  const exactTrackName = normalizeText(play.trackName);
  const exactArtistName = normalizeText(play.artistName);
  const preferred =
    items.find((track) =>
      normalizeText(track.name) === exactTrackName &&
      track.artists.some((artist) => normalizeText(artist.name) === exactArtistName),
    ) ??
    items.find((track) =>
      track.artists.some((artist) => normalizeText(artist.name) === exactArtistName),
    ) ??
    items[0];

  return preferred ? toMetadataCandidateFromSpotifyTrack(preferred) : undefined;
}

async function searchSpotifyTrackMetadataForStoredPlay(
  accessToken: string,
  play: Pick<StoredRecentPlay, "trackName" | "artistName" | "albumName">,
) {
  const query = `track:${play.trackName} artist:${play.artistName} album:${play.albumName}`;
  const response = await spotifyFetch<SpotifySearchTracksResponse>(
    `/search?type=track&limit=5&q=${encodeURIComponent(query)}`,
    accessToken,
  ).catch(() => null);
  const items = response?.tracks?.items ?? [];

  if (items.length === 0) {
    return undefined;
  }

  const exactTrackName = normalizeText(play.trackName);
  const exactArtistName = normalizeText(play.artistName);
  const exactAlbumName = normalizeText(play.albumName);
  const preferred =
    items.find((track) =>
      normalizeText(track.name) === exactTrackName &&
      normalizeText(track.album.name) === exactAlbumName &&
      track.artists.some((artist) => normalizeText(artist.name) === exactArtistName),
    ) ??
    items.find((track) =>
      normalizeText(track.name) === exactTrackName &&
      track.artists.some((artist) => normalizeText(artist.name) === exactArtistName),
    ) ??
    items.find((track) =>
      track.artists.some((artist) => normalizeText(artist.name) === exactArtistName),
    ) ??
    items[0];

  return preferred ? toMetadataCandidateFromSpotifyTrack(preferred) : undefined;
}

async function hydrateImportedPlayMetadata(
  db: Awaited<ReturnType<typeof getDatabase>>,
  spotifyUserId: string,
  plays: ParsedLastFmPlay[],
  accessToken?: string,
) {
  if (plays.length === 0) {
    return plays;
  }

  const cachedCandidates = await getCachedMetadataCandidates(db, spotifyUserId, plays);
  const metadataMaps = buildMetadataMaps(cachedCandidates);
  const spotifyToken = accessToken ?? await getSpotifyClientCredentialsToken().catch(() => "");
  const spotifySearchCache = new Map<string, TrackMetadataCandidate | null>();

  return Promise.all(
    plays.map(async (play) => {
      const cachedCandidate =
        (play.trackId && !play.trackId.startsWith("lastfm:") ? metadataMaps.byTrackId.get(play.trackId) : undefined) ??
        metadataMaps.byNameKey.get(play.nameKey) ??
        metadataMaps.byTrackArtistKey.get(play.trackArtistKey);

      if (cachedCandidate) {
        return applyMetadataCandidate(play, cachedCandidate);
      }

      if (!spotifyToken) {
        return play;
      }

      const spotifyLookupKey = `${play.trackName}::${play.artistName}`;
      if (!spotifySearchCache.has(spotifyLookupKey)) {
        spotifySearchCache.set(spotifyLookupKey, (await searchSpotifyTrackMetadata(spotifyToken, play)) ?? null);
      }

      return applyMetadataCandidate(play, spotifySearchCache.get(spotifyLookupKey) ?? undefined);
    }),
  );
}

function parseDurationMs(rawValue?: string) {
  if (!rawValue) {
    return undefined;
  }

  const trimmed = rawValue.trim();
  if (!trimmed) {
    return undefined;
  }

  const asNumber = Number(trimmed);
  if (Number.isFinite(asNumber) && asNumber > 0) {
    return Math.round(asNumber);
  }

  const parts = trimmed.split(":").map((part) => Number(part));
  if (parts.length >= 2 && parts.every((part) => Number.isFinite(part) && part >= 0)) {
    const seconds = parts.reduce((total, part) => total * 60 + part, 0);
    return seconds > 0 ? seconds * 1000 : undefined;
  }

  return undefined;
}

function parseSpotifyTrackId(rawValue?: string) {
  if (!rawValue) {
    return undefined;
  }

  const trimmed = rawValue.trim();
  if (!trimmed) {
    return undefined;
  }

  const uriMatch = trimmed.match(/^spotify:track:([A-Za-z0-9]+)$/i);
  if (uriMatch?.[1]) {
    return uriMatch[1];
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.hostname.includes("spotify.com")) {
      const trackId = parsed.pathname.split("/").filter(Boolean).pop();
      return trackId ?? trimmed;
    }
  } catch {
    // Fall back to the raw value below.
  }

  return trimmed;
}

function parsePlayedAt(row: ParsedCsvRow, headerMap: Map<string, string>) {
  const unixHeader = findHeader(headerMap, HEADER_ALIASES.unixTimestamp);
  const unixValue = unixHeader ? row[unixHeader] : undefined;

  if (unixValue) {
    const unixSeconds = Number(unixValue.trim());
    if (Number.isFinite(unixSeconds) && unixSeconds > 0) {
      return new Date(unixSeconds * 1000).toISOString();
    }
  }

  const playedAtHeader = findHeader(headerMap, HEADER_ALIASES.playedAt);
  const rawValue = playedAtHeader ? row[playedAtHeader]?.trim() : "";

  if (!rawValue) {
    return undefined;
  }

  const direct = new Date(rawValue);
  if (Number.isFinite(direct.getTime())) {
    return direct.toISOString();
  }

  const utcFallback = new Date(`${rawValue} UTC`);
  if (Number.isFinite(utcFallback.getTime())) {
    return utcFallback.toISOString();
  }

  return undefined;
}

function parseCsv(text: string) {
  const nonEmptyLines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const headerLine = nonEmptyLines[0] ?? "";
  const delimiter = headerLine.includes("\t") ? "\t" : ",";
  const rows: string[][] = [];
  let currentCell = "";
  let currentRow: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const nextCharacter = text[index + 1];

    if (character === "\"") {
      if (inQuotes && nextCharacter === "\"") {
        currentCell += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (character === delimiter && !inQuotes) {
      currentRow.push(currentCell);
      currentCell = "";
      continue;
    }

    if ((character === "\n" || character === "\r") && !inQuotes) {
      if (character === "\r" && nextCharacter === "\n") {
        index += 1;
      }

      currentRow.push(currentCell);
      if (currentRow.some((value) => value.length > 0)) {
        rows.push(currentRow);
      }
      currentCell = "";
      currentRow = [];
      continue;
    }

    currentCell += character;
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell);
    if (currentRow.some((value) => value.length > 0)) {
      rows.push(currentRow);
    }
  }

  if (rows.length === 0) {
    return [] as ParsedCsvRow[];
  }

  const headers = rows[0].map((header) => header.trim());

  return rows.slice(1).map((cells) =>
    Object.fromEntries(headers.map((header, index) => [header, cells[index]?.trim() ?? ""])),
  );
}

function findHeader(headerMap: Map<string, string>, aliases: readonly string[]) {
  for (const alias of aliases) {
    const header = headerMap.get(normalizeHeader(alias));
    if (header) {
      return header;
    }
  }

  return undefined;
}

function parseLastFmCsv(csvText: string, spotifyUserId: string) {
  const parsedRows = parseCsv(csvText);
  const totalRows = parsedRows.length;

  if (parsedRows.length === 0) {
    return {
      plays: [] as ParsedLastFmPlay[],
      totalRows,
      skippedRows: 0,
    };
  }

  const headerMap = new Map<string, string>();
  Object.keys(parsedRows[0] ?? {}).forEach((header) => {
    headerMap.set(normalizeHeader(header), header);
  });

  const trackNameHeader = findHeader(headerMap, HEADER_ALIASES.trackName);
  const artistNameHeader = findHeader(headerMap, HEADER_ALIASES.artistName);
  const albumNameHeader = findHeader(headerMap, HEADER_ALIASES.albumName);
  const trackIdHeader = findHeader(headerMap, HEADER_ALIASES.trackId);
  const durationHeader = findHeader(headerMap, HEADER_ALIASES.durationMs);

  const dedupedPlays = new Map<string, ParsedLastFmPlay>();
  let skippedRows = 0;

  parsedRows.forEach((row) => {
    const trackName = trackNameHeader ? row[trackNameHeader]?.trim() : "";
    const artistName = artistNameHeader ? row[artistNameHeader]?.trim() : "";
    const albumName = albumNameHeader ? row[albumNameHeader]?.trim() : "";
    const playedAt = parsePlayedAt(row, headerMap);

    if (!trackName || !artistName || !playedAt) {
      skippedRows += 1;
      return;
    }

    const parsedTrackId = parseSpotifyTrackId(trackIdHeader ? row[trackIdHeader] : undefined);
    const nameKey = buildNameKey(trackName, artistName, albumName);
    const trackArtistKey = buildTrackArtistKey(trackName, artistName);
    const trackId = parsedTrackId ?? `lastfm:${nameKey}`;
    const duplicateKey = `${playedAt}::${trackId}`;
    const play: ParsedLastFmPlay = {
      spotifyUserId,
      trackId,
      playedAt,
      trackName,
      artistName,
      artistNames: artistName.split(/,\s*/).filter(Boolean),
      albumName: albumName || "Unknown album",
      durationMs: parseDurationMs(durationHeader ? row[durationHeader] : undefined),
      sourceType: LASTFM_IMPORT_SOURCE_TYPE,
      duplicateKey,
      nameKey,
      trackArtistKey,
    };

    dedupedPlays.set(duplicateKey, play);
  });

  return {
    plays: [...dedupedPlays.values()].sort((a, b) => new Date(a.playedAt).getTime() - new Date(b.playedAt).getTime()),
    totalRows,
    skippedRows,
  };
}

function isDuplicatePlay(existing: StoredRecentPlay, candidate: ParsedLastFmPlay) {
  if (existing.playedAt === candidate.playedAt && existing.trackId === candidate.trackId) {
    return true;
  }

  const existingTrackArtistKey = buildTrackArtistKey(existing.trackName, existing.artistName);

  if (existingTrackArtistKey !== candidate.trackArtistKey) {
    return false;
  }

  const playedAtDeltaMs = Math.abs(new Date(existing.playedAt).getTime() - new Date(candidate.playedAt).getTime());
  return playedAtDeltaMs <= getDuplicateWindowMs(candidate);
}

function buildExistingPlayConsumptionKey(play: StoredRecentPlay) {
  return [
    play.playedAt,
    play.trackId,
    play.trackName,
    play.artistName,
    play.albumName,
    play.sourceType ?? "",
  ].join("::");
}

async function getExistingNearbyPlays(db: Awaited<ReturnType<typeof getDatabase>>, spotifyUserId: string, batch: ParsedLastFmPlay[]) {
  if (!db || batch.length === 0) {
    return [] as StoredRecentPlay[];
  }

  const earliestPlayedAt = batch[0]?.playedAt;
  const latestPlayedAt = batch[batch.length - 1]?.playedAt;

  if (!earliestPlayedAt || !latestPlayedAt) {
    return [] as StoredRecentPlay[];
  }

  const lowerBound = addWindowToIso(earliestPlayedAt, -MAX_DUPLICATE_WINDOW_MS);
  const upperBound = addWindowToIso(latestPlayedAt, MAX_DUPLICATE_WINDOW_MS);

  return db
    .collection<StoredRecentPlay>(RECENT_PLAYS_COLLECTION)
    .find({
      spotifyUserId,
      playedAt: {
        $gte: lowerBound,
        $lte: upperBound,
      },
    })
    .sort({ playedAt: 1 })
    .toArray();
}

export async function importLastFmScrobbles(csvText: string, spotifyUserId: string, accessToken?: string): Promise<LastFmImportResult> {
  const { plays, totalRows, skippedRows } = parseLastFmCsv(csvText, spotifyUserId);

  if (!hasMongoConfig()) {
    return {
      totalRows,
      parsedRows: plays.length,
      importedCount: 0,
      duplicateCount: 0,
      skippedRows,
      batchCount: 0,
    };
  }

  const db = await getDatabase({ forceRetry: true });
  if (!db) {
    return {
      totalRows,
      parsedRows: plays.length,
      importedCount: 0,
      duplicateCount: 0,
      skippedRows,
      batchCount: 0,
    };
  }

  let importedCount = 0;
  let duplicateCount = 0;
  let batchCount = 0;

  for (let start = 0; start < plays.length; start += IMPORT_BATCH_SIZE) {
    const batch = plays.slice(start, start + IMPORT_BATCH_SIZE);
    if (batch.length === 0) {
      continue;
    }

    batchCount += 1;
    const existingNearbyPlays = await getExistingNearbyPlays(db, spotifyUserId, batch);
    const unconsumedExistingPlayKeys = new Set(
      existingNearbyPlays
        .filter((play) => play.sourceType !== LASTFM_IMPORT_SOURCE_TYPE)
        .map((play) => buildExistingPlayConsumptionKey(play)),
    );
    const exactExistingLastFmKeys = new Set(
      existingNearbyPlays
        .filter((play) => play.sourceType === LASTFM_IMPORT_SOURCE_TYPE)
        .map((play) => `${play.playedAt}::${buildNameKey(play.trackName, play.artistName, play.albumName)}`),
    );

    const newPlays = batch.filter((play) => {
      const exactExistingLastFmKey = `${play.playedAt}::${play.nameKey}`;
      if (exactExistingLastFmKeys.has(exactExistingLastFmKey)) {
        duplicateCount += 1;
        return false;
      }

      const matchingExistingPlay = existingNearbyPlays.find((existingPlay) => {
        if (existingPlay.sourceType === LASTFM_IMPORT_SOURCE_TYPE) {
          return false;
        }

        const consumptionKey = buildExistingPlayConsumptionKey(existingPlay);
        return unconsumedExistingPlayKeys.has(consumptionKey) && isDuplicatePlay(existingPlay, play);
      });

      if (matchingExistingPlay) {
        unconsumedExistingPlayKeys.delete(buildExistingPlayConsumptionKey(matchingExistingPlay));
        duplicateCount += 1;
        return false;
      }

      return true;
    });

    if (newPlays.length === 0) {
      continue;
    }

    const enrichedNewPlays = await hydrateImportedPlayMetadata(db, spotifyUserId, newPlays, accessToken);

    await db.collection<StoredRecentPlay>(RECENT_PLAYS_COLLECTION).bulkWrite(
      enrichedNewPlays.map((play) => ({
        updateOne: {
          filter: {
            spotifyUserId: play.spotifyUserId,
            playedAt: play.playedAt,
            trackId: play.trackId,
          },
          update: {
            $set: {
              spotifyUserId: play.spotifyUserId,
              trackId: play.trackId,
              playedAt: play.playedAt,
              trackName: play.trackName,
              artistName: play.artistName,
              artistNames: play.artistNames,
              artistIds: play.artistIds,
              albumName: play.albumName,
              durationMs: play.durationMs,
              imageUrl: play.imageUrl,
              sourceType: play.sourceType,
            },
          },
          upsert: true,
        },
      })),
      { ordered: false },
    );
    await upsertStoredTrackMetadataFromRecentPlays(enrichedNewPlays).catch(() => undefined);

    importedCount += enrichedNewPlays.length;
  }

  return {
    totalRows,
    parsedRows: plays.length,
    importedCount,
    duplicateCount,
    skippedRows,
    batchCount,
  };
}

export async function importLastFmScrobbleChunk(payload: LastFmImportPayload) {
  return importLastFmScrobbles(payload.csvText, payload.spotifyUserId);
}

export async function deleteImportedLastFmScrobbles(spotifyUserId: string) {
  if (!hasMongoConfig()) {
    return { deletedCount: 0 };
  }

  const db = await getDatabase({ forceRetry: true });
  if (!db) {
    return { deletedCount: 0 };
  }

  const result = await db.collection<StoredRecentPlay>(RECENT_PLAYS_COLLECTION).deleteMany({
    spotifyUserId,
    sourceType: LASTFM_IMPORT_SOURCE_TYPE,
  });

  return {
    deletedCount: result.deletedCount ?? 0,
  };
}

export async function normalizeImportedLastFmScrobbles(
  spotifyUserId: string,
  accessToken?: string,
  options?: {
    limitDistinctTracks?: number;
    onProgress?: (detail: string) => void | Promise<void>;
    perTrackTimeoutMs?: number;
    maxRuntimeMs?: number;
  },
): Promise<LastFmNormalizationResult> {
  if (!hasMongoConfig()) {
    return {
      scannedTrackGroups: 0,
      processedTrackGroups: 0,
      matchedTrackGroups: 0,
      unresolvedTrackGroups: 0,
      updatedPlayCount: 0,
      deletedDuplicatePlayCount: 0,
      timedOutTrackGroups: 0,
      stoppedEarly: false,
    };
  }

  const db = await getDatabase({ forceRetry: true });
  if (!db) {
    return {
      scannedTrackGroups: 0,
      processedTrackGroups: 0,
      matchedTrackGroups: 0,
      unresolvedTrackGroups: 0,
      updatedPlayCount: 0,
      deletedDuplicatePlayCount: 0,
      timedOutTrackGroups: 0,
      stoppedEarly: false,
    };
  }

  const spotifyToken = accessToken ?? await getSpotifyClientCredentialsToken().catch(() => "");
  if (!spotifyToken) {
    return {
      scannedTrackGroups: 0,
      processedTrackGroups: 0,
      matchedTrackGroups: 0,
      unresolvedTrackGroups: 0,
      updatedPlayCount: 0,
      deletedDuplicatePlayCount: 0,
      timedOutTrackGroups: 0,
      stoppedEarly: false,
    };
  }

  const unresolvedPlays = await db.collection<StoredRecentPlay>(RECENT_PLAYS_COLLECTION)
    .find({
      spotifyUserId,
      sourceType: LASTFM_IMPORT_SOURCE_TYPE,
      $or: [
        { trackId: { $regex: "^lastfm:" } },
        { imageUrl: { $exists: false } },
        { artistIds: { $exists: false } },
      ],
    })
    .sort({ playedAt: -1 })
    .limit(Math.max(50, options?.limitDistinctTracks ? options.limitDistinctTracks * 40 : 10000))
    .toArray();

  const groupedCandidates = [...new Map(
    unresolvedPlays.map((play) => [
      buildNameKey(play.trackName, play.artistName, play.albumName),
      play,
    ]),
  ).values()].slice(0, options?.limitDistinctTracks ?? 250);

  const perTrackTimeoutMs = Math.max(1000, options?.perTrackTimeoutMs ?? 6000);
  const maxRuntimeMs = Math.max(5000, options?.maxRuntimeMs ?? 45000);
  const startedAt = Date.now();
  let processedTrackGroups = 0;
  let matchedTrackGroups = 0;
  let unresolvedTrackGroups = 0;
  let updatedPlayCount = 0;
  let deletedDuplicatePlayCount = 0;
  let timedOutTrackGroups = 0;
  let stoppedEarly = false;

  for (let index = 0; index < groupedCandidates.length; index += 1) {
    const candidate = groupedCandidates[index];
    if (Date.now() - startedAt >= maxRuntimeMs) {
      stoppedEarly = true;
      await options?.onProgress?.(
        `Paused imported-track normalization after ${processedTrackGroups}/${groupedCandidates.length} groups so refresh can finish. The next refresh will continue with remaining unresolved tracks.`,
      );
      break;
    }

    await options?.onProgress?.(
      `Resolving imported Last.fm tracks to Spotify metadata (${index + 1}/${groupedCandidates.length})`,
    );

    const metadata = await Promise.race<TrackMetadataCandidate | typeof NORMALIZATION_TIMEOUT | undefined>([
      searchSpotifyTrackMetadataForStoredPlay(spotifyToken, candidate),
      new Promise<typeof NORMALIZATION_TIMEOUT>((resolve) => setTimeout(() => resolve(NORMALIZATION_TIMEOUT), perTrackTimeoutMs)),
    ]);
    processedTrackGroups += 1;
    if (metadata === NORMALIZATION_TIMEOUT) {
      timedOutTrackGroups += 1;
      unresolvedTrackGroups += 1;
      await options?.onProgress?.(
        `Skipping slow or unresolved imported track ${processedTrackGroups}/${groupedCandidates.length}. Progress is saved and the next refresh can continue.`,
      );
      continue;
    }
    if (!metadata?.trackId) {
      unresolvedTrackGroups += 1;
      continue;
    }
    const resolvedTrackId = metadata.trackId;

    matchedTrackGroups += 1;
    const matchingImportedPlays = await db.collection<StoredRecentPlay>(RECENT_PLAYS_COLLECTION)
      .find({
        spotifyUserId,
        sourceType: LASTFM_IMPORT_SOURCE_TYPE,
        trackName: candidate.trackName,
        artistName: candidate.artistName,
        albumName: candidate.albumName,
      })
      .toArray();

    if (matchingImportedPlays.length === 0) {
      continue;
    }

    const playedAtValues = matchingImportedPlays.map((play) => play.playedAt);
    const existingResolvedPlays = await db.collection<StoredRecentPlay>(RECENT_PLAYS_COLLECTION)
      .find({
        spotifyUserId,
        trackId: resolvedTrackId,
        playedAt: { $in: playedAtValues },
      })
      .toArray();
    const existingByPlayedAt = new Map(existingResolvedPlays.map((play) => [play.playedAt, play]));

    const bulkOps = matchingImportedPlays.map((play) => {
      const conflictingPlay = existingByPlayedAt.get(play.playedAt);
      if (conflictingPlay && String(conflictingPlay._id) !== String(play._id)) {
        deletedDuplicatePlayCount += 1;
        return {
          deleteOne: {
            filter: { _id: play._id },
          },
        };
      }

      updatedPlayCount += 1;
      return {
        updateOne: {
          filter: { _id: play._id },
          update: {
            $set: {
              trackId: resolvedTrackId,
              trackName: metadata.trackName,
              artistName: metadata.artistName,
              artistNames: metadata.artistNames,
              artistIds: metadata.artistIds,
              albumName: metadata.albumName ?? play.albumName,
              durationMs: metadata.durationMs ?? play.durationMs,
              imageUrl: metadata.imageUrl ?? play.imageUrl,
            },
          },
        },
      };
    });

    if (bulkOps.length > 0) {
      await db.collection<StoredRecentPlay>(RECENT_PLAYS_COLLECTION).bulkWrite(bulkOps, { ordered: false });
      await upsertStoredTrackMetadataFromRecentPlays(
        matchingImportedPlays.map((play) => ({
          ...play,
          trackId: resolvedTrackId,
          trackName: metadata.trackName,
          artistName: metadata.artistName,
          artistNames: metadata.artistNames,
          artistIds: metadata.artistIds,
          albumName: metadata.albumName ?? play.albumName,
          durationMs: metadata.durationMs ?? play.durationMs,
          imageUrl: metadata.imageUrl ?? play.imageUrl,
        })),
      ).catch(() => undefined);
    }
  }

  return {
    scannedTrackGroups: groupedCandidates.length,
    processedTrackGroups,
    matchedTrackGroups,
    unresolvedTrackGroups,
    updatedPlayCount,
    deletedDuplicatePlayCount,
    timedOutTrackGroups,
    stoppedEarly,
  };
}

export async function refreshLastFmImportCaches(spotifyUserId: string, accessToken?: string) {
  invalidateDashboardSnapshotCaches(spotifyUserId);
  invalidateTopListHistoryCache(spotifyUserId);
  invalidateDashboardPlaylistPreviewCache(spotifyUserId);
  invalidatePlaylistInsightsCache(spotifyUserId);
  invalidateDashboardOverviewRuntimeCache(spotifyUserId);
  invalidateDashboardSectionRuntimeCache(spotifyUserId);

  await Promise.all([
    writeStoredDashboardOverviewCache(spotifyUserId, accessToken).catch(() => undefined),
    writeStoredDashboardSectionCache(spotifyUserId, accessToken).catch(() => undefined),
  ]);
}
