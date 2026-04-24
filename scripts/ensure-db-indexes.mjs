import { MongoClient } from "mongodb";

const uri = process.env.spotify_app_MONGODB_URI || process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB_NAME || "spotify-app-db";

const CONNECTED_USERS_COLLECTION = "connected_users";
const RECENT_PLAYS_COLLECTION = "spotify_recent_plays";
const SNAPSHOT_HISTORY_COLLECTION = "spotify_snapshots_history";
const DASHBOARD_OVERVIEW_COLLECTION = "dashboard_overview_cache";
const PLAYLIST_TRACK_CACHE_COLLECTION = "spotify_playlist_track_cache";
const PLAYLIST_TRACK_SYNC_COLLECTION = "spotify_playlist_track_sync";

if (!uri) {
  console.error("Missing spotify_app_MONGODB_URI or MONGODB_URI.");
  process.exit(1);
}

const client = new MongoClient(uri, {
  serverSelectionTimeoutMS: 15_000,
  connectTimeoutMS: 15_000,
  socketTimeoutMS: 15_000,
});

try {
  await client.connect();
  const db = client.db(dbName);

  await Promise.all([
    db.collection(CONNECTED_USERS_COLLECTION).createIndex({ spotifyUserId: 1 }, { unique: true }),
    db.collection(CONNECTED_USERS_COLLECTION).createIndex({ lastSeenAt: -1 }),
    db.collection(RECENT_PLAYS_COLLECTION).createIndex(
      { spotifyUserId: 1, playedAt: -1, trackId: 1 },
      { unique: true },
    ),
    db.collection(RECENT_PLAYS_COLLECTION).createIndex({ spotifyUserId: 1, playlistId: 1, playedAt: -1 }),
    db.collection(SNAPSHOT_HISTORY_COLLECTION).createIndex({ spotifyUserId: 1, fetchedAt: -1 }),
    db.collection(DASHBOARD_OVERVIEW_COLLECTION).createIndex({ spotifyUserId: 1 }, { unique: true }),
    db.collection(PLAYLIST_TRACK_CACHE_COLLECTION).createIndex({ spotifyUserId: 1, playlistId: 1, position: 1 }, { unique: true }),
    db.collection(PLAYLIST_TRACK_CACHE_COLLECTION).createIndex({ spotifyUserId: 1, playlistId: 1, updatedAt: -1 }),
    db.collection(PLAYLIST_TRACK_SYNC_COLLECTION).createIndex({ spotifyUserId: 1, playlistId: 1 }, { unique: true }),
  ]);

  console.log(`MongoDB indexes ensured for ${dbName}.`);
} catch (error) {
  console.error("Failed to ensure MongoDB indexes.", error);
  process.exitCode = 1;
} finally {
  await client.close().catch(() => undefined);
}
