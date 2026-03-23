import { getDatabase, hasMongoConfig } from "@/lib/mongodb";

const USER_SCOPED_COLLECTIONS = [
  "connected_users",
  "spotify_recent_plays",
  "spotify_snapshots_history",
] as const;

export async function deleteSpotifyUserData(spotifyUserId: string) {
  if (!hasMongoConfig()) {
    return;
  }

  const db = await getDatabase();
  if (!db) {
    return;
  }

  await Promise.all(
    USER_SCOPED_COLLECTIONS.map((collectionName) =>
      db.collection(collectionName).deleteMany({ spotifyUserId }),
    ),
  );
}

