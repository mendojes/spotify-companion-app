import { getIgnoredPlaylistRules, type IgnoredPlaylistRule } from "@/lib/connected-users";
import { getDatabase, hasMongoConfig } from "@/lib/mongodb";
import { StoredRecentPlay } from "@/lib/types";

const PLAYLIST_LIBRARY_COLLECTION = "spotify_playlist_library";
const PLAYLIST_TRACK_CACHE_COLLECTION = "spotify_playlist_track_cache";

type StoredPlaylistLibraryOwner = {
  id?: string;
  display_name?: string;
};

type StoredPlaylistLibraryRecord = {
  spotifyUserId: string;
  id: string;
  owner?: StoredPlaylistLibraryOwner;
};

type StoredPlaylistTrackCacheRecord = {
  spotifyUserId: string;
  playlistId: string;
  track: { id: string };
  addedById?: string;
};

type IgnoredPlaylistFilterData = {
  rules: IgnoredPlaylistRule[];
  fullyIgnoredPlaylistIds: Set<string>;
  ignoredTrackIdsByPlaylist: Map<string, Set<string>>;
};

function createEmptyIgnoredPlaylistFilterData(rules: IgnoredPlaylistRule[] = []): IgnoredPlaylistFilterData {
  return {
    rules,
    fullyIgnoredPlaylistIds: new Set<string>(),
    ignoredTrackIdsByPlaylist: new Map<string, Set<string>>(),
  };
}

export async function getIgnoredPlaylistFilterData(spotifyUserId: string): Promise<IgnoredPlaylistFilterData> {
  const rules = await getIgnoredPlaylistRules(spotifyUserId).catch(() => [] as IgnoredPlaylistRule[]);

  if (!hasMongoConfig() || rules.length === 0) {
    return createEmptyIgnoredPlaylistFilterData(rules);
  }

  const fullyIgnoredPlaylistIds = new Set(
    rules
      .filter((rule) => rule.mode === "all")
      .map((rule) => rule.playlistId),
  );
  const collaborativeRules = rules.filter((rule) => rule.mode === "others_only");

  if (collaborativeRules.length === 0) {
    return {
      rules,
      fullyIgnoredPlaylistIds,
      ignoredTrackIdsByPlaylist: new Map<string, Set<string>>(),
    };
  }

  const db = await getDatabase();
  if (!db) {
    return {
      rules,
      fullyIgnoredPlaylistIds,
      ignoredTrackIdsByPlaylist: new Map<string, Set<string>>(),
    };
  }

  const collaborativePlaylistIds = collaborativeRules.map((rule) => rule.playlistId);
  const [playlistLibraryRecords, playlistTrackRecords] = await Promise.all([
    db.collection<StoredPlaylistLibraryRecord>(PLAYLIST_LIBRARY_COLLECTION)
      .find({ spotifyUserId, id: { $in: collaborativePlaylistIds } })
      .project({ id: 1, owner: 1 })
      .toArray(),
    db.collection<StoredPlaylistTrackCacheRecord>(PLAYLIST_TRACK_CACHE_COLLECTION)
      .find({ spotifyUserId, playlistId: { $in: collaborativePlaylistIds } })
      .project({ playlistId: 1, track: 1, addedById: 1 })
      .toArray(),
  ]);

  const ownerIdByPlaylistId = new Map(
    playlistLibraryRecords
      .filter((record) => record.id)
      .map((record) => [record.id, record.owner?.id]),
  );
  const ignoredTrackIdsByPlaylist = new Map<string, Set<string>>();

  playlistTrackRecords.forEach((record) => {
    const ownerId = ownerIdByPlaylistId.get(record.playlistId);
    const addedById = record.addedById;
    const trackId = record.track?.id;

    if (!trackId || !ownerId || !addedById || addedById === ownerId) {
      return;
    }

    const existing = ignoredTrackIdsByPlaylist.get(record.playlistId) ?? new Set<string>();
    existing.add(trackId);
    ignoredTrackIdsByPlaylist.set(record.playlistId, existing);
  });

  return {
    rules,
    fullyIgnoredPlaylistIds,
    ignoredTrackIdsByPlaylist,
  };
}

export function shouldIgnoreRecentPlayByRules(
  play: Pick<StoredRecentPlay, "playlistId" | "trackId">,
  filterData: IgnoredPlaylistFilterData,
) {
  if (!play.playlistId) {
    return false;
  }

  if (filterData.fullyIgnoredPlaylistIds.has(play.playlistId)) {
    return true;
  }

  const ignoredTrackIds = filterData.ignoredTrackIdsByPlaylist.get(play.playlistId);
  return Boolean(ignoredTrackIds?.has(play.trackId));
}
