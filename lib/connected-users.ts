import { hasSpotifyConnection, type AuthSession } from "@/lib/auth";
import { getDatabase, hasMongoConfig } from "@/lib/mongodb";
import { getCachedValue, invalidateCachedValue } from "@/lib/runtime-cache";

export type ConnectedUserPrivacySettings = {
  shareProfile: boolean;
  shareTopLists: boolean;
  shareListeningActivity: boolean;
};

export type IgnoredPlaylistMode = "all" | "others_only";

export type IgnoredPlaylistRule = {
  playlistId: string;
  mode: IgnoredPlaylistMode;
};

export type ConnectedUser = {
  spotifyUserId: string;
  displayName: string;
  email?: string;
  imageUrl?: string;
  refreshToken: string;
  privacy?: ConnectedUserPrivacySettings;
  ignoredPlaylists?: IgnoredPlaylistRule[];
  ignoredPlaylistIds?: string[];
  lastSeenAt: string;
  updatedAt: string;
  lastSnapshotAt?: string;
  lastSnapshotStatus?: "success" | "error";
  lastSnapshotError?: string;
  lastRecentSyncAt?: string;
  dashboardEnrichmentStatus?: "pending" | "running" | "success" | "error";
  dashboardEnrichmentRange?: "week" | "month" | "all";
  dashboardEnrichmentStartedAt?: string;
  dashboardEnrichmentFinishedAt?: string;
  dashboardEnrichmentError?: string;
  dashboardEnrichmentDetail?: string;
  dashboardEnrichmentStep?: string;
  artistMetadataBackfillStatus?: "idle" | "pending" | "running" | "success" | "error";
  artistMetadataBackfillStartedAt?: string;
  artistMetadataBackfillFinishedAt?: string;
  artistMetadataBackfillError?: string;
  artistMetadataBackfillCount?: number;
  artistMetadataBackfillDetail?: string;
  artistMetadataBackfillStep?: string;
};

export type CommunityUserProfile = {
  spotifyUserId: string;
  displayName: string;
  imageUrl?: string;
  lastSeenAt: string;
  lastSnapshotAt?: string;
  lastSnapshotStatus?: "success" | "error";
  privacy: ConnectedUserPrivacySettings;
};

const CONNECTED_USERS_COLLECTION = "connected_users";
const ACTIVE_WINDOW_MS = 1000 * 60 * 60 * 24 * 30;

function normalizeIgnoredPlaylistRules(
  ignoredPlaylists?: IgnoredPlaylistRule[] | null,
  ignoredPlaylistIds?: string[] | null,
) {
  const normalizedRules = new Map<string, IgnoredPlaylistRule>();

  (ignoredPlaylists ?? []).forEach((rule) => {
    const playlistId = rule?.playlistId?.trim();
    const mode = rule?.mode === "others_only" ? "others_only" : "all";

    if (!playlistId) {
      return;
    }

    normalizedRules.set(playlistId, { playlistId, mode });
  });

  (ignoredPlaylistIds ?? []).forEach((playlistId) => {
    const normalizedPlaylistId = playlistId.trim();
    if (!normalizedPlaylistId || normalizedRules.has(normalizedPlaylistId)) {
      return;
    }

    normalizedRules.set(normalizedPlaylistId, { playlistId: normalizedPlaylistId, mode: "all" });
  });

  return [...normalizedRules.values()];
}

function ignoredPlaylistsCacheKey(spotifyUserId: string) {
  return `ignored-playlists:${spotifyUserId}`;
}

export function getDefaultPrivacySettings(): ConnectedUserPrivacySettings {
  return {
    shareProfile: true,
    shareTopLists: true,
    shareListeningActivity: true,
  };
}

function normalizePrivacySettings(settings?: Partial<ConnectedUserPrivacySettings> | null): ConnectedUserPrivacySettings {
  const defaults = getDefaultPrivacySettings();
  return {
    shareProfile: settings?.shareProfile ?? defaults.shareProfile,
    shareTopLists: settings?.shareTopLists ?? defaults.shareTopLists,
    shareListeningActivity: settings?.shareListeningActivity ?? defaults.shareListeningActivity,
  };
}

