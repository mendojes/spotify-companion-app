import { MongoClient, Db } from "mongodb";

declare global {
  var mongoClientPromise: Promise<MongoClient> | undefined;
}

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB_NAME || "soundscope";

let mongoClientPromise: Promise<MongoClient> | null = null;
let mongoUnavailable = false;

function createClientPromise() {
  if (!uri) {
    return null;
  }

  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 5000,
    socketTimeoutMS: 10000,
  });
  return client.connect();
}

if (uri) {
  mongoClientPromise = global.mongoClientPromise ?? createClientPromise();

  if (process.env.NODE_ENV !== "production" && mongoClientPromise) {
    global.mongoClientPromise = mongoClientPromise;
  }
}

export function hasMongoConfig() {
  return Boolean(uri) && !mongoUnavailable;
}

export async function getDatabase(): Promise<Db | null> {
  if (!mongoClientPromise || mongoUnavailable) {
    return null;
  }

  try {
    const client = await mongoClientPromise;
    return client.db(dbName);
  } catch (error) {
    mongoUnavailable = true;
    mongoClientPromise = null;

    if (process.env.NODE_ENV !== "production") {
      global.mongoClientPromise = undefined;
    }

    console.warn("MongoDB unavailable, falling back to non-cached mode.", error);

    return null;
  }
}
