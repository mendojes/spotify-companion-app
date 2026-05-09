import { getDatabase, hasMongoConfig } from "@/lib/mongodb";
import { invalidateDashboardOverviewRuntimeCache, writeStoredDashboardOverviewCache } from "@/lib/dashboard-overview";
import { invalidateDashboardSectionRuntimeCache, writeStoredDashboardSectionCache } from "@/lib/dashboard-section-cache";
import { invalidateDashboardSnapshotCaches } from "@/lib/spotify-dashboard";
import { invalidateDashboardPlaylistPreviewCache, invalidatePlaylistInsightsCache } from "@/lib/spotify-playlists";
import { getSpotifyClientCredentialsToken, spotifyFetch } from "@/lib/spotify";
import { invalidateTopListHistoryCache, resetStoredAllTimeTopListAggregate } from "@/lib/spotify-toplists";
import { TRACK_METADATA_COLLECTION, upsertStoredTrackMetadataFromRecentPlays } from "@/lib/track-metadata-cache";
import { SpotifyRecentlyPlayedItem, SpotifyTrack, StoredRecentPlay } from "@/lib/types";

const RECENT_PLAYS_COLLECTION = "spotify_recent_plays";
const SNAPSHOT_HISTORY_COLLECTION = "spotify_snapshots_history";
const USER_TRACK_LIBRARY_COLLECTION = "spotify_user_track_library";
const USER_ARTIST_LIBRARY_COLLECTION = "spotify_user_artist_library";
const USER_ALBUM_LIBRARY_COLLECTION = "spotify_user_album_library";
const USER_LIBRARY_STATE_COLLECTION = "spotify_user_library_state";
const ALL_TIME_TOP_LISTS_STATE_COLLECTION = "dashboard_all_time_top_lists_state";
const ALBUM_METADATA_COLLECTION = "spotify_album_metadata";
const IMPORT_BATCH_SIZE = 50;
const LASTFM_IMPORT_SOURCE_TYPE = "lastfm_import";
const DEFAULT_DUPLICATE_WINDOW_MS = 1000 * 60 * 7;
const MIN_DUPLICATE_WINDOW_MS = 1000 * 60 * 3;
const MAX_DUPLICATE_WINDOW_MS = 1000 * 60 * 15;
const NORMALIZATION_TIMEOUT = Symbol("lastfm-normalization-timeout");

type TrackMetadataCandidate = {
  trackId?: string;
  trackName: string;
  artistName: string;
  normalizedTrackArtistKey?: string;
  normalizedNameKey?: string;
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
  processedNameKeys: string[];
};

export type UnresolvedImportedLastFmGroup = {
  trackName: string;
  artistName: string;
  albumName: string;
  playCount: number;
  earliestPlayedAt: string;
  latestPlayedAt: string;
};

export type ResolveImportedLastFmGroupResult = {
  matchedPlayCount: number;
  updatedPlayCount: number;
  deletedDuplicatePlayCount: number;
  trackId: string;
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
    normalizedTrackArtistKey: buildTrackArtistKey(play.trackName, play.artistName),
    normalizedNameKey: buildNameKey(play.trackName, play.artistName, play.albumName),
    artistNames: play.artistNames,
    artistIds: play.artistIds,
    albumName: play.albumName,
    durationMs: play.durationMs,
    imageUrl: play.imageUrl,
  };
}