function toCommunityUserProfile(user: ConnectedUser): CommunityUserProfile {
  return {
    spotifyUserId: user.spotifyUserId,
    displayName: user.displayName,
    imageUrl: user.imageUrl,
    lastSeenAt: user.lastSeenAt,
    lastSnapshotAt: user.lastSnapshotAt,
    lastSnapshotStatus: user.lastSnapshotStatus,
    privacy: normalizePrivacySettings(user.privacy),
  };
}

export async function upsertConnectedUser(user: {
  spotifyUserId: string;
  displayName: string;
  email?: string;
  imageUrl?: string;
  refreshToken: string;
}) {
  if (!hasMongoConfig()) {
    return;
  }

  const db = await getDatabase({ forceRetry: true });
  if (!db) {
    return;
  }

  const now = new Date().toISOString();
  await db.collection<ConnectedUser>(CONNECTED_USERS_COLLECTION).updateOne(
    { spotifyUserId: user.spotifyUserId },
    {
      $set: {
        spotifyUserId: user.spotifyUserId,
        displayName: user.displayName,
        email: user.email,
        imageUrl: user.imageUrl,
        refreshToken: user.refreshToken,
        lastSeenAt: now,
        updatedAt: now,
      },
      $setOnInsert: {
        privacy: getDefaultPrivacySettings(),
      },
    },
    { upsert: true },
  );
}

export async function syncConnectedUserSession(session: AuthSession) {
  if (!hasSpotifyConnection(session)) {
    return;
  }

  await upsertConnectedUser({
    spotifyUserId: session.spotifyUserId,
    displayName: session.displayName,
    email: session.email,
    imageUrl: session.imageUrl,
    refreshToken: session.refreshToken,
  });
}

export async function touchConnectedUser(spotifyUserId: string) {
  if (!hasMongoConfig()) {
    return;
  }

  const db = await getDatabase({ forceRetry: true });
  if (!db) {
    return;
  }

  const now = new Date().toISOString();
  await db.collection<ConnectedUser>(CONNECTED_USERS_COLLECTION).updateOne(
    { spotifyUserId },
    { $set: { lastSeenAt: now, updatedAt: now } },
  );
}

export async function markConnectedUserSnapshotStatus(
  spotifyUserId: string,
  status: "success" | "error",
  errorMessage?: string,
) {
  if (!hasMongoConfig()) {
    return;
  }

  const db = await getDatabase({ forceRetry: true });
  if (!db) {
    return;
  }

  const now = new Date().toISOString();
  await db.collection<ConnectedUser>(CONNECTED_USERS_COLLECTION).updateOne(
    { spotifyUserId },
    {
      $set: {
        lastSnapshotAt: now,
        lastSnapshotStatus: status,
        lastSnapshotError: errorMessage,
        updatedAt: now,
      },
    },
  );
}

export async function markConnectedUserRecentSync(spotifyUserId: string) {
  if (!hasMongoConfig()) {
    return;
  }

  const db = await getDatabase({ forceRetry: true });
  if (!db) {
    return;
  }

  const now = new Date().toISOString();
  await db.collection<ConnectedUser>(CONNECTED_USERS_COLLECTION).updateOne(
    { spotifyUserId },
    {
      $set: {
        lastRecentSyncAt: now,
        updatedAt: now,
      },
    },
  );
}

