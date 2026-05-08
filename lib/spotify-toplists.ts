import { getDatabase, hasMongoConfig } from "@/lib/mongodb";
import { getCachedValue, invalidateCachedValue } from "@/lib/runtime-cache";
import { getSpotifyClientCredentialsToken, spotifyFetch } from "@/lib/spotify";
import { getIgnoredPlaylistFilterData, shouldIgnoreRecentPlayByRules } from "@/lib/ignored-playlists";
import { getStoredTrackMetadataMap, StoredTrackMetadata, toTrackMetadataFromSpotifyTrack, upsertStoredTrackMetadataFromSpotifyTracks } from "@/lib/track-metadata-cache";
import {
  SpotifyArtist,
  SpotifyDashboardSnapshot,
  SpotifyTimeRange,
  SpotifyTrack,
  SpotifyTopArtistsResponse,
  SpotifyTopTracksResponse,
  StoredRecentPlay,
  SnapshotTopListRange,
  SnapshotTopListsCache,
  TopListAlbum,
  TopListArtist,
  TopListRange,
  TopListTrack,
  TopListsData,
} from "@/lib/types";
import { PST_TIME_ZONE } from "@/lib/time";

export const DASHBOARD_TOP_LIST_LIMIT = 5;
export const FULL_TOP_LIST_LIMIT = 50;
export const SNAPSHOT_TOP_LISTS_SCHEMA_VERSION = 2;
const SNAPSHOT_HISTORY_COLLECTION = "spotify_snapshots_history";
const RECENT_PLAYS_COLLECTION = "spotify_recent_plays";
const ALL_TIME_TOP_LIST_AGGREGATE_COLLECTION = "dashboard_top_lists_all_time_aggregate";
const MIN_RECENT_PLAYS_FOR_TOPS = 5;
const TOP_LIST_HISTORY_TTL_MS = 1000 * 30;
const MAX_RECENT_PLAYS_FOR_TOPS_SCOPED = 5000;
const MAX_RECENT_PLAYS_FOR_TOPS_EXTENDED = 250000;

function getTopListSourceLimit(limit: number) {
  return Math.min(FULL_TOP_LIST_LIMIT, Math.max(limit, 20, limit * 4));
}
type SnapshotListPair = {
  artists: SpotifyArtist[];
  tracks: SpotifyTopTracksResponse["items"];
};

type RecentPlayTopLists = TopListsData & {
  playCount: number;
};

export type TopListHistoryData = {
  snapshots: SpotifyDashboardSnapshot[];
  recentPlays: StoredRecentPlay[];
};

type TopListHistoryOptions = {
  allowCatalogLookup?: boolean;
};

type TrackMetadataCandidate = StoredTrackMetadata;
type SpotifyTracksByIdsResponse = {
  tracks?: Array<SpotifyTrack | null>;
};
type SpotifySearchTracksResponse = {
  tracks?: {
    items: SpotifyTrack[];
  };
};

function getArtistGenres(artist: Pick<SpotifyArtist, "genres">) {
  return Array.isArray(artist.genres) ? artist.genres : [];
}

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function buildTrackArtistKey(trackName: string, artistName: string) {
  return `${normalizeText(trackName)}::${normalizeText(artistName)}`;
}

function buildTrackNameKey(trackName: string, artistName: string, albumName: string) {
  return `${normalizeText(trackName)}::${normalizeText(artistName)}::${normalizeText(albumName)}`;
}
function getPacificDateParts(value: string | Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: PST_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(new Date(value));

  const lookup = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return {
    year: Number(lookup.year),
    month: Number(lookup.month),
    day: Number(lookup.day),
    hour: lookup.hour,
  };
}

function toIsoDayStart(value: string) {
  return new Date(`${value}T00:00:00.000Z`).toISOString();
}

function toIsoDayEnd(value: string) {
  return new Date(`${value}T23:59:59.999Z`).toISOString();
}

function getWindow(range: TopListRange, from?: string, to?: string) {
  const now = Date.now();

  if (range === "week") {
    return { from: new Date(now - 1000 * 60 * 60 * 24 * 7).toISOString() };
  }

  if (range === "month") {
    return { from: new Date(now - 1000 * 60 * 60 * 24 * 30).toISOString() };
  }

  if (range === "year") {
    return { from: new Date(now - 1000 * 60 * 60 * 24 * 365).toISOString() };
  }

  if (range === "custom" && from && to) {
    return { from: toIsoDayStart(from), to: toIsoDayEnd(to) };
  }

  return {};
}

function filterSnapshotsForTopRange(snapshots: SpotifyDashboardSnapshot[], range: TopListRange, from?: string, to?: string) {
  const window = getWindow(range, from, to);

  return snapshots.filter((snapshot) => {
    if (window.from && snapshot.fetchedAt < window.from) {
      return false;
    }

    if (window.to && snapshot.fetchedAt > window.to) {
      return false;
    }

    return true;
  });
}

function getTopListSnapshotBucketKey(snapshot: SpotifyDashboardSnapshot, range: TopListRange) {
  const { year, month, day, hour } = getPacificDateParts(snapshot.fetchedAt);
  const paddedMonth = String(month).padStart(2, "0");
  const paddedDay = String(day).padStart(2, "0");

  if (range === "all" || range === "year") {
    return `${year}-${paddedMonth}-${paddedDay}`;
  }

  return `${year}-${paddedMonth}-${paddedDay}-${hour}`;
}

function downsampleSnapshotsForTopRange(snapshots: SpotifyDashboardSnapshot[], range: TopListRange) {
  const buckets = new Map<string, SpotifyDashboardSnapshot>();

  snapshots.forEach((snapshot) => {
    const bucketKey = getTopListSnapshotBucketKey(snapshot, range);
    const existing = buckets.get(bucketKey);

    if (!existing || new Date(snapshot.fetchedAt).getTime() > new Date(existing.fetchedAt).getTime()) {
      buckets.set(bucketKey, snapshot);
    }
  });

  return [...buckets.values()].sort((a, b) => new Date(b.fetchedAt).getTime() - new Date(a.fetchedAt).getTime());
}

function getFallbackSpotifyRange(range: TopListRange): SpotifyTimeRange {
  if (range === "week") {
    return "short_term";
  }

  if (range === "month") {
    return "medium_term";
  }

  return "long_term";
}

function getSnapshotListsForRange(snapshot: SpotifyDashboardSnapshot, range: TopListRange, from?: string, to?: string): SnapshotListPair {
  if (range === "week") {
    return {
      artists: snapshot.topArtists,
      tracks: snapshot.topTracks,
    };
  }

  if (range === "month") {
    return {
      artists: snapshot.mediumTermTopArtists ?? snapshot.topArtists,
      tracks: snapshot.mediumTermTopTracks ?? snapshot.topTracks,
    };
  }

  if (range === "year" || range === "all") {
    return {
      artists: snapshot.longTermTopArtists ?? snapshot.mediumTermTopArtists ?? snapshot.topArtists,
      tracks: snapshot.longTermTopTracks ?? snapshot.mediumTermTopTracks ?? snapshot.topTracks,
    };
  }

  if (range === "custom" && from && to) {
    const spanMs = new Date(`${to}T23:59:59.999Z`).getTime() - new Date(`${from}T00:00:00.000Z`).getTime();
    const spanDays = Math.max(1, Math.ceil(spanMs / (1000 * 60 * 60 * 24)));

    if (spanDays <= 14) {
      return {
        artists: snapshot.topArtists,
        tracks: snapshot.topTracks,
      };
    }

    if (spanDays <= 120) {
      return {
        artists: snapshot.mediumTermTopArtists ?? snapshot.topArtists,
        tracks: snapshot.mediumTermTopTracks ?? snapshot.topTracks,
      };
    }

    return {
      artists: snapshot.longTermTopArtists ?? snapshot.mediumTermTopArtists ?? snapshot.topArtists,
      tracks: snapshot.longTermTopTracks ?? snapshot.mediumTermTopTracks ?? snapshot.topTracks,
    };
  }

  return {
    artists: snapshot.mediumTermTopArtists ?? snapshot.topArtists,
    tracks: snapshot.mediumTermTopTracks ?? snapshot.topTracks,
  };
}

function trimTopListsData(topLists: TopListsData, limit: number, from?: string, to?: string): TopListsData {
  return normalizeTopListsDataRanking({
    ...topLists,
    artists: topLists.artists.slice(0, limit),
    tracks: topLists.tracks.slice(0, limit),
    albums: topLists.albums.slice(0, limit),
    from: from ?? topLists.from,
    to: to ?? topLists.to,
  });
}