function toMetadataCandidateFromSpotifyTrack(track: SpotifyTrack): TrackMetadataCandidate {
  const joinedArtistName = track.artists.map((artist) => artist.name).join(", ");
  return {
    trackId: track.id,
    trackName: track.name,
    artistName: joinedArtistName,
    normalizedTrackArtistKey: buildTrackArtistKey(track.name, joinedArtistName),
    normalizedNameKey: buildNameKey(track.name, joinedArtistName, track.album.name),
    artistNames: track.artists.map((artist) => artist.name),
    artistIds: track.artists.map((artist) => artist.id).filter((id): id is string => Boolean(id)),
    albumName: track.album.name,
    durationMs: track.duration_ms,
    imageUrl: track.album.images?.[0]?.url,
  };
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

  const [libraryCandidates, globalTrackCacheCandidates] = await Promise.all([
    db
      .collection<{
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
      }>(USER_TRACK_LIBRARY_COLLECTION)
      .find({
        spotifyUserId,
        $or: [
          ...uniqueTrackIds.map((trackId) => ({ trackId })),
          ...uniqueTrackArtistPairs.map(({ trackName, artistName }) => ({ normalizedTrackArtistKey: buildTrackArtistKey(trackName, artistName) })),
        ],
      })
      .sort({ totalPlayCount: -1, lastPlayedAt: -1 })
      .limit(250)
      .toArray(),
    db
      .collection<{
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
      }>(TRACK_METADATA_COLLECTION)
      .find({
        $or: [
          ...uniqueTrackIds.map((trackId) => ({ trackId })),
          ...uniqueTrackArtistPairs.map(({ trackName, artistName }) => ({ normalizedTrackArtistKey: buildTrackArtistKey(trackName, artistName) })),
        ],
      })
      .limit(250)
      .toArray(),
  ]);

  return [
    ...libraryCandidates.map((candidate) => ({ ...candidate })),
    ...globalTrackCacheCandidates.map((candidate) => ({ ...candidate })),
  ];
}