export async function markConnectedUserDashboardEnrichmentStatus(
  spotifyUserId: string,
  status: "pending" | "running" | "success" | "error",
  options?: {
    range?: "week" | "month" | "all";
    errorMessage?: string;
    detail?: string;
    step?: string;
  },
) {
  if (!hasMongoConfig()) {
    return;
  }

  const db = await getDatabase({ forceRetry: true });
  if (!db) {
    return;
  }

  const now = new Date().toISOString();
  const existing = await db.collection<ConnectedUser>(CONNECTED_USERS_COLLECTION).findOne(
    { spotifyUserId },
    { projection: { dashboardEnrichmentStatus: 1, dashboardEnrichmentStartedAt: 1, dashboardEnrichmentStep: 1, dashboardEnrichmentDetail: 1, dashboardEnrichmentRange: 1 } },
  );
  await db.collection<ConnectedUser>(CONNECTED_USERS_COLLECTION).updateOne(
    { spotifyUserId },
    {
      $set: {
        dashboardEnrichmentStatus: status,
        dashboardEnrichmentRange: options?.range ?? existing?.dashboardEnrichmentRange,
        dashboardEnrichmentError: options?.errorMessage,
        dashboardEnrichmentDetail: options?.detail ?? existing?.dashboardEnrichmentDetail,
        dashboardEnrichmentStep: options?.step ?? existing?.dashboardEnrichmentStep,
        dashboardEnrichmentStartedAt:
          status === "running"
            ? (existing?.dashboardEnrichmentStatus === "running" ? existing.dashboardEnrichmentStartedAt : now)
            : undefined,
        dashboardEnrichmentFinishedAt: status === "success" || status === "error" ? now : undefined,
        updatedAt: now,
      },
    },
  );
}

export async function markConnectedUserArtistMetadataBackfillStatus(
  spotifyUserId: string,
  status: "idle" | "pending" | "running" | "success" | "error",
  options?: {
    errorMessage?: string;
    backfilledCount?: number;
    detail?: string;
    step?: string;
  },
) {
  if (!hasMongoConfig()) {
    return;
  }

  const db = await getDatabase({ forceRetry: true });
  if (!db) {
    return;
  }

  const now = new Date().toISOString();
  const existing = await db.collection<ConnectedUser>(CONNECTED_USERS_COLLECTION).findOne(
    { spotifyUserId },
    {
      projection: {
        artistMetadataBackfillStatus: 1,
        artistMetadataBackfillStartedAt: 1,
        artistMetadataBackfillCount: 1,
        artistMetadataBackfillDetail: 1,
        artistMetadataBackfillStep: 1,
      },
    },
  );
  await db.collection<ConnectedUser>(CONNECTED_USERS_COLLECTION).updateOne(
    { spotifyUserId },
    {
      $set: {
        artistMetadataBackfillStatus: status,
        artistMetadataBackfillError: options?.errorMessage,
        artistMetadataBackfillCount: options?.backfilledCount ?? existing?.artistMetadataBackfillCount,
        artistMetadataBackfillDetail: options?.detail ?? existing?.artistMetadataBackfillDetail,
        artistMetadataBackfillStep: options?.step ?? existing?.artistMetadataBackfillStep,
        artistMetadataBackfillStartedAt:
          status === "running"
            ? (existing?.artistMetadataBackfillStatus === "running" ? existing.artistMetadataBackfillStartedAt : now)
            : undefined,
        artistMetadataBackfillFinishedAt: status === "success" || status === "error" ? now : undefined,
        updatedAt: now,
      },
    },
  );
}

export async function listActiveConnectedUsers(limit = 25) {
  if (!hasMongoConfig()) {
    return [] as ConnectedUser[];
  }

  const db = await getDatabase({ forceRetry: true });
  if (!db) {
    return [] as ConnectedUser[];
  }

  const cutoff = new Date(Date.now() - ACTIVE_WINDOW_MS).toISOString();
  return db
    .collection<ConnectedUser>(CONNECTED_USERS_COLLECTION)
    .find({ lastSeenAt: { $gte: cutoff } })
    .sort({ lastSeenAt: -1 })
    .limit(limit)
    .toArray();
}

export async function listAllConnectedUsers(limit = 250) {
  if (!hasMongoConfig()) {
    return [] as ConnectedUser[];
  }

  const db = await getDatabase({ forceRetry: true });
  if (!db) {
    return [] as ConnectedUser[];
  }

  return db
    .collection<ConnectedUser>(CONNECTED_USERS_COLLECTION)
    .find({})
    .sort({ updatedAt: -1, lastSeenAt: -1 })
    .limit(limit)
    .toArray();
}

export async function listCommunityUsers(limit = 24) {
  const users = await listActiveConnectedUsers(limit);
  return users
    .filter((user) => normalizePrivacySettings(user.privacy).shareProfile)
    .map(toCommunityUserProfile);
}

