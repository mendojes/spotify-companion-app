import { MongoClient } from "mongodb";

const uri = process.env.spotify_app_MONGODB_URI || process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB_NAME || "spotify-app-db";
const LASTFM_IMPORT_SOURCE_TYPE = "lastfm_import";
const DASHBOARD_CACHE_COLLECTIONS = [
  "dashboard_overview_cache",
  "dashboard_top_lists_cache",
  "dashboard_analysis_cache",
  "dashboard_rediscovery_cache",
  "dashboard_playlists_cache",
];

function printUsage() {
  console.log(`Usage:
  node --env-file=.env.local scripts/cleanup-lastfm-import.mjs --list-users
  node --env-file=.env.local scripts/cleanup-lastfm-import.mjs --spotify-user-id <id>

Options:
  --list-users           List stored connected Spotify users so you can pick an id.
  --spotify-user-id      Remove imported Last.fm plays for one Spotify user id and clear stored dashboard caches for that user.
`);
}

function parseArgs(argv) {
  const args = { listUsers: false, spotifyUserId: undefined };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "--list-users") {
      args.listUsers = true;
      continue;
    }

    if (value === "--spotify-user-id") {
      args.spotifyUserId = argv[index + 1];
      index += 1;
    }
  }

  return args;
}

if (!uri) {
  console.error("Missing spotify_app_MONGODB_URI or MONGODB_URI.");
  process.exit(1);
}

const { listUsers, spotifyUserId } = parseArgs(process.argv.slice(2));

if (!listUsers && !spotifyUserId) {
  printUsage();
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

  if (listUsers) {
    const users = await db
      .collection("connected_users")
      .find({}, { projection: { spotifyUserId: 1, displayName: 1, email: 1, _id: 0 } })
      .sort({ displayName: 1 })
      .toArray();

    if (users.length === 0) {
      console.log("No connected Spotify users found.");
      process.exit(0);
    }

    console.table(users);
    process.exit(0);
  }

  const deleteImportedResult = await db.collection("spotify_recent_plays").deleteMany({
    spotifyUserId,
    sourceType: LASTFM_IMPORT_SOURCE_TYPE,
  });

  const cacheDeletes = await Promise.all(
    DASHBOARD_CACHE_COLLECTIONS.map(async (collectionName) => ({
      collectionName,
      deletedCount: (
        await db.collection(collectionName).deleteMany({ spotifyUserId })
      ).deletedCount ?? 0,
    })),
  );

  console.log(JSON.stringify({
    spotifyUserId,
    deletedImportedPlays: deleteImportedResult.deletedCount ?? 0,
    clearedCaches: cacheDeletes,
  }, null, 2));
} catch (error) {
  console.error("Last.fm cleanup failed.", error);
  process.exitCode = 1;
} finally {
  await client.close().catch(() => undefined);
}