function finalizeImportedPlay(play: ParsedLastFmPlay, candidate?: TrackMetadataCandidate) {
  return applyMetadataCandidate(play, candidate);
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

function buildSpotifySearchQueries(play: Pick<StoredRecentPlay, "trackName" | "artistName" | "albumName">) {
  return [
    `track:${play.trackName} artist:${play.artistName} album:${play.albumName}`,
    `"${play.trackName}" "${play.artistName}" "${play.albumName}"`,
  ];
}

function pickBestSpotifySearchTrack(
  items: SpotifyTrack[],
  play: Pick<StoredRecentPlay, "trackName" | "artistName" | "albumName">,
) {
  if (items.length === 0) {
    return undefined;
  }

  const exactTrackName = normalizeText(play.trackName);
  const exactArtistName = normalizeText(play.artistName);
  const exactAlbumName = normalizeText(play.albumName);

  return (
    items.find((track) =>
      normalizeText(track.name) === exactTrackName &&
      normalizeText(track.album.name) === exactAlbumName &&
      track.artists.some((artist) => normalizeText(artist.name) === exactArtistName),
    )
  );
}

async function searchSpotifyTrackMetadata(accessToken: string, play: ParsedLastFmPlay) {
  for (const query of buildSpotifySearchQueries(play)) {
    const response = await spotifyFetch<SpotifySearchTracksResponse>(
      `/search?type=track&limit=10&q=${encodeURIComponent(query)}`,
      accessToken,
    ).catch(() => null);
    const items = response?.tracks?.items ?? [];
    const preferred = pickBestSpotifySearchTrack(items, play);
    if (preferred) {
      return toMetadataCandidateFromSpotifyTrack(preferred);
    }
  }

  return undefined;
}

async function searchSpotifyTrackMetadataForStoredPlay(
  accessToken: string,
  play: Pick<StoredRecentPlay, "trackName" | "artistName" | "albumName">,
) {
  for (const query of buildSpotifySearchQueries(play)) {
    const response = await spotifyFetch<SpotifySearchTracksResponse>(
      `/search?type=track&limit=10&q=${encodeURIComponent(query)}`,
      accessToken,
    ).catch(() => null);
    const items = response?.tracks?.items ?? [];
    const preferred = pickBestSpotifySearchTrack(items, play);
    if (preferred) {
      return toMetadataCandidateFromSpotifyTrack(preferred);
    }
  }

  return undefined;
}

async function getSpotifyTrackMetadataById(accessToken: string, rawSpotifyTrackIdOrLink: string) {
  const spotifyTrackId = parseSpotifyTrackId(rawSpotifyTrackIdOrLink);
  if (!spotifyTrackId) {
    throw new Error("Enter a valid Spotify track link or URI.");
  }

  const track = await spotifyFetch<SpotifyTrack>(`/tracks/${encodeURIComponent(spotifyTrackId)}`, accessToken);
  return toMetadataCandidateFromSpotifyTrack(track);
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
        return finalizeImportedPlay(play, cachedCandidate);
      }

      if (!spotifyToken) {
        return finalizeImportedPlay(play);
      }

      const spotifyLookupKey = `${play.trackName}::${play.artistName}`;
      if (!spotifySearchCache.has(spotifyLookupKey)) {
        spotifySearchCache.set(spotifyLookupKey, (await searchSpotifyTrackMetadata(spotifyToken, play)) ?? null);
      }

      return finalizeImportedPlay(play, spotifySearchCache.get(spotifyLookupKey) ?? undefined);
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

async function upsertPermanentLibrariesFromImportedPlays(
  db: Awaited<ReturnType<typeof getDatabase>>,
  spotifyUserId: string,
  plays: StoredRecentPlay[],
) {
  if (!db || plays.length === 0) {
    return;
  }

  const now = new Date().toISOString();
  const trackGroups = new Map<string, {
    trackId: string;
    trackName: string;
    artistName: string;
    normalizedTrackArtistKey?: string;
    normalizedNameKey?: string;
    artistNames?: string[];
    artistIds?: string[];
    albumName: string;
    durationMs?: number;
    imageUrl?: string;
    totalPlayCount: number;
    lastPlayedAt: string;
  }>();
  const artistGroups = new Map<string, {
    artistKey: string;
    artistId?: string;
    name: string;
    totalPlayCount: number;
    lastPlayedAt: string;
  }>();
  const albumGroups = new Map<string, {
    albumKey: string;
    albumId?: string;
    name: string;
    artistName: string;
    artistNames?: string[];
    artistIds?: string[];
    imageUrl?: string;
    trackIds: string[];
    totalPlayCount: number;
    lastPlayedAt: string;
  }>();

  plays.forEach((play) => {
    const existingTrack = trackGroups.get(play.trackId);
    trackGroups.set(play.trackId, {
      trackId: play.trackId,
      trackName: play.trackName,
      artistName: play.artistName,
      normalizedTrackArtistKey: buildTrackArtistKey(play.trackName, play.artistName),
      normalizedNameKey: buildNameKey(play.trackName, play.artistName, play.albumName),
      artistNames: play.artistNames,
      artistIds: play.artistIds,
      albumName: play.albumName,
      durationMs: play.durationMs,
      imageUrl: play.imageUrl,
      totalPlayCount: (existingTrack?.totalPlayCount ?? 0) + 1,
      lastPlayedAt: existingTrack?.lastPlayedAt && existingTrack.lastPlayedAt > play.playedAt ? existingTrack.lastPlayedAt : play.playedAt,
    });

    toArtistKeys(play).forEach((artist) => {
      const existingArtist = artistGroups.get(artist.artistKey);
      artistGroups.set(artist.artistKey, {
        artistKey: artist.artistKey,
        artistId: artist.artistId,
        name: artist.name,
        totalPlayCount: (existingArtist?.totalPlayCount ?? 0) + 1,
        lastPlayedAt: existingArtist?.lastPlayedAt && existingArtist.lastPlayedAt > play.playedAt ? existingArtist.lastPlayedAt : play.playedAt,
      });
    });

    const albumKey = toAlbumKey(play);
    const existingAlbum = albumGroups.get(albumKey);
    albumGroups.set(albumKey, {
      albumKey,
      albumId: existingAlbum?.albumId,
      name: play.albumName,
      artistName: play.artistName,
      artistNames: play.artistNames,
      artistIds: play.artistIds,
      imageUrl: play.imageUrl ?? existingAlbum?.imageUrl,
      trackIds: [...new Set([...(existingAlbum?.trackIds ?? []), play.trackId])],
      totalPlayCount: (existingAlbum?.totalPlayCount ?? 0) + 1,
      lastPlayedAt: existingAlbum?.lastPlayedAt && existingAlbum.lastPlayedAt > play.playedAt ? existingAlbum.lastPlayedAt : play.playedAt,
    });
  });

  const trackOps = [...trackGroups.values()].map((record) => ({
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
          albumName: record.albumName,
          durationMs: record.durationMs,
          imageUrl: record.imageUrl,
          lastPlayedAt: record.lastPlayedAt,
          updatedAt: now,
        },
        $inc: {
          totalPlayCount: record.totalPlayCount,
        },
      },
      upsert: true,
    },
  }));
  const artistOps = [...artistGroups.values()].map((record) => ({
    updateOne: {
      filter: { spotifyUserId, artistKey: record.artistKey },
      update: {
        $set: {
          artistId: record.artistId,
          name: record.name,
          lastPlayedAt: record.lastPlayedAt,
          updatedAt: now,
        },
        $inc: {
          totalPlayCount: record.totalPlayCount,
        },
      },
      upsert: true,
    },
  }));
  const albumOps = [...albumGroups.values()].map((record) => ({
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
          updatedAt: now,
        },
        $inc: {
          totalPlayCount: record.totalPlayCount,
        },
      },
      upsert: true,
    },
  }));

  await Promise.all([
    trackOps.length > 0 ? db.collection(USER_TRACK_LIBRARY_COLLECTION).bulkWrite(trackOps, { ordered: false }) : Promise.resolve(),
    artistOps.length > 0 ? db.collection(USER_ARTIST_LIBRARY_COLLECTION).bulkWrite(artistOps, { ordered: false }) : Promise.resolve(),
    albumOps.length > 0 ? db.collection(USER_ALBUM_LIBRARY_COLLECTION).bulkWrite(albumOps, { ordered: false }) : Promise.resolve(),
    albumOps.length > 0
      ? db.collection(ALBUM_METADATA_COLLECTION).bulkWrite(
        [...albumGroups.values()].map((record) => ({
          updateOne: {
            filter: { albumKey: record.albumKey },
            update: {
              $set: {
                albumKey: record.albumKey,
                albumId: record.albumId,
                name: record.name,
                artistName: record.artistName,
                artistNames: record.artistNames,
                artistIds: record.artistIds,
                imageUrl: record.imageUrl,
                trackIds: record.trackIds,
                updatedAt: now,
              },
            },
            upsert: true,
          },
        })),
        { ordered: false },
      )
      : Promise.resolve(),
  ]);
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
    await upsertPermanentLibrariesFromImportedPlays(db, spotifyUserId, enrichedNewPlays).catch(() => undefined);

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