export async function getCommunityUserProfile(spotifyUserId: string) {
  if (!hasMongoConfig()) {
    return null;
  }

  const db = await getDatabase({ forceRetry: true });
  if (!db) {
    return null;
  }

  const user = await db.collection<ConnectedUser>(CONNECTED_USERS_COLLECTION).findOne({ spotifyUserId });

  if (!user) {
    return null;
  }

  const privacy = normalizePrivacySettings(user.privacy);
  if (!privacy.shareProfile) {
    return null;
  }

  return toCommunityUserProfile(user);
}

export async function getConnectedUser(spotifyUserId: string) {
  if (!hasMongoConfig()) {
    return null;
  }

  const db = await getDatabase({ forceRetry: true });
  if (!db) {
    return null;
  }

  const user = await db.collection<ConnectedUser>(CONNECTED_USERS_COLLECTION).findOne({ spotifyUserId });
  return user
    ? {
      ...user,
      privacy: normalizePrivacySettings(user.privacy),
      ignoredPlaylists: normalizeIgnoredPlaylistRules(user.ignoredPlaylists, user.ignoredPlaylistIds),
    }
    : null;
}

export async function getIgnoredPlaylistRules(spotifyUserId: string) {
  if (!hasMongoConfig()) {
    return [] as IgnoredPlaylistRule[];
  }

  return getCachedValue(ignoredPlaylistsCacheKey(spotifyUserId), 1000 * 30, async () => {
    const user = await getConnectedUser(spotifyUserId);
    return normalizeIgnoredPlaylistRules(user?.ignoredPlaylists, user?.ignoredPlaylistIds);
  });
}

export function invalidateIgnoredPlaylistIdsCache(spotifyUserId: string) {
  invalidateCachedValue(ignoredPlaylistsCacheKey(spotifyUserId));
}

export async function updateConnectedUserPrivacySettings(
  spotifyUserId: string,
  settings: Partial<ConnectedUserPrivacySettings>,
) {
  if (!hasMongoConfig()) {
    return getDefaultPrivacySettings();
  }

  const db = await getDatabase({ forceRetry: true });
  if (!db) {
    return getDefaultPrivacySettings();
  }

  const existing = await db.collection<ConnectedUser>(CONNECTED_USERS_COLLECTION).findOne({ spotifyUserId });
  const nextPrivacy = normalizePrivacySettings({
    ...normalizePrivacySettings(existing?.privacy),
    ...settings,
  });

  const now = new Date().toISOString();
  await db.collection<ConnectedUser>(CONNECTED_USERS_COLLECTION).updateOne(
    { spotifyUserId },
    {
      $set: {
        privacy: nextPrivacy,
        updatedAt: now,
      },
      $setOnInsert: {
        spotifyUserId,
        displayName: "Spotify Listener",
        refreshToken: "",
        lastSeenAt: now,
      },
    },
    { upsert: true },
  );

  return nextPrivacy;
}

export async function updateConnectedUserIgnoredPlaylists(spotifyUserId: string, ignoredPlaylists: IgnoredPlaylistRule[]) {
  const nextIgnoredPlaylists = normalizeIgnoredPlaylistRules(ignoredPlaylists);

  if (!hasMongoConfig()) {
    return nextIgnoredPlaylists;
  }

  const db = await getDatabase({ forceRetry: true });
  if (!db) {
    return nextIgnoredPlaylists;
  }

  const now = new Date().toISOString();
  await db.collection<ConnectedUser>(CONNECTED_USERS_COLLECTION).updateOne(
    { spotifyUserId },
    {
      $set: {
        ignoredPlaylists: nextIgnoredPlaylists,
        ignoredPlaylistIds: nextIgnoredPlaylists.filter((rule) => rule.mode === "all").map((rule) => rule.playlistId),
        updatedAt: now,
      },
      $setOnInsert: {
        spotifyUserId,
        displayName: "Spotify Listener",
        refreshToken: "",
        lastSeenAt: now,
        privacy: getDefaultPrivacySettings(),
      },
    },
    { upsert: true },
  );

  invalidateIgnoredPlaylistIdsCache(spotifyUserId);
  return nextIgnoredPlaylists;
}
