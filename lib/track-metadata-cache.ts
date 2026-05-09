import { getDatabase, hasMongoConfig } from "@/lib/mongodb";
import { SpotifyTrack, StoredRecentPlay } from "@/lib/types";

const TRACK_METADATA_COLLECTION = "spotify_track_metadata";

export type StoredTrackMetadata = {
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
  updatedAt: string;
};

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function buildNormalizedTrackArtistKey(trackName: string, artistName: string) {
  return `${normalizeText(trackName)}::${normalizeText(artistName)}`;
}

function buildNormalizedNameKey(trackName: string, artistName: string, albumName: string) {
  return `${normalizeText(trackName)}::${normalizeText(artistName)}::${normalizeText(albumName)}`;
}

function getMetadataQualityScore(candidate: Omit<StoredTrackMetadata, "updatedAt">) {
  return [
    candidate.imageUrl ? 4 : 0,
    candidate.durationMs ? 3 : 0,
    candidate.albumName ? 2 : 0,
    candidate.artistIds?.length ? 2 : 0,
    candidate.artistNames?.length ? 1 : 0,
  ].reduce((sum, value) => sum + value, 0);
}

function chooseBetterTrackMetadata(
  current: Omit<StoredTrackMetadata, "updatedAt"> | undefined,
  candidate: Omit<StoredTrackMetadata, "updatedAt">,
) {
  if (!current) {
    return candidate;
  }

  const currentScore = getMetadataQualityScore(current);
  const candidateScore = getMetadataQualityScore(candidate);

  if (candidateScore !== currentScore) {
    return candidateScore > currentScore ? candidate : current;
  }

  return {
    trackId: current.trackId,
    trackName: current.trackName || candidate.trackName,
    artistName: current.artistName || candidate.artistName,
    normalizedTrackArtistKey: current.normalizedTrackArtistKey || candidate.normalizedTrackArtistKey,
    normalizedNameKey: current.normalizedNameKey || candidate.normalizedNameKey,
    artistNames: current.artistNames?.length ? current.artistNames : candidate.artistNames,
    artistIds: current.artistIds?.length ? current.artistIds : candidate.artistIds,
    albumId: current.albumId ?? candidate.albumId,
    albumName: current.albumName || candidate.albumName,
    durationMs: current.durationMs ?? candidate.durationMs,
    imageUrl: current.imageUrl ?? candidate.imageUrl,
  };
}

function toTrackMetadataFromStoredPlay(play: StoredRecentPlay): Omit<StoredTrackMetadata, "updatedAt"> | null {
  if (!play.trackId) {
    return null;
  }

  return {
    trackId: play.trackId,
    trackName: play.trackName,
    artistName: play.artistName,
    normalizedTrackArtistKey: buildNormalizedTrackArtistKey(play.trackName, play.artistName),
    normalizedNameKey: buildNormalizedNameKey(play.trackName, play.artistName, play.albumName),
    artistNames: play.artistNames,
    artistIds: play.artistIds,
    albumId: undefined,
    albumName: play.albumName,
    durationMs: play.durationMs,
    imageUrl: play.imageUrl,
  };
}

export function toTrackMetadataFromSpotifyTrack(track: SpotifyTrack): Omit<StoredTrackMetadata, "updatedAt"> | null {
  if (!track?.id) {
    return null;
  }

  return {
    trackId: track.id,
    trackName: track.name,
    artistName: track.artists.map((artist) => artist.name).join(", "),
    normalizedTrackArtistKey: buildNormalizedTrackArtistKey(track.name, track.artists.map((artist) => artist.name).join(", ")),
    normalizedNameKey: buildNormalizedNameKey(track.name, track.artists.map((artist) => artist.name).join(", "), track.album.name),
    artistNames: track.artists.map((artist) => artist.name),
    artistIds: track.artists.map((artist) => artist.id).filter((id): id is string => Boolean(id)),
    albumId: track.album.id,
    albumName: track.album.name,
    durationMs: track.duration_ms,
    imageUrl: track.album.images?.[0]?.url,
  };
}

async function upsertStoredTrackMetadataEntries(entries: Array<Omit<StoredTrackMetadata, "updatedAt"> | null>) {
  if (!hasMongoConfig()) {
    return;
  }

  const nextByTrackId = new Map<string, Omit<StoredTrackMetadata, "updatedAt">>();
  entries.forEach((entry) => {
    if (!entry?.trackId) {
      return;
    }

    nextByTrackId.set(entry.trackId, chooseBetterTrackMetadata(nextByTrackId.get(entry.trackId), entry));
  });

  if (nextByTrackId.size === 0) {
    return;
  }

  const db = await getDatabase({ forceRetry: true });
  if (!db) {
    return;
  }

  const records = [...nextByTrackId.values()];
  await db.collection<StoredTrackMetadata>(TRACK_METADATA_COLLECTION).bulkWrite(
    records.map((record) => ({
      updateOne: {
        filter: { trackId: record.trackId },
        update: {
          $set: {
            ...record,
            updatedAt: new Date().toISOString(),
          },
        },
        upsert: true,
      },
    })),
    { ordered: false },
  );
}

export async function upsertStoredTrackMetadataFromRecentPlays(plays: StoredRecentPlay[]) {
  return upsertStoredTrackMetadataEntries(plays.map(toTrackMetadataFromStoredPlay));
}

export async function upsertStoredTrackMetadataFromSpotifyTracks(tracks: SpotifyTrack[]) {
  return upsertStoredTrackMetadataEntries(tracks.map(toTrackMetadataFromSpotifyTrack));
}

export async function getStoredTrackMetadataMap(trackIds: string[]) {
  const uniqueTrackIds = [...new Set(trackIds.filter(Boolean))];

  if (!hasMongoConfig() || uniqueTrackIds.length === 0) {
    return new Map<string, StoredTrackMetadata>();
  }

  const db = await getDatabase();
  if (!db) {
    return new Map<string, StoredTrackMetadata>();
  }

  const records = await db
    .collection<StoredTrackMetadata>(TRACK_METADATA_COLLECTION)
    .find({ trackId: { $in: uniqueTrackIds } })
    .toArray();

  return new Map(records.map((record) => [record.trackId, record]));
}

export { TRACK_METADATA_COLLECTION };