export async function listUnresolvedImportedLastFmGroups(
  spotifyUserId: string,
  page = 1,
  pageSize = 12,
) {
  if (!hasMongoConfig()) {
    return {
      items: [] as UnresolvedImportedLastFmGroup[],
      totalCount: 0,
      page,
      pageSize,
      totalPages: 0,
    };
  }

  const db = await getDatabase({ forceRetry: true });
  if (!db) {
    return {
      items: [] as UnresolvedImportedLastFmGroup[],
      totalCount: 0,
      page,
      pageSize,
      totalPages: 0,
    };
  }

  const safePage = Math.max(1, page);
  const safePageSize = Math.max(1, Math.min(50, pageSize));
  const skip = (safePage - 1) * safePageSize;

  const [result] = await db.collection<StoredRecentPlay>(RECENT_PLAYS_COLLECTION).aggregate<{
    items: UnresolvedImportedLastFmGroup[];
    total: Array<{ count: number }>;
  }>([
    {
      $match: {
        spotifyUserId,
        sourceType: LASTFM_IMPORT_SOURCE_TYPE,
        trackId: { $regex: "^lastfm:" },
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
        earliestPlayedAt: { $min: "$playedAt" },
        latestPlayedAt: { $max: "$playedAt" },
      },
    },
    {
      $facet: {
        items: [
          { $sort: { latestPlayedAt: -1, playCount: -1 } },
          { $skip: skip },
          { $limit: safePageSize },
          {
            $project: {
              _id: 0,
              trackName: "$_id.trackName",
              artistName: "$_id.artistName",
              albumName: "$_id.albumName",
              playCount: 1,
              earliestPlayedAt: 1,
              latestPlayedAt: 1,
            },
          },
        ],
        total: [
          { $count: "count" },
        ],
      },
    },
  ]).toArray();

  const totalCount = result?.total?.[0]?.count ?? 0;
  return {
    items: result?.items ?? [],
    totalCount,
    page: safePage,
    pageSize: safePageSize,
    totalPages: totalCount > 0 ? Math.ceil(totalCount / safePageSize) : 0,
  };
}