export function normalizeTopListsDataRanking(topLists: TopListsData): TopListsData {
  const shouldSortArtists = topLists.artists.some((artist) => typeof artist.listenCount === "number");
  const shouldSortTracks = topLists.tracks.some((track) => typeof track.listenCount === "number");
  const shouldSortAlbums = topLists.albums.some((album) => typeof album.listenCount === "number");

  return {
    ...topLists,
    artists: shouldSortArtists
      ? [...topLists.artists]
        .sort((a, b) => (b.listenCount ?? 0) - (a.listenCount ?? 0) || a.rank - b.rank || a.name.localeCompare(b.name))
        .map((artist, index) => ({ ...artist, rank: index + 1 }))
      : topLists.artists,
    tracks: shouldSortTracks
      ? [...topLists.tracks]
        .sort((a, b) => (b.listenCount ?? 0) - (a.listenCount ?? 0) || b.popularity - a.popularity || a.rank - b.rank || a.title.localeCompare(b.title))
        .map((track, index) => ({ ...track, rank: index + 1 }))
      : topLists.tracks,
    albums: shouldSortAlbums
      ? [...topLists.albums]
        .sort((a, b) => (b.listenCount ?? 0) - (a.listenCount ?? 0) || b.trackCount - a.trackCount || b.score - a.score || a.rank - b.rank || a.name.localeCompare(b.name))
        .map((album, index) => ({ ...album, rank: index + 1 }))
      : topLists.albums,
  };
}

