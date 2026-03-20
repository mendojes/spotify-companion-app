import { getDatabase, hasMongoConfig } from "@/lib/mongodb";

type ConnectedUser = {
  spotifyUserId: string;
  displayName: string;
  email?: string;
  imageUrl?: string;
  refreshToken: string;
  lastSeenAt: string;
  updatedAt: string;
  lastSnapshotAt?: string;
  lastSnapshotStatus?: "success" | "error";
  lastSnapshotError?: string;
};

const CONNECTED_USERS_COLLECTION = "connected_users";
const ACTIVE_WINDOW_MS = 1000 * 60 * 60 * 24 * 30;

export async function ensureConnectedUserIndexes() {
  if (!hasMongoConfig()) {
    return;
  }

  const db = await getDatabase();
  if (!db) {
    return;
  }

  await db.collection<ConnectedUser>(CONNECTED_USERS_COLLECTION).createIndex({ spotifyUserId: 1 }, { unique: true });
  await db.collection<ConnectedUser>(CONNECTED_USERS_COLLECTION).createIndex({ lastSeenAt: -1 });
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

  const db = await getDatabase();
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
    },
    { upsert: true },
  );
}

export async function touchConnectedUser(spotifyUserId: string) {
  if (!hasMongoConfig()) {
    return;
  }

  const db = await getDatabase();
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

  const db = await getDatabase();
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

export async function listActiveConnectedUsers(limit = 25) {
  if (!hasMongoConfig()) {
    return [] as ConnectedUser[];
  }

  const db = await getDatabase();
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
