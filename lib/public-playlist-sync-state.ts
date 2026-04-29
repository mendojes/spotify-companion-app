import { getDatabase, hasMongoConfig } from "@/lib/mongo";

const COLLECTION = "public_playlist_sync_state";

export type PublicPlaylistSyncState = {
  id: string;
  spotifyUserId: string;
  playlistId: string;
  status: "idle" | "running" | "completed" | "failed";
  leaseUntil?: string;
  lastAttemptAt?: string;
  lastCompletedAt?: string;
  error?: string;
};

function buildId(user: string, playlist: string) {
  return `${user}:${playlist}`;
}

export async function getSyncState(user: string, playlist: string) {
  if (!hasMongoConfig()) return null;
  const db = await getDatabase();
  if (!db) return null;

  return db.collection(COLLECTION).findOne({ id: buildId(user, playlist) });
}

export async function acquireLease(user: string, playlist: string, ms = 15000) {
  if (!hasMongoConfig()) return true;

  const db = await getDatabase();
  if (!db) return true;

  const now = Date.now();
  const leaseUntil = new Date(now + ms).toISOString();

  const res = await db.collection(COLLECTION).findOneAndUpdate(
    {
      id: buildId(user, playlist),
      $or: [
        { leaseUntil: { $exists: false } },
        { leaseUntil: { $lt: new Date().toISOString() } },
      ],
    },
    {
      $set: {
        id: buildId(user, playlist),
        spotifyUserId: user,
        playlistId: playlist,
        status: "running",
        leaseUntil,
        lastAttemptAt: new Date().toISOString(),
      },
    },
    { upsert: true, returnDocument: "after" },
  );

  return Boolean(res);
}

export async function releaseLease(user: string, playlist: string, success: boolean, error?: string) {
  if (!hasMongoConfig()) return;

  const db = await getDatabase();
  if (!db) return;

  await db.collection(COLLECTION).updateOne(
    { id: buildId(user, playlist) },
    {
      $set: {
        status: success ? "completed" : "failed",
        leaseUntil: null,
        lastCompletedAt: success ? new Date().toISOString() : undefined,
        error,
      },
    },
  );
}