import { getDatabase, hasMongoConfig } from "@/lib/mongodb";
import { invalidateDashboardOverviewRuntimeCache, writeStoredDashboardOverviewCache } from "@/lib/dashboard-overview";
import { invalidateDashboardSectionRuntimeCache, writeStoredDashboardSectionCache } from "@/lib/dashboard-section-cache";
import { invalidateDashboardSnapshotCaches } from "@/lib/spotify-dashboard";
import { invalidateDashboardPlaylistPreviewCache, invalidatePlaylistInsightsCache } from "@/lib/spotify-playlists";
import { invalidateTopListHistoryCache } from "@/lib/spotify-toplists";
import { StoredRecentPlay } from "@/lib/types";

const RECENT_PLAYS_COLLECTION = "spotify_recent_plays";
const IMPORT_BATCH_SIZE = 500;

type ParsedCsvRow = Record<string, string>;

type ParsedLastFmPlay = StoredRecentPlay & {
  duplicateKey: string;
  nameKey: string;
};

export type LastFmImportResult = {
  totalRows: number;
  parsedRows: number;
  importedCount: number;
  duplicateCount: number;
  skippedRows: number;
  batchCount: number;
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

function buildNameKey(trackName: string, artistName: string, albumName: string) {
  return `${normalizeText(trackName)}::${normalizeText(artistName)}::${normalizeText(albumName)}`;
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
      sourceType: "lastfm_import",
      duplicateKey,
      nameKey,
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
  if (existing.trackId === candidate.trackId) {
    return true;
  }

  return buildNameKey(existing.trackName, existing.artistName, existing.albumName) === candidate.nameKey;
}

export async function importLastFmScrobbles(csvText: string, spotifyUserId: string): Promise<LastFmImportResult> {
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

    const playedAtValues = [...new Set(batch.map((play) => play.playedAt))];
    const existing = await db
      .collection<StoredRecentPlay>(RECENT_PLAYS_COLLECTION)
      .find({
        spotifyUserId,
        playedAt: { $in: playedAtValues },
      })
      .toArray();

    const existingByPlayedAt = new Map<string, StoredRecentPlay[]>();
    existing.forEach((play) => {
      const list = existingByPlayedAt.get(play.playedAt) ?? [];
      list.push(play);
      existingByPlayedAt.set(play.playedAt, list);
    });

    const newPlays = batch.filter((play) => {
      const matches = existingByPlayedAt.get(play.playedAt) ?? [];
      const duplicate = matches.some((existingPlay) => isDuplicatePlay(existingPlay, play));

      if (duplicate) {
        duplicateCount += 1;
      }

      return !duplicate;
    });

    if (newPlays.length === 0) {
      continue;
    }

    await db.collection<StoredRecentPlay>(RECENT_PLAYS_COLLECTION).bulkWrite(
      newPlays.map((play) => ({
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
              albumName: play.albumName,
              durationMs: play.durationMs,
              sourceType: play.sourceType,
            },
          },
          upsert: true,
        },
      })),
      { ordered: false },
    );

    importedCount += newPlays.length;
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
