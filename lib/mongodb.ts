import { MongoClient, Db } from "mongodb";

declare global {
  var mongoClientPromise: Promise<MongoClient> | undefined;
}

const uri = process.env.spotify_app_MONGODB_URI || process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB_NAME || "spotify-app-db";
const SERVER_SELECTION_TIMEOUT_MS = 8_000;
const CONNECT_TIMEOUT_MS = 8_000;
const SOCKET_TIMEOUT_MS = 10_000;
const RETRY_BACKOFF_MS = 10_000;

let mongoClientPromise: Promise<MongoClient> | null = null;
let lastConnectionFailureAt = 0;
let lastConnectionFailureMessage: string | null = null;

function getMongoHostLabel() {
  if (!uri) {
    return null;
  }

  try {
    const normalized = uri.startsWith("mongodb://") || uri.startsWith("mongodb+srv://") ? uri : `mongodb://${uri}`;
    const parsed = new URL(normalized);
    return parsed.host || null;
  } catch {
    return null;
  }
}

function createClientPromise() {
  if (!uri) {
    return null;
  }

  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: SERVER_SELECTION_TIMEOUT_MS,
    connectTimeoutMS: CONNECT_TIMEOUT_MS,
    socketTimeoutMS: SOCKET_TIMEOUT_MS,
  });

  const connectionPromise = client.connect().catch(async (error) => {
    lastConnectionFailureAt = Date.now();
    lastConnectionFailureMessage = error instanceof Error ? error.message : String(error);
    mongoClientPromise = null;

    if (process.env.NODE_ENV !== "production") {
      global.mongoClientPromise = undefined;
    }

    try {
      await client.close();
    } catch {
      // Ignore cleanup errors after a failed connection attempt.
    }

    throw error;
  });

  if (process.env.NODE_ENV !== "production") {
    global.mongoClientPromise = connectionPromise;
  }

  return connectionPromise;
}

function getClientPromise() {
  if (!uri) {
    return null;
  }

  if (mongoClientPromise) {
    return mongoClientPromise;
  }

  if (lastConnectionFailureAt && Date.now() - lastConnectionFailureAt < RETRY_BACKOFF_MS) {
    return null;
  }

  mongoClientPromise = global.mongoClientPromise ?? createClientPromise();
  return mongoClientPromise;
}

export function hasMongoConfig() {
  return Boolean(uri);
}

export function getMongoDiagnostics() {
  return {
    configured: hasMongoConfig(),
    dbName,
    host: getMongoHostLabel(),
    retryBackoffMs: RETRY_BACKOFF_MS,
    serverSelectionTimeoutMs: SERVER_SELECTION_TIMEOUT_MS,
    connectTimeoutMs: CONNECT_TIMEOUT_MS,
    socketTimeoutMs: SOCKET_TIMEOUT_MS,
    lastFailureAt: lastConnectionFailureAt ? new Date(lastConnectionFailureAt).toISOString() : null,
    lastFailureMessage: lastConnectionFailureMessage,
    inBackoffWindow: Boolean(lastConnectionFailureAt && Date.now() - lastConnectionFailureAt < RETRY_BACKOFF_MS),
  };
}

export async function testMongoConnection() {
  const startedAt = Date.now();
  const db = await getDatabase();

  if (!db) {
    return {
      reachable: false,
      latencyMs: Date.now() - startedAt,
      error: lastConnectionFailureMessage,
    };
  }

  try {
    await db.command({ ping: 1 });
    return {
      reachable: true,
      latencyMs: Date.now() - startedAt,
      error: null,
    };
  } catch (error) {
    lastConnectionFailureAt = Date.now();
    lastConnectionFailureMessage = error instanceof Error ? error.message : String(error);

    return {
      reachable: false,
      latencyMs: Date.now() - startedAt,
      error: lastConnectionFailureMessage,
    };
  }
}

export async function getDatabase(): Promise<Db | null> {
  const clientPromise = getClientPromise();
  if (!clientPromise) {
    return null;
  }

  try {
    const client = await clientPromise;
    lastConnectionFailureAt = 0;
    lastConnectionFailureMessage = null;
    return client.db(dbName);
  } catch (error) {
    mongoClientPromise = null;
    lastConnectionFailureAt = Date.now();
    lastConnectionFailureMessage = error instanceof Error ? error.message : String(error);

    if (process.env.NODE_ENV !== "production") {
      global.mongoClientPromise = undefined;
    }

    console.warn("MongoDB unavailable, falling back to non-cached mode.", error);

    return null;
  }
}