export async function resolveImportedLastFmGroupWithSpotifyTrack(
  spotifyUserId: string,
  group: Pick<UnresolvedImportedLastFmGroup, "trackName" | "artistName" | "albumName">,
  rawSpotifyTrackIdOrLink: string,
  accessToken: string,
): Promise<ResolveImportedLastFmGroupResult> {
  if (!hasMongoConfig()) {
    return {
      matchedPlayCount: 0,
      updatedPlayCount: 0,
      deletedDuplicatePlayCount: 0,
      trackId: "",
    };
  }

  const db = await getDatabase({ forceRetry: true });
  if (!db) {
    return {
      matchedPlayCount: 0,
      updatedPlayCount: 0,
      deletedDuplicatePlayCount: 0,
      trackId: "",
    };
  }

  const metadata = await getSpotifyTrackMetadataById(accessToken, rawSpotifyTrackIdOrLink);
  if (!metadata.trackId) {
    throw new Error("Could not load that Spotify track.");
  }

  const matchingImportedPlays = await db.collection<StoredRecentPlay>(RECENT_PLAYS_COLLECTION)
    .find({
      spotifyUserId,
      sourceType: LASTFM_IMPORT_SOURCE_TYPE,
      trackId: { $regex: "^lastfm:" },
      trackName: group.trackName,
      artistName: group.artistName,
      albumName: group.albumName,
    })
    .toArray();

  if (matchingImportedPlays.length === 0) {
    return {
      matchedPlayCount: 0,
      updatedPlayCount: 0,
      deletedDuplicatePlayCount: 0,
      trackId: metadata.trackId,
    };
  }

  const existingResolvedPlays = await db.collection<StoredRecentPlay>(RECENT_PLAYS_COLLECTION)
    .find({
      spotifyUserId,
      trackId: metadata.trackId,
      playedAt: { $in: matchingImportedPlays.map((play) => play.playedAt) },
    })
    .toArray();
  const existingByPlayedAt = new Map(existingResolvedPlays.map((play) => [play.playedAt, play]));

  let updatedPlayCount = 0;
  let deletedDuplicatePlayCount = 0;
  const resolvedPlaysForMetadata: StoredRecentPlay[] = [];

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

    const resolvedPlay: StoredRecentPlay = {
      ...play,
      trackId: metadata.trackId ?? play.trackId,
      trackName: metadata.trackName || play.trackName,
      artistName: metadata.artistName || play.artistName,
      artistNames: metadata.artistNames?.length ? metadata.artistNames : play.artistNames,
      artistIds: metadata.artistIds?.length ? metadata.artistIds : play.artistIds,
      albumName: metadata.albumName || play.albumName,
      durationMs: metadata.durationMs ?? play.durationMs,
      imageUrl: metadata.imageUrl ?? play.imageUrl,
    };

    resolvedPlaysForMetadata.push(resolvedPlay);
    updatedPlayCount += 1;

    return {
      updateOne: {
        filter: { _id: play._id },
        update: {
          $set: {
            trackId: resolvedPlay.trackId,
            trackName: resolvedPlay.trackName,
            artistName: resolvedPlay.artistName,
            artistNames: resolvedPlay.artistNames,
            artistIds: resolvedPlay.artistIds,
            albumName: resolvedPlay.albumName,
            durationMs: resolvedPlay.durationMs,
            imageUrl: resolvedPlay.imageUrl,
          },
        },
      },
    };
  });

  if (bulkOps.length > 0) {
    await db.collection<StoredRecentPlay>(RECENT_PLAYS_COLLECTION).bulkWrite(bulkOps, { ordered: false });
  }

  if (resolvedPlaysForMetadata.length > 0) {
    await upsertStoredTrackMetadataFromRecentPlays(resolvedPlaysForMetadata).catch(() => undefined);
  }

  const staleSyntheticTrackIds = [...new Set(
    matchingImportedPlays
      .map((play) => play.trackId)
      .filter((trackId): trackId is string => Boolean(trackId) && /^lastfm:/i.test(trackId)),
  )];
  if (staleSyntheticTrackIds.length > 0) {
    await db.collection(TRACK_METADATA_COLLECTION).deleteMany({
      trackId: { $in: staleSyntheticTrackIds },
    }).catch(() => undefined);
  }

  await invalidateLastFmImportCaches(spotifyUserId).catch(() => undefined);

  return {
    matchedPlayCount: matchingImportedPlays.length,
    updatedPlayCount,
    deletedDuplicatePlayCount,
    trackId: metadata.trackId,
  };
}

