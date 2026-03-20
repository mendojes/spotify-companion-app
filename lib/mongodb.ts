import { MongoClient, Db } from "mongodb";

declare global {
  var mongoClientPromise: Promise<MongoClient> | undefined;
}

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB_NAME || "soundscope";

let mongoClientPromise: Promise<MongoClient> | null = null;

function createClientPromise() {
  if (!uri) {
    return null;
  }

  const client = new MongoClient(uri);
  return client.connect();
}

if (uri) {
  mongoClientPromise = global.mongoClientPromise ?? createClientPromise();

  if (process.env.NODE_ENV !== "production" && mongoClientPromise) {
    global.mongoClientPromise = mongoClientPromise;
  }
}

export function hasMongoConfig() {
  return Boolean(uri);
}

export async function getDatabase(): Promise<Db | null> {
  if (!mongoClientPromise) {
    return null;
  }

  const client = await mongoClientPromise;
  return client.db(dbName);
}