function hydrateArtistImagesFromSnapshot(snapshot: SpotifyDashboardSnapshot, topLists: TopListsData): TopListsData {
  const snapshotArtists = [
    ...snapshot.topArtists,
    ...(snapshot.mediumTermTopArtists ?? []),
    ...(snapshot.longTermTopArtists ?? []),
  ];
  const artistImageById = new Map(
    snapshotArtists
      .filter((artist) => artist?.id && artist.images?.[0]?.url)
      .map((artist) => [artist.id, artist.images?.[0]?.url as string]),
  );

  return {
    ...topLists,
    artists: topLists.artists.map((artist) => ({
      ...artist,
      imageUrl: artistImageById.get(artist.id) ?? artist.imageUrl,
    })),
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

function buildTrackMetadataFromSnapshots(snapshots: SpotifyDashboardSnapshot[]) {
  const metadata = new Map<string, TrackMetadataCandidate>();

  snapshots.forEach((snapshot) => {
    collectSnapshotTrackCandidates(snapshot).forEach((track) => {
      const candidate = toTrackMetadataFromSpotifyTrack(track);
      if (!candidate?.trackId) {
        return;
      }

      const existing = metadata.get(candidate.trackId);
      if (!existing || (!existing.imageUrl && candidate.imageUrl)) {
        metadata.set(candidate.trackId, {
          ...candidate,
          updatedAt: new Date().toISOString(),
        });
      }
    });
  });

  return metadata;
}

function buildTrackMetadataFromRecentPlays(recentPlays: StoredRecentPlay[]) {
  const metadata = new Map<string, TrackMetadataCandidate>();

  recentPlays.forEach((play) => {
    if (!play.trackId) {
      return;
    }

    const existing = metadata.get(play.trackId);
    const candidate: TrackMetadataCandidate = {
      trackId: play.trackId,
      trackName: play.trackName,
      artistName: play.artistName,
      artistNames: play.artistNames,
      artistIds: play.artistIds,
      albumName: play.albumName,
      durationMs: play.durationMs,
      imageUrl: play.imageUrl,
      updatedAt: new Date().toISOString(),
    };

    if (!existing || (!existing.imageUrl && candidate.imageUrl)) {
      metadata.set(play.trackId, candidate);
    }
  });

  return metadata;
}

function buildTrackMetadataAliasMaps(metadataByTrackId: Map<string, TrackMetadataCandidate>) {
  const byTrackNameKey = new Map<string, TrackMetadataCandidate>();
  const byTrackArtistKey = new Map<string, TrackMetadataCandidate>();

  metadataByTrackId.forEach((metadata) => {
    const trackNameKey = buildTrackNameKey(metadata.trackName, metadata.artistName, metadata.albumName);
    const trackArtistKey = buildTrackArtistKey(metadata.trackName, metadata.artistName);

    if (!byTrackNameKey.has(trackNameKey)) {
      byTrackNameKey.set(trackNameKey, metadata);
    }

    if (!byTrackArtistKey.has(trackArtistKey)) {
      byTrackArtistKey.set(trackArtistKey, metadata);
    }
  });

  return { byTrackNameKey, byTrackArtistKey };
}

type CanonicalTrackPlay = StoredRecentPlay & {
  canonicalTrackId: string;
};

type AllTimeTopListAggregateCategory = "artists" | "tracks" | "albums";

type AllTimeArtistAggregateEntry = {
  id: string;
  name: string;
  genres: string[];
  imageUrl?: string;
  playCount: number;
  score: number;
  lastPlayedAt: string;
};

type AllTimeTrackAggregateEntry = {
  id: string;
  title: string;
  artist: string;
  album: string;
  popularity: number;
  imageUrl?: string;
  playCount: number;
  score: number;
  lastPlayedAt: string;
};

type AllTimeAlbumAggregateEntry = {
  id: string;
  name: string;
  artist: string;
  trackCount: number;
  score: number;
  imageUrl?: string;
  playCount: number;
  lastPlayedAt: string;
};

type StoredAllTimeTopListAggregateDocument<TEntry> = {
  spotifyUserId: string;
  category: AllTimeTopListAggregateCategory;
  updatedAt: string;
  lastProcessedPlayedAt: string;
  entries: TEntry[];
};

function buildCanonicalTrackIdMaps(
  recentPlays: StoredRecentPlay[],
  snapshots: SpotifyDashboardSnapshot[],
  storedMetadata: Map<string, TrackMetadataCandidate>,
  seedMaps?: {
    byTrackNameKey?: Map<string, string>;
    byTrackArtistKey?: Map<string, string>;
  },
) {
  const byTrackNameKey = new Map<string, string>(seedMaps?.byTrackNameKey ?? []);
  const byTrackArtistKey = new Map<string, string>(seedMaps?.byTrackArtistKey ?? []);

  const remember = (trackId: string | undefined, trackName: string, artistName: string, albumName: string) => {
    if (!trackId || trackId.startsWith("lastfm:")) {
      return;
    }

    const trackNameKey = buildTrackNameKey(trackName, artistName, albumName);
    const trackArtistKey = buildTrackArtistKey(trackName, artistName);

    if (!byTrackNameKey.has(trackNameKey)) {
      byTrackNameKey.set(trackNameKey, trackId);
    }

    if (!byTrackArtistKey.has(trackArtistKey)) {
      byTrackArtistKey.set(trackArtistKey, trackId);
    }
  };

  recentPlays.forEach((play) => remember(play.trackId, play.trackName, play.artistName, play.albumName));
  snapshots.forEach((snapshot) => {
    collectSnapshotTrackCandidates(snapshot).forEach((track) => {
      remember(
        track.id,
        track.name,
        track.artists.map((artist) => artist.name).join(", "),
        track.album.name,
      );
    });
  });
  [...storedMetadata.values()].forEach((track) => {
    remember(track.trackId, track.trackName, track.artistName, track.albumName);
  });

  return { byTrackNameKey, byTrackArtistKey };
}

function canonicalizeRecentPlays(
  recentPlays: StoredRecentPlay[],
  snapshots: SpotifyDashboardSnapshot[],
  storedMetadata: Map<string, TrackMetadataCandidate>,
  seedMaps?: {
    byTrackNameKey?: Map<string, string>;
    byTrackArtistKey?: Map<string, string>;
  },
) {
  const { byTrackNameKey, byTrackArtistKey } = buildCanonicalTrackIdMaps(recentPlays, snapshots, storedMetadata, seedMaps);

  return recentPlays.map((play) => {
    const metadataTrackId = storedMetadata.get(play.trackId)?.trackId;
    const canonicalTrackId =
      (play.trackId && !play.trackId.startsWith("lastfm:") ? play.trackId : undefined) ??
      (metadataTrackId && !metadataTrackId.startsWith("lastfm:") ? metadataTrackId : undefined) ??
      byTrackNameKey.get(buildTrackNameKey(play.trackName, play.artistName, play.albumName)) ??
      byTrackArtistKey.get(buildTrackArtistKey(play.trackName, play.artistName)) ??
      play.trackId;

    return {
      ...play,
      canonicalTrackId,
    } satisfies CanonicalTrackPlay;
  });
}

function hydrateTopListsWithTrackMetadata(
  topLists: TopListsData,
  metadataByTrackId: Map<string, TrackMetadataCandidate>,
) {
  let changed = false;
  const aliasMaps = buildTrackMetadataAliasMaps(metadataByTrackId);
  const tracks = topLists.tracks.map((track) => {
    const metadata =
      metadataByTrackId.get(track.id) ??
      aliasMaps.byTrackNameKey.get(buildTrackNameKey(track.title, track.artist, track.album)) ??
      aliasMaps.byTrackArtistKey.get(buildTrackArtistKey(track.title, track.artist));
    if (!metadata) {
      return track;
    }

    const nextImageUrl = track.imageUrl ?? metadata.imageUrl;
    const nextAlbum = track.album || metadata.albumName;
    const nextArtist = track.artist || metadata.artistName;
    const nextId = track.id.startsWith("lastfm:") && metadata.trackId && !metadata.trackId.startsWith("lastfm:")
      ? metadata.trackId
      : track.id;
    if (nextImageUrl === track.imageUrl && nextAlbum === track.album && nextArtist === track.artist && nextId === track.id) {
      return track;
    }

    changed = true;
    return {
      ...track,
      id: nextId,
      imageUrl: nextImageUrl,
      album: nextAlbum,
      artist: nextArtist,
    };
  });

  const albumImageByKey = new Map<string, string>();
  tracks.forEach((track) => {
    if (!track.imageUrl) {
      return;
    }

    albumImageByKey.set(`${track.album}::${track.artist}`.toLowerCase(), track.imageUrl);
  });

  const albums = topLists.albums.map((album) => {
    const nextImageUrl = album.imageUrl ?? albumImageByKey.get(`${album.name}::${album.artist}`.toLowerCase());
    if (nextImageUrl === album.imageUrl) {
      return album;
    }

    changed = true;
    return {
      ...album,
      imageUrl: nextImageUrl,
    };
  });

  return changed ? { ...topLists, tracks, albums } : topLists;
}

async function hydrateTopListsTrackMetadata(
  topLists: TopListsData,
  recentPlays: StoredRecentPlay[],
  snapshots: SpotifyDashboardSnapshot[],
  accessToken?: string,
  options?: TopListHistoryOptions,
) {
  const trackIds = topLists.tracks.map((track) => track.id).filter(Boolean);
  if (trackIds.length === 0) {
    return topLists;
  }

  const storedMetadata = await getStoredTrackMetadataMap(trackIds);
  const missingTrackIds = trackIds.filter((trackId) => !storedMetadata.get(trackId)?.imageUrl);
  let metadataByTrackId = new Map(storedMetadata);

  if (missingTrackIds.length > 0) {
    const fromRecentPlays = buildTrackMetadataFromRecentPlays(recentPlays);
    const fromSnapshots = buildTrackMetadataFromSnapshots(snapshots);
    const cachedBackfilledTracks = missingTrackIds
      .map((trackId) => fromRecentPlays.get(trackId) ?? fromSnapshots.get(trackId))
      .filter((track): track is TrackMetadataCandidate => Boolean(track));

    if (cachedBackfilledTracks.length > 0) {
      await upsertStoredTrackMetadataFromSpotifyTracks(
        cachedBackfilledTracks.map((track) => ({
          id: track.trackId,
          name: track.trackName,
          popularity: 0,
          duration_ms: track.durationMs ?? 0,
          album: {
            name: track.albumName,
            images: track.imageUrl ? [{ url: track.imageUrl }] : undefined,
          },
          artists: (track.artistNames?.length ? track.artistNames : track.artistName.split(/,\s*/))
            .filter(Boolean)
            .map((name, index) => ({ name, id: track.artistIds?.[index] })),
        })),
      ).catch(() => undefined);
    }

    const stillMissingTrackIds = missingTrackIds.filter((trackId) => {
      const cachedCandidate = fromRecentPlays.get(trackId) ?? fromSnapshots.get(trackId);
      return !cachedCandidate?.imageUrl;
    });

    const spotifyCatalogToken = options?.allowCatalogLookup === false
      ? ""
      : (accessToken || await getSpotifyClientCredentialsToken().catch(() => ""));

    if (spotifyCatalogToken && stillMissingTrackIds.length > 0) {
      const spotifyResolvableTrackIds = stillMissingTrackIds.filter((trackId) => !trackId.startsWith("lastfm:"));
      const spotifySearchCandidates = topLists.tracks.filter((track) =>
        stillMissingTrackIds.includes(track.id) && track.id.startsWith("lastfm:"),
      );

      if (spotifyResolvableTrackIds.length > 0) {
        const spotifyResponses = await Promise.all(
          Array.from({ length: Math.ceil(spotifyResolvableTrackIds.length / 50) }, (_, index) =>
            spotifyFetch<SpotifyTracksByIdsResponse>(
              `/tracks?ids=${spotifyResolvableTrackIds.slice(index * 50, index * 50 + 50).join(",")}`,
              spotifyCatalogToken,
            ).catch(() => ({ tracks: [] })),
          ),
        );

        const spotifyTracks = spotifyResponses
          .flatMap((response) => response.tracks ?? [])
          .filter((track): track is SpotifyTrack => Boolean(track?.id));

        if (spotifyTracks.length > 0) {
          await upsertStoredTrackMetadataFromSpotifyTracks(spotifyTracks).catch(() => undefined);
        }
      }

      if (spotifySearchCandidates.length > 0) {
        const spotifySearchCache = new Map<string, SpotifyTrack | null>();
        const spotifySearchResults = await Promise.all(
          spotifySearchCandidates.map(async (track) => {
            const lookupKey = `${track.title}::${track.artist}`;
            if (!spotifySearchCache.has(lookupKey)) {
              const query = `track:${track.title} artist:${track.artist.split(",")[0]?.trim() ?? track.artist}`;
              const response = await spotifyFetch<SpotifySearchTracksResponse>(
                `/search?type=track&limit=5&q=${encodeURIComponent(query)}`,
                spotifyCatalogToken,
              ).catch(() => null);
              const items = response?.tracks?.items ?? [];
              const preferred =
                items.find((item) =>
                  normalizeText(item.name) === normalizeText(track.title) &&
                  item.artists.some((artist) => normalizeText(track.artist).includes(normalizeText(artist.name))),
                ) ??
                items.find((item) =>
                  item.artists.some((artist) => normalizeText(track.artist).includes(normalizeText(artist.name))),
                ) ??
                items[0] ??
                null;
              spotifySearchCache.set(lookupKey, preferred);
            }

            return spotifySearchCache.get(lookupKey);
          }),
        );

        const spotifyTracks = spotifySearchResults.filter((track): track is SpotifyTrack => Boolean(track?.id));
        if (spotifyTracks.length > 0) {
          await upsertStoredTrackMetadataFromSpotifyTracks(spotifyTracks).catch(() => undefined);
        }
      }
    }

    metadataByTrackId = await getStoredTrackMetadataMap(trackIds);
  }

  return hydrateTopListsWithTrackMetadata(topLists, metadataByTrackId);
}

export async function hydrateTopListsDataMetadata(
  topLists: TopListsData,
  recentPlays: StoredRecentPlay[],
  snapshots: SpotifyDashboardSnapshot[],
  accessToken?: string,
  options?: TopListHistoryOptions,
) {
  return normalizeTopListsDataRanking(await hydrateTopListsTrackMetadata(topLists, recentPlays, snapshots, accessToken, options));
}

function getSnapshotCachedTopLists(snapshot: SpotifyDashboardSnapshot, range: TopListRange, limit: number, from?: string, to?: string) {
  if (range === "custom") {
    return null;
  }

  if ((snapshot.schemaVersion ?? 0) < SNAPSHOT_TOP_LISTS_SCHEMA_VERSION || !snapshot.cachedTopLists) {
    return null;
  }

  const cacheKey: SnapshotTopListRange = range === "all" ? "all" : range;
  const cached = snapshot.cachedTopLists[cacheKey];
  if (!cached) {
    return null;
  }

  return trimTopListsData(hydrateArtistImagesFromSnapshot(snapshot, cached), limit, from, to);
}

export function buildCachedTopListsForSnapshot(snapshot: Pick<SpotifyDashboardSnapshot, "topArtists" | "topTracks" | "mediumTermTopArtists" | "mediumTermTopTracks" | "longTermTopArtists" | "longTermTopTracks" | "fetchedAt">): SnapshotTopListsCache {
  const buildRange = (range: SnapshotTopListRange, artistsSource: SpotifyArtist[] | undefined, tracksSource: SpotifyTopTracksResponse["items"] | undefined): TopListsData => {
    const artists = toArtistList(artistsSource ?? [], Math.min(FULL_TOP_LIST_LIMIT, artistsSource?.length ?? 0));
    const tracks = toTrackList(tracksSource ?? [], Math.min(FULL_TOP_LIST_LIMIT, tracksSource?.length ?? 0));

    return {
      range,
      artists,
      tracks,
      albums: deriveAlbumsFromTracks(tracks, FULL_TOP_LIST_LIMIT),
      sourceLabel: "Cached Spotify snapshot",
      generatedAt: snapshot.fetchedAt,
    };
  };

  return {
    week: buildRange("week", snapshot.topArtists, snapshot.topTracks),
    month: buildRange("month", snapshot.mediumTermTopArtists ?? snapshot.topArtists, snapshot.mediumTermTopTracks ?? snapshot.topTracks),
    year: buildRange("year", snapshot.longTermTopArtists ?? snapshot.mediumTermTopArtists ?? snapshot.topArtists, snapshot.longTermTopTracks ?? snapshot.mediumTermTopTracks ?? snapshot.topTracks),
    all: buildRange("all", snapshot.longTermTopArtists ?? snapshot.mediumTermTopArtists ?? snapshot.topArtists, snapshot.longTermTopTracks ?? snapshot.mediumTermTopTracks ?? snapshot.topTracks),
  };
}

function deriveAlbumsFromTracks(tracks: TopListTrack[], limit: number): TopListAlbum[] {
  const albumMap = new Map<string, Omit<TopListAlbum, "rank">>();

  tracks.forEach((track) => {
    const key = `${track.album}::${track.artist}`.toLowerCase();
    const weight = tracks.length - track.rank + 1;
    const existing = albumMap.get(key) ?? {
      id: key,
      name: track.album,
      artist: track.artist,
      trackCount: 0,
      score: 0,
      imageUrl: track.imageUrl,
      listenCount: 0,
    };

    existing.trackCount += 1;
    existing.score += weight + Math.round(track.popularity / 10);
    existing.listenCount = (existing.listenCount ?? 0) + (track.listenCount ?? 0);
    if (!existing.imageUrl && track.imageUrl) {
      existing.imageUrl = track.imageUrl;
    }

    albumMap.set(key, existing);
  });

  return [...albumMap.values()]
    .sort((a, b) => b.score - a.score || b.trackCount - a.trackCount || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((album, index) => ({
      ...album,
      rank: index + 1,
    }));
}

function toArtistList(items: SpotifyArtist[], limit: number): TopListArtist[] {
  return items.slice(0, limit).map((artist, index) => ({
    id: artist.id,
    rank: index + 1,
    name: artist.name,
    genres: getArtistGenres(artist),
    imageUrl: artist.images?.[0]?.url,
  }));
}

function toTrackList(items: SpotifyTopTracksResponse["items"], limit: number): TopListTrack[] {
  return items.slice(0, limit).map((track, index) => ({
    id: track.id,
    rank: index + 1,
    title: track.name,
    artist: track.artists.map((artist) => artist.name).join(", "),
    album: track.album.name,
    popularity: track.popularity,
    imageUrl: track.album.images?.[0]?.url,
  }));
}

async function enrichArtistsWithGenres(accessToken: string, artists: SpotifyArtist[]) {
  const uniqueArtistIds = [...new Set(artists.map((artist) => artist.id).filter(Boolean))].slice(0, 200);

  if (uniqueArtistIds.length === 0) {
    return artists.map((artist) => ({ ...artist, genres: getArtistGenres(artist) }));
  }

  try {
    const chunks = Array.from({ length: Math.ceil(uniqueArtistIds.length / 50) }, (_, index) => uniqueArtistIds.slice(index * 50, index * 50 + 50));
    const responses = await Promise.all(chunks.map((chunk) => spotifyFetch<{ artists: SpotifyArtist[] }>(`/artists?ids=${chunk.join(",")}`, accessToken)));
    const metadataById = new Map(responses.flatMap((response) => response.artists ?? []).filter((artist) => artist?.id).map((artist) => [artist.id, artist]));

    return artists.map((artist) => {
      const metadataArtist = metadataById.get(artist.id);
      if (!metadataArtist) {
        return { ...artist, genres: getArtistGenres(artist) };
      }

      return {
        ...artist,
        ...metadataArtist,
        genres: getArtistGenres(metadataArtist).length > 0 ? getArtistGenres(metadataArtist) : getArtistGenres(artist),
        images: metadataArtist.images?.length ? metadataArtist.images : artist.images,
        popularity: Math.max(metadataArtist.popularity ?? 0, artist.popularity ?? 0),
      };
    });
  } catch {
    return artists.map((artist) => ({ ...artist, genres: getArtistGenres(artist) }));
  }
}

function aggregateArtistsFromSnapshots(snapshots: SpotifyDashboardSnapshot[], range: TopListRange, limit: number, from?: string, to?: string): TopListArtist[] {
  const artistMap = new Map<string, TopListArtist & { score: number }>();

  snapshots.forEach((snapshot) => {
    const artists = getSnapshotListsForRange(snapshot, range, from, to).artists;

    artists.forEach((artist, index) => {
      const existing = artistMap.get(artist.id) ?? {
        id: artist.id,
        rank: 0,
        name: artist.name,
        genres: getArtistGenres(artist),
        imageUrl: artist.images?.[0]?.url,
        score: 0,
      };

      existing.score += Math.max(1, 16 - index);
      existing.genres = [...new Set([...(existing.genres ?? []), ...getArtistGenres(artist)])];
      if (!existing.imageUrl && artist.images?.[0]?.url) {
        existing.imageUrl = artist.images[0].url;
      }

      artistMap.set(artist.id, existing);
    });
  });

  return [...artistMap.values()]
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((artist, index) => ({
      id: artist.id,
      rank: index + 1,
      name: artist.name,
      genres: artist.genres ?? [],
      imageUrl: artist.imageUrl,
    }));
}

function aggregateTracksFromSnapshots(snapshots: SpotifyDashboardSnapshot[], range: TopListRange, limit: number, from?: string, to?: string): TopListTrack[] {
  const trackMap = new Map<string, TopListTrack & { score: number }>();

  snapshots.forEach((snapshot) => {
    const tracks = getSnapshotListsForRange(snapshot, range, from, to).tracks;

    tracks.forEach((track, index) => {
      const existing = trackMap.get(track.id) ?? {
        id: track.id,
        rank: 0,
        title: track.name,
        artist: track.artists.map((artist) => artist.name).join(", "),
        album: track.album.name,
        popularity: track.popularity,
        imageUrl: track.album.images?.[0]?.url,
        score: 0,
      };

      existing.score += Math.max(1, 16 - index);
      existing.popularity = Math.max(existing.popularity, track.popularity);
      if (!existing.imageUrl && track.album.images?.[0]?.url) {
        existing.imageUrl = track.album.images[0].url;
      }

      trackMap.set(track.id, existing);
    });
  });

  return [...trackMap.values()]
    .sort((a, b) => b.score - a.score || b.popularity - a.popularity || a.title.localeCompare(b.title))
    .slice(0, limit)
    .map((track, index) => ({
      id: track.id,
      rank: index + 1,
      title: track.title,
      artist: track.artist,
      album: track.album,
      popularity: track.popularity,
      imageUrl: track.imageUrl,
    }));
}

function buildArtistMetadataFromSnapshots(snapshots: SpotifyDashboardSnapshot[]) {
  const metadata = new Map<string, { genres: string[]; imageUrl?: string }>();

  snapshots.forEach((snapshot) => {
    const artists = [
      ...snapshot.topArtists,
      ...(snapshot.mediumTermTopArtists ?? []),
      ...(snapshot.longTermTopArtists ?? []),
    ];

    artists.forEach((artist) => {
      const keys = [artist.id, artist.name.toLowerCase()].filter(Boolean);
      keys.forEach((key) => {
        const existing = metadata.get(key) ?? { genres: [], imageUrl: undefined };
        existing.genres = [...new Set([...existing.genres, ...getArtistGenres(artist)])];
        if (!existing.imageUrl && artist.images?.[0]?.url) {
          existing.imageUrl = artist.images[0].url;
        }
        metadata.set(key, existing);
      });
    });

    Object.values(snapshot.cachedTopLists ?? {}).forEach((cachedList) => {
      cachedList.artists.forEach((artist) => {
        const keys = [artist.id, artist.name.toLowerCase()].filter(Boolean);
        keys.forEach((key) => {
          const existing = metadata.get(key) ?? { genres: [], imageUrl: undefined };
          existing.genres = [...new Set([...existing.genres, ...(artist.genres ?? [])])];
          if (!existing.imageUrl && artist.imageUrl) {
            existing.imageUrl = artist.imageUrl;
          }
          metadata.set(key, existing);
        });
      });
    });
  });

  return metadata;
}

function getStoredPlayArtists(play: StoredRecentPlay) {
  const artistNames =
    Array.isArray(play.artistNames) && play.artistNames.length > 0
      ? play.artistNames
      : Array.isArray(play.artistIds) && play.artistIds.length === 1
        ? [play.artistName]
        : play.artistName
            .split(", ")
            .map((artist) => artist.trim())
            .filter(Boolean);

  return artistNames.map((name, index) => ({
    name,
    id: play.artistIds?.[index],
  }));
}

async function fetchSpotifyArtistMetadata(accessToken: string, artistIds: string[]) {
  const uniqueArtistIds = [...new Set(artistIds.filter(Boolean))].slice(0, 200);

  if (uniqueArtistIds.length === 0) {
    return new Map<string, SpotifyArtist>();
  }

  try {
    const chunks = Array.from({ length: Math.ceil(uniqueArtistIds.length / 50) }, (_, index) => uniqueArtistIds.slice(index * 50, index * 50 + 50));
    const responses = await Promise.all(chunks.map((chunk) => spotifyFetch<{ artists: SpotifyArtist[] }>(`/artists?ids=${chunk.join(",")}`, accessToken)));
    return new Map(
      responses
        .flatMap((response) => response.artists ?? [])
        .filter((artist) => artist?.id)
        .map((artist) => [artist.id, artist]),
    );
  } catch {
    return new Map<string, SpotifyArtist>();
  }
}

function recentPlaysToArtistIds(recentPlays: StoredRecentPlay[]) {
  return recentPlays.flatMap((play) => play.artistIds ?? []).filter(Boolean);
}

async function enrichRecentPlayTopListArtists(
  accessToken: string | undefined,
  recentPlayTopLists: RecentPlayTopLists,
  recentPlays: StoredRecentPlay[],
  range: TopListRange,
  limit: number,
  snapshotArtistMetadata?: Map<string, { genres: string[]; imageUrl?: string }>,
) {
  const needsArtistMetadata = recentPlayTopLists.artists.some((artist) => !artist.imageUrl || artist.genres.length === 0);

  if (!needsArtistMetadata) {
    return recentPlayTopLists;
  }

  try {
    const spotifyArtistMetadata = accessToken
      ? await fetchSpotifyArtistMetadata(accessToken, recentPlaysToArtistIds(recentPlays))
      : new Map<string, SpotifyArtist>();
    const fallback = accessToken ? await getFallbackSpotifyTopLists(accessToken, range, limit) : null;
    const fallbackArtistMap = new Map((fallback?.artists ?? []).map((artist) => [artist.name.toLowerCase(), artist]));

    recentPlayTopLists.artists = recentPlayTopLists.artists.map((artist) => {
      const spotifyArtist = spotifyArtistMetadata.get(artist.id);
      const fallbackArtist = fallbackArtistMap.get(artist.name.toLowerCase());
      const snapshotArtist = snapshotArtistMetadata?.get(artist.id) ?? snapshotArtistMetadata?.get(artist.name.toLowerCase());
      const preferredArtistImage = spotifyArtist?.images?.[0]?.url ?? fallbackArtist?.imageUrl ?? snapshotArtist?.imageUrl;

      return {
        ...artist,
        imageUrl: preferredArtistImage ?? artist.imageUrl,
        genres: artist.genres.length > 0
          ? artist.genres
          : (spotifyArtist
            ? getArtistGenres(spotifyArtist)
            : (fallbackArtist?.genres ?? snapshotArtist?.genres ?? [])),
      };
    });
  } catch {
    // Keep recent-play rankings even if metadata enrichment fails.
  }

  return recentPlayTopLists;
}

function deriveRecentArtists(recentPlays: StoredRecentPlay[], limit: number, artistMetadata: Map<string, { genres: string[]; imageUrl?: string }>): TopListArtist[] {
  const artistMap = new Map<string, { id: string; name: string; score: number; playCount: number; lastPlayedAt: string; imageUrl?: string; genres: string[] }>();

  recentPlays.forEach((play, index) => {
    const recencyWeight = Math.max(1, recentPlays.length - index);

    getStoredPlayArtists(play).forEach(({ name: artistName, id: artistId }) => {
      const key = artistName.toLowerCase();
      const metadata = artistId ? (artistMetadata.get(artistId) ?? artistMetadata.get(key)) : artistMetadata.get(key);
      const lookupKey = artistId ?? key;
      const existing = artistMap.get(lookupKey) ?? {
        id: artistId ?? key,
        name: artistName,
        score: 0,
        playCount: 0,
        lastPlayedAt: play.playedAt,
        imageUrl: metadata?.imageUrl ?? play.imageUrl,
        genres: metadata?.genres ?? [],
      };

      existing.score += 100 + recencyWeight;
      existing.playCount += 1;
      if (play.playedAt > existing.lastPlayedAt) {
        existing.lastPlayedAt = play.playedAt;
      }
      if (!existing.imageUrl && metadata?.imageUrl) {
        existing.imageUrl = metadata.imageUrl;
      } else if (!existing.imageUrl && play.imageUrl) {
        existing.imageUrl = play.imageUrl;
      }
      if (existing.genres.length === 0 && metadata?.genres?.length) {
        existing.genres = metadata.genres;
      }
      artistMap.set(lookupKey, existing);
    });
  });

  return [...artistMap.values()]
    .sort((a, b) => b.playCount - a.playCount || b.score - a.score || b.lastPlayedAt.localeCompare(a.lastPlayedAt) || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((artist, index) => ({
      id: artist.id,
      rank: index + 1,
      name: artist.name,
      genres: artist.genres,
      imageUrl: artist.imageUrl,
      listenCount: artist.playCount,
    }));
}

function deriveRecentTracks(recentPlays: CanonicalTrackPlay[], limit: number): TopListTrack[] {
  const trackMap = new Map<string, TopListTrack & { score: number; playCount: number; lastPlayedAt: string }>();

  recentPlays.forEach((play, index) => {
    const recencyWeight = Math.max(1, recentPlays.length - index);
    const existing = trackMap.get(play.canonicalTrackId) ?? {
      id: play.canonicalTrackId,
      rank: 0,
      title: play.trackName,
      artist: play.artistName,
      album: play.albumName,
      popularity: 0,
      imageUrl: play.imageUrl,
      score: 0,
      playCount: 0,
      lastPlayedAt: play.playedAt,
    };

    existing.score += 100 + recencyWeight;
    existing.playCount += 1;
    existing.popularity = Math.min(100, existing.playCount * 12 + Math.min(40, recencyWeight));
    if (play.playedAt > existing.lastPlayedAt) {
      existing.lastPlayedAt = play.playedAt;
    }
    if (!existing.imageUrl && play.imageUrl) {
      existing.imageUrl = play.imageUrl;
    }

    trackMap.set(play.canonicalTrackId, existing);
  });

  return [...trackMap.values()]
    .sort((a, b) => b.playCount - a.playCount || b.score - a.score || b.lastPlayedAt.localeCompare(a.lastPlayedAt))
    .slice(0, limit)
    .map((track, index) => ({
      id: track.id,
      rank: index + 1,
      title: track.title,
      artist: track.artist,
      album: track.album,
      popularity: track.popularity,
      imageUrl: track.imageUrl,
      listenCount: track.playCount,
    }));
}

function deriveRecentAlbums(recentPlays: CanonicalTrackPlay[], limit: number): TopListAlbum[] {
  const albumMap = new Map<string, Omit<TopListAlbum, "rank"> & { playCount: number; lastPlayedAt: string }>();

  recentPlays.forEach((play, index) => {
    const recencyWeight = Math.max(1, recentPlays.length - index);
    const key = `${play.albumName}::${play.artistName}`.toLowerCase();
    const existing = albumMap.get(key) ?? {
      id: key,
      name: play.albumName,
      artist: play.artistName,
      trackCount: 0,
      score: 0,
      imageUrl: play.imageUrl,
      playCount: 0,
      lastPlayedAt: play.playedAt,
    };

    existing.score += 100 + recencyWeight;
    existing.playCount += 1;
    existing.trackCount += 1;
    if (play.playedAt > existing.lastPlayedAt) {
      existing.lastPlayedAt = play.playedAt;
    }
    if (!existing.imageUrl && play.imageUrl) {
      existing.imageUrl = play.imageUrl;
    }

    albumMap.set(key, existing);
  });

  return [...albumMap.values()]
    .sort((a, b) => b.playCount - a.playCount || b.score - a.score || b.lastPlayedAt.localeCompare(a.lastPlayedAt))
    .slice(0, limit)
    .map((album, index) => ({
      id: album.id,
      rank: index + 1,
      name: album.name,
      artist: album.artist,
      trackCount: album.trackCount,
      score: album.score,
      imageUrl: album.imageUrl,
      listenCount: album.playCount,
    }));
}

function buildAggregateSeedMapsFromTrackEntries(trackEntries: AllTimeTrackAggregateEntry[]) {
  const byTrackNameKey = new Map<string, string>();
  const byTrackArtistKey = new Map<string, string>();

  trackEntries.forEach((track) => {
    if (!track.id || track.id.startsWith("lastfm:")) {
      return;
    }

    const trackNameKey = buildTrackNameKey(track.title, track.artist, track.album);
    const trackArtistKey = buildTrackArtistKey(track.title, track.artist);

    if (!byTrackNameKey.has(trackNameKey)) {
      byTrackNameKey.set(trackNameKey, track.id);
    }

    if (!byTrackArtistKey.has(trackArtistKey)) {
      byTrackArtistKey.set(trackArtistKey, track.id);
    }
  });

  return { byTrackNameKey, byTrackArtistKey };
}

function buildArtistMetadataFromAggregateEntries(artistEntries: AllTimeArtistAggregateEntry[]) {
  const metadata = new Map<string, { genres: string[]; imageUrl?: string }>();

  artistEntries.forEach((artist) => {
    if (!artist.id) {
      return;
    }

    metadata.set(artist.id, {
      genres: artist.genres,
      imageUrl: artist.imageUrl,
    });
  });

  return metadata;
}

function mergeCanonicalPlaysIntoAllTimeAggregate(
  canonicalRecentPlays: CanonicalTrackPlay[],
  artistEntries: AllTimeArtistAggregateEntry[],
  trackEntries: AllTimeTrackAggregateEntry[],
  albumEntries: AllTimeAlbumAggregateEntry[],
  artistMetadata: Map<string, { genres: string[]; imageUrl?: string }>,
) {
  const artistMap = new Map(artistEntries.map((entry) => [`${entry.id}::${entry.name.toLowerCase()}`, { ...entry }]));
  const trackMap = new Map(trackEntries.map((entry) => [entry.id, { ...entry }]));
  const albumMap = new Map(albumEntries.map((entry) => [entry.id, { ...entry }]));

  canonicalRecentPlays.forEach((play, index) => {
    const recencyWeight = Math.max(1, canonicalRecentPlays.length - index);

    play.artistName.split(/,\s*/).forEach((artistName, artistIndex) => {
      const artistId = play.artistIds?.[artistIndex] ?? `${artistName}::${play.trackName}`.toLowerCase();
      const lookupKey = `${artistId}::${artistName.toLowerCase()}`;
      const metadata = play.artistIds?.[artistIndex]
        ? artistMetadata.get(play.artistIds[artistIndex] as string)
        : undefined;
      const existing = artistMap.get(lookupKey) ?? {
        id: artistId,
        name: artistName,
        genres: metadata?.genres ?? [],
        imageUrl: metadata?.imageUrl ?? play.imageUrl,
        playCount: 0,
        score: 0,
        lastPlayedAt: play.playedAt,
      };

      existing.score += 100 + recencyWeight;
      existing.playCount += 1;
      if (play.playedAt > existing.lastPlayedAt) {
        existing.lastPlayedAt = play.playedAt;
      }
      if (!existing.imageUrl && (metadata?.imageUrl || play.imageUrl)) {
        existing.imageUrl = metadata?.imageUrl ?? play.imageUrl;
      }
      if (existing.genres.length === 0 && metadata?.genres?.length) {
        existing.genres = metadata.genres;
      }

      artistMap.set(lookupKey, existing);
    });

    const existingTrack = trackMap.get(play.canonicalTrackId) ?? {
      id: play.canonicalTrackId,
      title: play.trackName,
      artist: play.artistName,
      album: play.albumName,
      popularity: 0,
      imageUrl: play.imageUrl,
      playCount: 0,
      score: 0,
      lastPlayedAt: play.playedAt,
    };

    existingTrack.score += 100 + recencyWeight;
    existingTrack.playCount += 1;
    existingTrack.popularity = Math.min(100, existingTrack.playCount * 12 + Math.min(40, recencyWeight));
    if (play.playedAt > existingTrack.lastPlayedAt) {
      existingTrack.lastPlayedAt = play.playedAt;
    }
    if (!existingTrack.imageUrl && play.imageUrl) {
      existingTrack.imageUrl = play.imageUrl;
    }
    trackMap.set(play.canonicalTrackId, existingTrack);

    const albumKey = `${play.albumName}::${play.artistName}`.toLowerCase();
    const existingAlbum = albumMap.get(albumKey) ?? {
      id: albumKey,
      name: play.albumName,
      artist: play.artistName,
      trackCount: 0,
      score: 0,
      imageUrl: play.imageUrl,
      playCount: 0,
      lastPlayedAt: play.playedAt,
    };

    existingAlbum.score += 100 + recencyWeight;
    existingAlbum.playCount += 1;
    existingAlbum.trackCount += 1;
    if (play.playedAt > existingAlbum.lastPlayedAt) {
      existingAlbum.lastPlayedAt = play.playedAt;
    }
    if (!existingAlbum.imageUrl && play.imageUrl) {
      existingAlbum.imageUrl = play.imageUrl;
    }
    albumMap.set(albumKey, existingAlbum);
  });

  return {
    artists: [...artistMap.values()],
    tracks: [...trackMap.values()],
    albums: [...albumMap.values()],
  };
}

function materializeAllTimeTopListsFromAggregate(
  aggregate: {
    artists: AllTimeArtistAggregateEntry[];
    tracks: AllTimeTrackAggregateEntry[];
    albums: AllTimeAlbumAggregateEntry[];
  },
  limit: number,
): TopListsData {
  return normalizeTopListsDataRanking({
    range: "all",
    artists: [...aggregate.artists]
      .sort((a, b) => b.playCount - a.playCount || b.score - a.score || b.lastPlayedAt.localeCompare(a.lastPlayedAt) || a.name.localeCompare(b.name))
      .slice(0, limit)
      .map((artist, index) => ({
        id: artist.id,
        rank: index + 1,
        name: artist.name,
        genres: artist.genres,
        imageUrl: artist.imageUrl,
        listenCount: artist.playCount,
      })),
    tracks: [...aggregate.tracks]
      .sort((a, b) => b.playCount - a.playCount || b.score - a.score || b.lastPlayedAt.localeCompare(a.lastPlayedAt))
      .slice(0, limit)
      .map((track, index) => ({
        id: track.id,
        rank: index + 1,
        title: track.title,
        artist: track.artist,
        album: track.album,
        popularity: track.popularity,
        imageUrl: track.imageUrl,
        listenCount: track.playCount,
      })),
    albums: [...aggregate.albums]
      .sort((a, b) => b.playCount - a.playCount || b.score - a.score || b.lastPlayedAt.localeCompare(a.lastPlayedAt))
      .slice(0, limit)
      .map((album, index) => ({
        id: album.id,
        rank: index + 1,
        name: album.name,
        artist: album.artist,
        trackCount: album.trackCount,
        score: album.score,
        imageUrl: album.imageUrl,
        listenCount: album.playCount,
      })),
    sourceLabel: "Shared Listening Lore listening history",
    generatedAt: new Date().toISOString(),
  });
}

async function getHistoricalSnapshots(spotifyUserId: string, range: TopListRange, from?: string, to?: string) {
  if (!hasMongoConfig()) {
    return [] as SpotifyDashboardSnapshot[];
  }

  try {
    const db = await getDatabase();
    if (!db) {
      return [] as SpotifyDashboardSnapshot[];
    }

    const window = getWindow(range, from, to);
    const fetchedAt: { $gte?: string; $lte?: string } = {};

    if (window.from) {
      fetchedAt.$gte = window.from;
    }

    if (window.to) {
      fetchedAt.$lte = window.to;
    }

    const query = Object.keys(fetchedAt).length > 0 ? { spotifyUserId, fetchedAt } : { spotifyUserId };

    const snapshots = await db
      .collection<SpotifyDashboardSnapshot>(SNAPSHOT_HISTORY_COLLECTION)
      .find(query)
      .sort({ fetchedAt: -1 })
      .limit(range === "all" || range === "year" ? 365 : 180)
      .toArray();

    return snapshots.length > 0 ? snapshots : [];
  } catch {
    return [] as SpotifyDashboardSnapshot[];
  }
}

function getRecentPlayFetchLimit(range: TopListRange, from?: string, to?: string) {
  if (range === "all" || range === "custom" || from || to) {
    return MAX_RECENT_PLAYS_FOR_TOPS_EXTENDED;
  }

  return MAX_RECENT_PLAYS_FOR_TOPS_SCOPED;
}

async function getRecentPlaysForTopLists(spotifyUserId: string, range: TopListRange, from?: string, to?: string) {
  if (!hasMongoConfig()) {
    return [] as StoredRecentPlay[];
  }

  try {
    const db = await getDatabase();
    if (!db) {
      return [] as StoredRecentPlay[];
    }

    const window = getWindow(range, from, to);
    const playedAt: { $gte?: string; $lte?: string } = {};

    if (window.from) {
      playedAt.$gte = window.from;
    }

    if (window.to) {
      playedAt.$lte = window.to;
    }

    const filterData = await getIgnoredPlaylistFilterData(spotifyUserId).catch(() => null);
    const baseQuery: Record<string, unknown> = Object.keys(playedAt).length > 0 ? { spotifyUserId, playedAt } : { spotifyUserId };
    const query = filterData && filterData.fullyIgnoredPlaylistIds.size > 0
      ? {
        ...baseQuery,
        $or: [
          { playlistId: { $exists: false } },
          { playlistId: null },
          { playlistId: { $nin: [...filterData.fullyIgnoredPlaylistIds] } },
        ],
      }
      : baseQuery;

    const fetchLimit = getRecentPlayFetchLimit(range, from, to);
    const recentPlays = await db
      .collection<StoredRecentPlay>(RECENT_PLAYS_COLLECTION)
      .find(query)
      .sort({ playedAt: -1 })
      .limit(fetchLimit)
      .toArray();

    return filterData
      ? recentPlays.filter((play) => !shouldIgnoreRecentPlayByRules(play, filterData))
      : recentPlays;
  } catch {
    return [] as StoredRecentPlay[];
  }
}

async function getRecentPlaysAfter(spotifyUserId: string, afterPlayedAt: string) {
  if (!hasMongoConfig()) {
    return [] as StoredRecentPlay[];
  }

  try {
    const db = await getDatabase();
    if (!db) {
      return [] as StoredRecentPlay[];
    }

    const filterData = await getIgnoredPlaylistFilterData(spotifyUserId).catch(() => null);
    const baseQuery: Record<string, unknown> = {
      spotifyUserId,
      playedAt: { $gt: afterPlayedAt },
    };
    const query = filterData && filterData.fullyIgnoredPlaylistIds.size > 0
      ? {
        ...baseQuery,
        $or: [
          { playlistId: { $exists: false } },
          { playlistId: null },
          { playlistId: { $nin: [...filterData.fullyIgnoredPlaylistIds] } },
        ],
      }
      : baseQuery;

    const recentPlays = await db
      .collection<StoredRecentPlay>(RECENT_PLAYS_COLLECTION)
      .find(query)
      .sort({ playedAt: 1 })
      .toArray();

    return filterData
      ? recentPlays.filter((play) => !shouldIgnoreRecentPlayByRules(play, filterData))
      : recentPlays;
  } catch {
    return [] as StoredRecentPlay[];
  }
}

function filterRecentPlaysForTopRange(recentPlays: StoredRecentPlay[], range: TopListRange, from?: string, to?: string) {
  const window = getWindow(range, from, to);

  return recentPlays.filter((play) => {
    if (window.from && play.playedAt < window.from) {
      return false;
    }

    if (window.to && play.playedAt > window.to) {
      return false;
    }

    return true;
  });
}

function buildRecentPlayTopLists(
  recentPlays: StoredRecentPlay[],
  range: TopListRange,
  limit: number,
  from?: string,
  to?: string,
  snapshots: SpotifyDashboardSnapshot[] = [],
): RecentPlayTopLists | null {
  const scopedRecentPlays = filterRecentPlaysForTopRange(recentPlays, range, from, to);

  if (scopedRecentPlays.length < MIN_RECENT_PLAYS_FOR_TOPS) {
    return null;
  }

  const canonicalRecentPlays = canonicalizeRecentPlays(scopedRecentPlays, snapshots, buildTrackMetadataFromRecentPlays(scopedRecentPlays));
  const sourceLimit = getTopListSourceLimit(limit);
  const artists = deriveRecentArtists(canonicalRecentPlays, limit, buildArtistMetadataFromSnapshots(snapshots));
  const tracks = deriveRecentTracks(canonicalRecentPlays, limit);
  const albums = deriveRecentAlbums(canonicalRecentPlays, sourceLimit).slice(0, limit);

  return {
    range,
    artists,
    tracks,
    albums,
    playCount: scopedRecentPlays.length,
    sourceLabel: "Listening Lore recent-play history",
    generatedAt: scopedRecentPlays[0]?.playedAt ?? new Date().toISOString(),
    from,
    to,
  };
}

async function getRecentPlayTopLists(
  spotifyUserId: string,
  range: TopListRange,
  limit: number,
  from?: string,
  to?: string,
  snapshots: SpotifyDashboardSnapshot[] = [],
): Promise<{ topLists: RecentPlayTopLists | null; recentPlays: StoredRecentPlay[] }> {
  const recentPlays = await getRecentPlaysForTopLists(spotifyUserId, range, from, to);
  return {
    topLists: buildRecentPlayTopLists(recentPlays, range, limit, from, to, snapshots),
    recentPlays,
  };
}

export async function getTopListHistoryData(spotifyUserId: string, range: TopListRange = "all"): Promise<TopListHistoryData> {
  return getCachedValue(`top-list-history:${spotifyUserId}:${range}`, TOP_LIST_HISTORY_TTL_MS, async () => {
    const [snapshots, recentPlays] = await Promise.all([
      getHistoricalSnapshots(spotifyUserId, range),
      getRecentPlaysForTopLists(spotifyUserId, range),
    ]);

    return { snapshots, recentPlays };
  });
}

export function invalidateTopListHistoryCache(spotifyUserId: string) {
  ["week", "month", "year", "all", "custom"].forEach((range) => {
    invalidateCachedValue(`top-list-history:${spotifyUserId}:${range}`);
  });
}

async function readStoredAllTimeTopListAggregate(spotifyUserId: string) {
  if (!hasMongoConfig()) {
    return null;
  }

  const db = await getDatabase();
  if (!db) {
    return null;
  }

  const docs = await db
    .collection<StoredAllTimeTopListAggregateDocument<unknown>>(ALL_TIME_TOP_LIST_AGGREGATE_COLLECTION)
    .find({ spotifyUserId })
    .toArray();

  if (docs.length < 3) {
    return null;
  }

  const artistsDoc = docs.find((doc) => doc.category === "artists") as StoredAllTimeTopListAggregateDocument<AllTimeArtistAggregateEntry> | undefined;
  const tracksDoc = docs.find((doc) => doc.category === "tracks") as StoredAllTimeTopListAggregateDocument<AllTimeTrackAggregateEntry> | undefined;
  const albumsDoc = docs.find((doc) => doc.category === "albums") as StoredAllTimeTopListAggregateDocument<AllTimeAlbumAggregateEntry> | undefined;

  if (!artistsDoc || !tracksDoc || !albumsDoc) {
    return null;
  }

  return {
    lastProcessedPlayedAt: [artistsDoc.lastProcessedPlayedAt, tracksDoc.lastProcessedPlayedAt, albumsDoc.lastProcessedPlayedAt]
      .sort()
      .at(-1) ?? "",
    artists: artistsDoc.entries,
    tracks: tracksDoc.entries,
    albums: albumsDoc.entries,
  };
}

async function writeStoredAllTimeTopListAggregate(
  spotifyUserId: string,
  aggregate: {
    lastProcessedPlayedAt: string;
    artists: AllTimeArtistAggregateEntry[];
    tracks: AllTimeTrackAggregateEntry[];
    albums: AllTimeAlbumAggregateEntry[];
  },
) {
  if (!hasMongoConfig()) {
    return;
  }

  const db = await getDatabase();
  if (!db) {
    return;
  }

  const updatedAt = new Date().toISOString();
  await db.collection<StoredAllTimeTopListAggregateDocument<unknown>>(ALL_TIME_TOP_LIST_AGGREGATE_COLLECTION).bulkWrite([
    {
      updateOne: {
        filter: { spotifyUserId, category: "artists" },
        update: {
          $set: {
            spotifyUserId,
            category: "artists",
            updatedAt,
            lastProcessedPlayedAt: aggregate.lastProcessedPlayedAt,
            entries: aggregate.artists,
          },
        },
        upsert: true,
      },
    },
    {
      updateOne: {
        filter: { spotifyUserId, category: "tracks" },
        update: {
          $set: {
            spotifyUserId,
            category: "tracks",
            updatedAt,
            lastProcessedPlayedAt: aggregate.lastProcessedPlayedAt,
            entries: aggregate.tracks,
          },
        },
        upsert: true,
      },
    },
    {
      updateOne: {
        filter: { spotifyUserId, category: "albums" },
        update: {
          $set: {
            spotifyUserId,
            category: "albums",
            updatedAt,
            lastProcessedPlayedAt: aggregate.lastProcessedPlayedAt,
            entries: aggregate.albums,
          },
        },
        upsert: true,
      },
    },
  ], { ordered: false });
}

export async function resetStoredAllTimeTopListAggregate(spotifyUserId: string) {
  invalidateCachedValue(`top-list-all-time-aggregate:${spotifyUserId}`);

  if (!hasMongoConfig()) {
    return;
  }

  const db = await getDatabase();
  if (!db) {
    return;
  }

  await db.collection(ALL_TIME_TOP_LIST_AGGREGATE_COLLECTION).deleteMany({ spotifyUserId });
}

export async function getStoredOrBuildIncrementalAllTimeTopLists(
  spotifyUserId: string,
  limit = FULL_TOP_LIST_LIMIT,
  accessToken?: string,
  options?: TopListHistoryOptions,
) {
  const boundedLimit = Math.max(1, Math.min(FULL_TOP_LIST_LIMIT, limit));

  return getCachedValue(`top-list-all-time-aggregate:${spotifyUserId}`, TOP_LIST_HISTORY_TTL_MS, async () => {
    let aggregate = await readStoredAllTimeTopListAggregate(spotifyUserId);
    let snapshots: SpotifyDashboardSnapshot[] = [];
    let recentPlaysForHydration: StoredRecentPlay[] = [];

    if (!aggregate) {
      const history = await getTopListHistoryData(spotifyUserId);
      snapshots = history.snapshots;
      recentPlaysForHydration = history.recentPlays;

      const storedMetadata = buildTrackMetadataFromRecentPlays(history.recentPlays);
      const canonicalRecentPlays = canonicalizeRecentPlays(history.recentPlays, history.snapshots, storedMetadata);
      const artistMetadata = buildArtistMetadataFromSnapshots(history.snapshots);
      const merged = mergeCanonicalPlaysIntoAllTimeAggregate(canonicalRecentPlays, [], [], [], artistMetadata);

      aggregate = {
        ...merged,
        lastProcessedPlayedAt: history.recentPlays[0]?.playedAt ?? "",
      };
    } else if (aggregate.lastProcessedPlayedAt) {
      const newRecentPlays = await getRecentPlaysAfter(spotifyUserId, aggregate.lastProcessedPlayedAt);
      if (newRecentPlays.length > 0) {
        recentPlaysForHydration = newRecentPlays;
        const storedMetadata = buildTrackMetadataFromRecentPlays(newRecentPlays);
        const canonicalRecentPlays = canonicalizeRecentPlays(
          newRecentPlays,
          [],
          storedMetadata,
          buildAggregateSeedMapsFromTrackEntries(aggregate.tracks),
        );
        const artistMetadata = buildArtistMetadataFromAggregateEntries(aggregate.artists);
        const merged = mergeCanonicalPlaysIntoAllTimeAggregate(
          canonicalRecentPlays,
          aggregate.artists,
          aggregate.tracks,
          aggregate.albums,
          artistMetadata,
        );
        aggregate = {
          ...merged,
          lastProcessedPlayedAt: newRecentPlays.at(-1)?.playedAt ?? aggregate.lastProcessedPlayedAt,
        };
      }
    }

    snapshots = snapshots.length > 0 ? snapshots : await getHistoricalSnapshots(spotifyUserId, "all");
    const topLists = materializeAllTimeTopListsFromAggregate(aggregate, boundedLimit);
    const hydrated = await hydrateTopListsTrackMetadata(topLists, recentPlaysForHydration, snapshots, accessToken, options);

    const topTrackById = new Map(hydrated.tracks.map((track) => [track.id, track]));
    const albumImageByKey = new Map(hydrated.albums.map((album) => [`${album.name}::${album.artist}`.toLowerCase(), album.imageUrl]));
    aggregate = {
      ...aggregate,
      tracks: aggregate.tracks.map((track) => {
        const hydratedTrack =
          topTrackById.get(track.id) ??
          hydrated.tracks.find((item) => item.title === track.title && item.artist === track.artist && item.album === track.album);
        return hydratedTrack?.imageUrl && hydratedTrack.imageUrl !== track.imageUrl
          ? { ...track, id: hydratedTrack.id, imageUrl: hydratedTrack.imageUrl }
          : hydratedTrack?.id && hydratedTrack.id !== track.id
            ? { ...track, id: hydratedTrack.id }
            : track;
      }),
      albums: aggregate.albums.map((album) => {
        const imageUrl = album.imageUrl ?? albumImageByKey.get(`${album.name}::${album.artist}`.toLowerCase());
        return imageUrl && imageUrl !== album.imageUrl ? { ...album, imageUrl } : album;
      }),
    };

    await writeStoredAllTimeTopListAggregate(spotifyUserId, aggregate);
    return normalizeTopListsDataRanking({
      ...hydrated,
      generatedAt: aggregate.lastProcessedPlayedAt || new Date().toISOString(),
    });
  });
}

async function getFallbackSpotifyTopLists(accessToken: string, range: TopListRange, limit: number): Promise<TopListsData> {
  const spotifyRange = getFallbackSpotifyRange(range);
  const boundedLimit = Math.max(1, Math.min(FULL_TOP_LIST_LIMIT, limit));
  const sourceLimit = getTopListSourceLimit(boundedLimit);

  const [artistsResponse, tracksResponse] = await Promise.all([
    spotifyFetch<SpotifyTopArtistsResponse>(`/me/top/artists?time_range=${spotifyRange}&limit=${sourceLimit}`, accessToken),
    spotifyFetch<SpotifyTopTracksResponse>(`/me/top/tracks?time_range=${spotifyRange}&limit=${sourceLimit}`, accessToken),
  ]);

  const enrichedArtists = await enrichArtistsWithGenres(accessToken, artistsResponse.items);
  const artists = toArtistList(enrichedArtists, boundedLimit);
  const expandedTracks = toTrackList(tracksResponse.items, sourceLimit);
  const tracks = expandedTracks.slice(0, boundedLimit);
  const albums = deriveAlbumsFromTracks(expandedTracks, boundedLimit);

  return {
    range,
    artists,
    tracks,
    albums,
    sourceLabel: "Spotify affinity fallback",
    generatedAt: new Date().toISOString(),
  };
}

export async function getSpotifyTopListsLive(
  accessToken: string,
  range: TopListRange,
  limit = DASHBOARD_TOP_LIST_LIMIT,
  from?: string,
  to?: string,
): Promise<TopListsData> {
  const boundedLimit = Math.max(1, Math.min(FULL_TOP_LIST_LIMIT, limit));
  const fallback = await getFallbackSpotifyTopLists(accessToken, range, boundedLimit);
  return {
    ...fallback,
    from,
    to,
  };
}

export async function getSpotifyTopLists(
  accessToken: string,
  spotifyUserId: string,
  range: TopListRange,
  limit = DASHBOARD_TOP_LIST_LIMIT,
  from?: string,
  to?: string,
): Promise<TopListsData> {
  const boundedLimit = Math.max(1, Math.min(FULL_TOP_LIST_LIMIT, limit));
  const snapshots = await getHistoricalSnapshots(spotifyUserId, range, from, to);
  const { topLists: recentPlayTopLists, recentPlays } = await getRecentPlayTopLists(spotifyUserId, range, boundedLimit, from, to, snapshots);

  if (recentPlayTopLists) {
    const enrichedArtists = await enrichRecentPlayTopListArtists(
      accessToken,
      recentPlayTopLists,
      recentPlays,
      range,
      boundedLimit,
      buildArtistMetadataFromSnapshots(snapshots),
    );
    return normalizeTopListsDataRanking(await hydrateTopListsTrackMetadata(enrichedArtists, recentPlays, snapshots));
  }

  const cachedTopLists = snapshots.length === 1 ? getSnapshotCachedTopLists(snapshots[0], range, boundedLimit, from, to) : null;

  if (cachedTopLists) {
    return normalizeTopListsDataRanking(await hydrateTopListsTrackMetadata(cachedTopLists, recentPlays, snapshots));
  }

  if (snapshots.length > 0 && (range === "all" || range === "custom")) {
    const sourceLimit = getTopListSourceLimit(boundedLimit);
    const artists = aggregateArtistsFromSnapshots(snapshots, range, boundedLimit, from, to);
    const expandedTracks = aggregateTracksFromSnapshots(snapshots, range, sourceLimit, from, to);
    const tracks = expandedTracks.slice(0, boundedLimit);
    const albums = deriveAlbumsFromTracks(expandedTracks, boundedLimit);

    return normalizeTopListsDataRanking(await hydrateTopListsTrackMetadata({
      range,
      artists,
      tracks,
      albums,
      sourceLabel: snapshots.length > 1 ? "Historical Listening Lore rankings" : "Latest Listening Lore snapshot",
      generatedAt: snapshots[0]?.fetchedAt ?? new Date().toISOString(),
      from,
      to,
    }, recentPlays, snapshots));
  }

  const fallback = await getFallbackSpotifyTopLists(accessToken, range, boundedLimit);
  return normalizeTopListsDataRanking({
    ...fallback,
    from,
    to,
  });
}

export async function getSpotifyTopListsFromSnapshots(
  snapshots: SpotifyDashboardSnapshot[],
  range: TopListRange,
  limit = DASHBOARD_TOP_LIST_LIMIT,
  from?: string,
  to?: string,
) {
  const boundedLimit = Math.max(1, Math.min(FULL_TOP_LIST_LIMIT, limit));
  const scopedSnapshots = filterSnapshotsForTopRange(snapshots, range, from, to);
  const relevantSnapshots = scopedSnapshots.length > 0 ? scopedSnapshots : snapshots;
  const historicalSnapshots = downsampleSnapshotsForTopRange(relevantSnapshots, range);

  if (historicalSnapshots.length === 0) {
    return null;
  }

  const directCachedTopLists = historicalSnapshots.length === 1 ? getSnapshotCachedTopLists(historicalSnapshots[0], range, boundedLimit, from, to) : null;

  if (directCachedTopLists) {
    return directCachedTopLists;
  }

  const sourceLimit = getTopListSourceLimit(boundedLimit);
  const artists = aggregateArtistsFromSnapshots(historicalSnapshots, range, boundedLimit, from, to);
  const expandedTracks = aggregateTracksFromSnapshots(historicalSnapshots, range, sourceLimit, from, to);
  const tracks = expandedTracks.slice(0, boundedLimit);
  const albums = deriveAlbumsFromTracks(expandedTracks, boundedLimit);

  return normalizeTopListsDataRanking({
    range,
    artists,
    tracks,
    albums,
    sourceLabel: historicalSnapshots.length > 1 ? "Historical Spotify snapshots" : "Latest Spotify snapshot",
    generatedAt: historicalSnapshots[0]?.fetchedAt ?? new Date().toISOString(),
    from,
    to,
  } satisfies TopListsData);
}

export async function getSpotifyTopListsFromHistoryData(
  history: TopListHistoryData,
  range: TopListRange,
  limit = DASHBOARD_TOP_LIST_LIMIT,
  from?: string,
  to?: string,
  accessToken?: string,
  options?: TopListHistoryOptions,
) {
  const boundedLimit = Math.max(1, Math.min(FULL_TOP_LIST_LIMIT, limit));
  const snapshots = filterSnapshotsForTopRange(history.snapshots, range, from, to);
  const relevantSnapshots = snapshots.length > 0 ? snapshots : history.snapshots.slice(0, 1);
  const recentPlayTopLists = buildRecentPlayTopLists(history.recentPlays, range, boundedLimit, from, to, relevantSnapshots);

  if (recentPlayTopLists) {
    const enrichedArtists = await enrichRecentPlayTopListArtists(
        accessToken,
        recentPlayTopLists,
        filterRecentPlaysForTopRange(history.recentPlays, range, from, to),
        range,
        boundedLimit,
        buildArtistMetadataFromSnapshots(relevantSnapshots),
      );
    return normalizeTopListsDataRanking(await hydrateTopListsTrackMetadata({
      ...enrichedArtists,
      sourceLabel: "Shared Listening Lore listening history",
    } satisfies TopListsData, filterRecentPlaysForTopRange(history.recentPlays, range, from, to), relevantSnapshots, accessToken, options));
  }

  return getSpotifyTopListsFromSnapshots(relevantSnapshots, range, boundedLimit, from, to);
}

export async function getSpotifyTopListsFromHistory(
  spotifyUserId: string,
  range: TopListRange,
  limit = DASHBOARD_TOP_LIST_LIMIT,
  from?: string,
  to?: string,
  accessToken?: string,
  options?: TopListHistoryOptions,
) {
  const historyRange = range === "custom" || from || to ? "all" : range;
  const history = await getTopListHistoryData(spotifyUserId, historyRange);
  return getSpotifyTopListsFromHistoryData(history, range, limit, from, to, accessToken, options);
}