export async function deleteImportedLastFmScrobbles(spotifyUserId: string) {
  if (!hasMongoConfig()) {
    return { deletedCount: 0, resetLibraries: false };
  }

  const db = await getDatabase({ forceRetry: true });
  if (!db) {
    return { deletedCount: 0, resetLibraries: false };
  }

  const importedPlays = await db.collection<StoredRecentPlay>(RECENT_PLAYS_COLLECTION)
    .find({
      spotifyUserId,
      sourceType: LASTFM_IMPORT_SOURCE_TYPE,
    })
    .project({ trackId: 1 })
    .toArray();
  const importedTrackIdsToForget = [...new Set(
    importedPlays
      .map((play) => play.trackId)
      .filter((trackId): trackId is string => Boolean(trackId) && (/^local:/i.test(trackId) || /^lastfm:/i.test(trackId))),
  )];

  const result = await db.collection<StoredRecentPlay>(RECENT_PLAYS_COLLECTION).deleteMany({
    spotifyUserId,
    sourceType: LASTFM_IMPORT_SOURCE_TYPE,
  });

  await Promise.all([
    db.collection(USER_TRACK_LIBRARY_COLLECTION).deleteMany({ spotifyUserId }),
    db.collection(USER_ARTIST_LIBRARY_COLLECTION).deleteMany({ spotifyUserId }),
    db.collection(USER_ALBUM_LIBRARY_COLLECTION).deleteMany({ spotifyUserId }),
    db.collection(USER_LIBRARY_STATE_COLLECTION).deleteMany({ spotifyUserId }),
    db.collection(ALL_TIME_TOP_LISTS_STATE_COLLECTION).deleteMany({ spotifyUserId }),
    importedTrackIdsToForget.length > 0
      ? db.collection(TRACK_METADATA_COLLECTION).deleteMany({ trackId: { $in: importedTrackIdsToForget } })
      : Promise.resolve(),
  ]);

  return {
    deletedCount: result.deletedCount ?? 0,
    resetLibraries: true,
  };
}

