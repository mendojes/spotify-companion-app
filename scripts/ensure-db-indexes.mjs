import { MongoClient } from "mongodb";

const uri = process.env.spotify_app_MONGODB_URI || process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB_NAME || "spotify-app-db";

const CONNECTED_USERS_COLLECTION = "connected_users";
const LOCAL_ACCOUNTS_COLLECTION = "local_accounts";
const RECENT_PLAYS_COLLECTION = "spotify_recent_plays";
const SNAPSHOT_HISTORY_COLLECTION = "spotify_snapshots_history";
const DASHBOARD_OVERVIEW_COLLECTION = "dashboard_overview_cache";
const DASHBOARD_TOP_LISTS_CACHE_COLLECTION = "dashboard_top_lists_cache";
const DASHBOARD_ANALYSIS_CACHE_COLLECTION = "dashboard_analysis_cache";
const DASHBOARD_REDISCOVERY_CACHE_COLLECTION = "dashboard_rediscovery_cache";
const DASHBOARD_PLAYLISTS_CACHE_COLLECTION = "dashboard_playlists_cache";
const PLAYLIST_TRACK_CACHE_COLLECTION = "spotify_playlist_track_cache";
const PLAYLIST_TRACK_SYNC_COLLECTION = "spotify_playlist_track_sync";
const ARTIST_METADATA_COLLECTION = "spotify_artist_metadata";
const AUDIO_FEATURE_CACHE_COLLECTION = "spotify_audio_feature_cache";

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
    db
      .collection(CONNECTED_USERS_COLLECTION)
      .createIndex({ spotifyUserId: 1 }, { unique: true }),
    db.collection(CONNECTED_USERS_COLLECTION).createIndex({ lastSeenAt: -1 }),

    db
      .collection(LOCAL_ACCOUNTS_COLLECTION)
      .createIndex({ username: 1 }, { unique: true }),
    db.collection(LOCAL_ACCOUNTS_COLLECTION).createIndex(
      { spotifyUserId: 1 },
      {
        unique: true,
        sparse: true,
      },
    ),

    db.collection(RECENT_PLAYS_COLLECTION).createIndex(
      { spotifyUserId: 1, playedAt: -1, trackId: 1 },
      { unique: true },
    ),
    db
      .collection(RECENT_PLAYS_COLLECTION)
      .createIndex({ spotifyUserId: 1, playlistId: 1, playedAt: -1 }),

    db
      .collection(SNAPSHOT_HISTORY_COLLECTION)
      .createIndex({ spotifyUserId: 1, fetchedAt: -1 }),

    db
      .collection(DASHBOARD_OVERVIEW_COLLECTION)
      .createIndex({ spotifyUserId: 1 }, { unique: true }),

    db
      .collection(DASHBOARD_TOP_LISTS_CACHE_COLLECTION)
      .createIndex({ spotifyUserId: 1, range: 1 }, { unique: true }),

    db
      .collection(DASHBOARD_ANALYSIS_CACHE_COLLECTION)
      .createIndex({ spotifyUserId: 1, key: 1 }, { unique: true }),

    db
      .collection(DASHBOARD_REDISCOVERY_CACHE_COLLECTION)
      .createIndex({ spotifyUserId: 1, range: 1 }, { unique: true }),

    db
      .collection(DASHBOARD_PLAYLISTS_CACHE_COLLECTION)
      .createIndex({ spotifyUserId: 1, sort: 1 }, { unique: true }),

    db
      .collection(ARTIST_METADATA_COLLECTION)
      .createIndex({ artistId: 1 }, { unique: true }),

    db
      .collection(AUDIO_FEATURE_CACHE_COLLECTION)
      .createIndex({ id: 1 }, { unique: true }),

    db.collection(PLAYLIST_TRACK_CACHE_COLLECTION).createIndex(
      { spotifyUserId: 1, playlistId: 1, position: 1 },
      { unique: true },
    ),
    db
      .collection(PLAYLIST_TRACK_CACHE_COLLECTION)
      .createIndex({ spotifyUserId: 1, playlistId: 1, updatedAt: -1 }),

    db
      .collection(PLAYLIST_TRACK_SYNC_COLLECTION)
      .createIndex({ spotifyUserId: 1, playlistId: 1 }, { unique: true }),
  ]);

  console.log(`MongoDB indexes ensured for ${dbName}.`);
} catch (error) {
  console.error("Failed to ensure MongoDB indexes.", error);
  process.exitCode = 1;
} finally {
  await client.close().catch(() => undefined);
}