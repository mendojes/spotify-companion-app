import { MongoClient } from "mongodb";

const SNAPSHOT_TOP_LISTS_SCHEMA_VERSION = 2;
const FULL_TOP_LIST_LIMIT = 50;
const uri = process.env.spotify_app_MONGODB_URI || process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB_NAME || "spotify-app-db";
const collectionName = "spotify_snapshots_history";

if (!uri) {
  console.error("Missing MongoDB connection string. Set spotify_app_MONGODB_URI or MONGODB_URI.");
  process.exit(1);
}

function getArtistGenres(artist) {
  return Array.isArray(artist?.genres) ? artist.genres : [];
}

function toArtistList(items, limit) {
  return (items || []).slice(0, limit).map((artist, index) => ({
    id: artist.id,
    rank: index + 1,
    name: artist.name,
    genres: getArtistGenres(artist),
    imageUrl: artist.images?.[0]?.url,
  }));
}

function toTrackList(items, limit) {
  return (items || []).slice(0, limit).map((track, index) => ({
    id: track.id,
    rank: index + 1,
    title: track.name,
    artist: (track.artists || []).map((artist) => artist.name).join(", "),
    album: track.album?.name || "Unknown album",
    popularity: track.popularity || 0,
    imageUrl: track.album?.images?.[0]?.url,
  }));
}

function deriveAlbumsFromTracks(tracks, limit) {
  const albumMap = new Map();

  tracks.forEach((track) => {
    const key = `${track.album}::${track.artist}`.toLowerCase();
    const weight = tracks.length - track.rank + 1;
    const existing = albumMap.get(key) || {
      id: key,
      name: track.album,
      artist: track.artist,
      trackCount: 0,
      score: 0,
      imageUrl: track.imageUrl,
    };

    existing.trackCount += 1;
    existing.score += weight + Math.round(track.popularity / 10);
    if (!existing.imageUrl && track.imageUrl) {
      existing.imageUrl = track.imageUrl;
    }

    albumMap.set(key, existing);
  });

  return [...albumMap.values()]
    .sort((a, b) => b.score - a.score || b.trackCount - a.trackCount || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((album, index) => ({ ...album, rank: index + 1 }));
}

function buildRange(range, artistsSource, tracksSource, fetchedAt) {
  const artists = toArtistList(artistsSource, Math.min(FULL_TOP_LIST_LIMIT, artistsSource?.length || 0));
  const tracks = toTrackList(tracksSource, Math.min(FULL_TOP_LIST_LIMIT, tracksSource?.length || 0));

  return {
    range,
    artists,
    tracks,
    albums: deriveAlbumsFromTracks(tracks, FULL_TOP_LIST_LIMIT),
    sourceLabel: "Cached Spotify snapshot",
    generatedAt: fetchedAt,
  };
}

function buildCachedTopListsForSnapshot(snapshot) {
  return {
    week: buildRange("week", snapshot.topArtists, snapshot.topTracks, snapshot.fetchedAt),
    month: buildRange("month", snapshot.mediumTermTopArtists || snapshot.topArtists, snapshot.mediumTermTopTracks || snapshot.topTracks, snapshot.fetchedAt),
    year: buildRange("year", snapshot.longTermTopArtists || snapshot.mediumTermTopArtists || snapshot.topArtists, snapshot.longTermTopTracks || snapshot.mediumTermTopTracks || snapshot.topTracks, snapshot.fetchedAt),
    all: buildRange("all", snapshot.longTermTopArtists || snapshot.mediumTermTopArtists || snapshot.topArtists, snapshot.longTermTopTracks || snapshot.mediumTermTopTracks || snapshot.topTracks, snapshot.fetchedAt),
  };
}

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000, connectTimeoutMS: 15000, socketTimeoutMS: 15000 });

try {
  await client.connect();
  const db = client.db(dbName);
  const collection = db.collection(collectionName);
  const cursor = collection.find({
    $or: [
      { schemaVersion: { $exists: false } },
      { schemaVersion: { $lt: SNAPSHOT_TOP_LISTS_SCHEMA_VERSION } },
      { cachedTopLists: { $exists: false } },
    ],
  });

  let scanned = 0;
  let updated = 0;
  const ops = [];

  while (await cursor.hasNext()) {
    const snapshot = await cursor.next();
    if (!snapshot) continue;
    scanned += 1;

    ops.push({
      updateOne: {
        filter: { _id: snapshot._id },
        update: {
          $set: {
            schemaVersion: SNAPSHOT_TOP_LISTS_SCHEMA_VERSION,
            cachedTopLists: buildCachedTopListsForSnapshot(snapshot),
          },
        },
      },
    });

    if (ops.length >= 100) {
      const result = await collection.bulkWrite(ops, { ordered: false });
      updated += result.modifiedCount;
      ops.length = 0;
    }
  }

  if (ops.length > 0) {
    const result = await collection.bulkWrite(ops, { ordered: false });
    updated += result.modifiedCount;
  }

  console.log(JSON.stringify({ scanned, updated, schemaVersion: SNAPSHOT_TOP_LISTS_SCHEMA_VERSION }, null, 2));
} finally {
  await client.close();
}