export async function normalizeImportedLastFmScrobbles(
  spotifyUserId: string,
  accessToken?: string,
  options?: {
    limitDistinctTracks?: number;
    onProgress?: (detail: string) => void | Promise<void>;
    onCheckpoint?: (state: {
      processedNameKeys: string[];
      processedTrackGroups: number;
      totalTrackGroups: number;
      matchedTrackGroups: number;
      unresolvedTrackGroups: number;
      updatedPlayCount: number;
      deletedDuplicatePlayCount: number;
      timedOutTrackGroups: number;
    }) => void | Promise<void>;
    perTrackTimeoutMs?: number;
    maxRuntimeMs?: number;
    excludeNameKeys?: string[];
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
      processedNameKeys: [],
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
      processedNameKeys: [],
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
      processedNameKeys: [],
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

  const excludedNameKeys = new Set(options?.excludeNameKeys ?? []);
  const groupedCandidates = [...new Map(
    unresolvedPlays.map((play) => [
      buildNameKey(play.trackName, play.artistName, play.albumName),
      play,
    ]),
  ).entries()]
    .filter(([nameKey]) => !excludedNameKeys.has(nameKey))
    .map(([, play]) => play)
    .slice(0, options?.limitDistinctTracks ?? 250);

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
  const processedNameKeys: string[] = [];

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
    processedNameKeys.push(buildNameKey(candidate.trackName, candidate.artistName, candidate.albumName));
    if (metadata === NORMALIZATION_TIMEOUT) {
      timedOutTrackGroups += 1;
      unresolvedTrackGroups += 1;
      await options?.onCheckpoint?.({
        processedNameKeys: [...processedNameKeys],
        processedTrackGroups,
        totalTrackGroups: groupedCandidates.length,
        matchedTrackGroups,
        unresolvedTrackGroups,
        updatedPlayCount,
        deletedDuplicatePlayCount,
        timedOutTrackGroups,
      });
      await options?.onProgress?.(
        `Skipping slow or unresolved imported track ${processedTrackGroups}/${groupedCandidates.length}. Progress is saved and the next refresh can continue.`,
      );
      continue;
    }
    if (!metadata?.trackId) {
      unresolvedTrackGroups += 1;
      await options?.onCheckpoint?.({
        processedNameKeys: [...processedNameKeys],
        processedTrackGroups,
        totalTrackGroups: groupedCandidates.length,
        matchedTrackGroups,
        unresolvedTrackGroups,
        updatedPlayCount,
        deletedDuplicatePlayCount,
        timedOutTrackGroups,
      });
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

    await options?.onCheckpoint?.({
      processedNameKeys: [...processedNameKeys],
      processedTrackGroups,
      totalTrackGroups: groupedCandidates.length,
      matchedTrackGroups,
      unresolvedTrackGroups,
      updatedPlayCount,
      deletedDuplicatePlayCount,
      timedOutTrackGroups,
    });
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
    processedNameKeys,
  };
}

export async function refreshLastFmImportCaches(spotifyUserId: string, accessToken?: string) {
  invalidateDashboardSnapshotCaches(spotifyUserId);
  invalidateTopListHistoryCache(spotifyUserId);
  invalidateDashboardPlaylistPreviewCache(spotifyUserId);
  invalidatePlaylistInsightsCache(spotifyUserId);
  invalidateDashboardOverviewRuntimeCache(spotifyUserId);
  invalidateDashboardSectionRuntimeCache(spotifyUserId);
  await resetStoredAllTimeTopListAggregate(spotifyUserId).catch(() => undefined);

  await Promise.all([
    writeStoredDashboardOverviewCache(spotifyUserId, accessToken).catch(() => undefined),
    writeStoredDashboardSectionCache(spotifyUserId, accessToken).catch(() => undefined),
  ]);
}

export async function invalidateLastFmImportCaches(spotifyUserId: string) {
  invalidateDashboardSnapshotCaches(spotifyUserId);
  invalidateTopListHistoryCache(spotifyUserId);
  invalidateDashboardPlaylistPreviewCache(spotifyUserId);
  invalidatePlaylistInsightsCache(spotifyUserId);
  invalidateDashboardOverviewRuntimeCache(spotifyUserId);
  invalidateDashboardSectionRuntimeCache(spotifyUserId);
  await resetStoredAllTimeTopListAggregate(spotifyUserId).catch(() => undefined);
}
