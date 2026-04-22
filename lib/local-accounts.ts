import crypto from "node:crypto";
import { getDatabase, hasMongoConfig } from "@/lib/mongodb";

const LOCAL_ACCOUNTS_COLLECTION = "local_accounts";
const PASSWORD_KEY_LENGTH = 64;

export type LocalAccount = {
  id: string;
  displayName: string;
  email: string;
  passwordHash: string;
  spotifyProfileUrl: string;
  spotifyUserId?: string;
  createdAt: string;
  updatedAt: string;
};

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function parseSpotifyProfileInput(value: string) {
  const raw = value.trim();

  if (!raw) {
    throw new Error("Spotify profile link is required.");
  }

  if (raw.startsWith("spotify:user:")) {
    const spotifyUserId = raw.slice("spotify:user:".length).trim();

    if (!spotifyUserId) {
      throw new Error("Spotify profile link must include a profile id.");
    }

    return {
      spotifyUserId,
      spotifyProfileUrl: `https://open.spotify.com/user/${spotifyUserId}`,
    };
  }

  let parsed: URL;

  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("Enter a full Spotify profile URL.");
  }

  if (!parsed.hostname.includes("spotify.com")) {
    throw new Error("Profile link must be from Spotify.");
  }

  const parts = parsed.pathname.split("/").filter(Boolean);
  const userIndex = parts.findIndex((part) => part === "user");
  const spotifyUserId = userIndex >= 0 ? parts[userIndex + 1] : undefined;

  if (!spotifyUserId) {
    throw new Error("Use your Spotify profile link, like open.spotify.com/user/...");
  }

  return {
    spotifyUserId,
    spotifyProfileUrl: `https://open.spotify.com/user/${spotifyUserId}`,
  };
}

function hashPassword(password: string, salt?: string) {
  const nextSalt = salt ?? crypto.randomBytes(16).toString("hex");
  const derivedKey = crypto.scryptSync(password, nextSalt, PASSWORD_KEY_LENGTH).toString("hex");
  return `${nextSalt}:${derivedKey}`;
}

function verifyPassword(password: string, storedHash: string) {
  const [salt, expectedHash] = storedHash.split(":");

  if (!salt || !expectedHash) {
    return false;
  }

  const actualHash = hashPassword(password, salt).split(":")[1]!;
  return crypto.timingSafeEqual(Buffer.from(actualHash, "hex"), Buffer.from(expectedHash, "hex"));
}

async function getAccountsCollection() {
  if (!hasMongoConfig()) {
    throw new Error("Local accounts need MongoDB configuration.");
  }

  const db = await getDatabase({ forceRetry: true });

  if (!db) {
    throw new Error("Local account storage is unavailable right now.");
  }

  const collection = db.collection<LocalAccount>(LOCAL_ACCOUNTS_COLLECTION);
  await collection.createIndex({ email: 1 }, { unique: true });
  return collection;
}

export async function createLocalAccount(input: {
  displayName: string;
  email: string;
  password: string;
  spotifyProfileInput: string;
}) {
  const displayName = input.displayName.trim();
  const email = normalizeEmail(input.email);
  const password = input.password.trim();

  if (displayName.length < 2) {
    throw new Error("Display name must be at least 2 characters.");
  }

  if (!email || !email.includes("@")) {
    throw new Error("Enter a valid email address.");
  }

  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }

  const { spotifyProfileUrl, spotifyUserId } = parseSpotifyProfileInput(input.spotifyProfileInput);
  const collection = await getAccountsCollection();
  const now = new Date().toISOString();

  const account: LocalAccount = {
    id: crypto.randomUUID(),
    displayName,
    email,
    passwordHash: hashPassword(password),
    spotifyProfileUrl,
    spotifyUserId,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await collection.insertOne(account);
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

    if (message.includes("duplicate")) {
      throw new Error("An account with that email already exists.");
    }

    throw error;
  }

  return account;
}

export async function authenticateLocalAccount(input: { email: string; password: string }) {
  const email = normalizeEmail(input.email);
  const collection = await getAccountsCollection();
  const account = await collection.findOne({ email });

  if (!account || !verifyPassword(input.password, account.passwordHash)) {
    throw new Error("Incorrect email or password.");
  }

  return account;
}

export async function getLocalAccountById(id: string) {
  const collection = await getAccountsCollection();
  return collection.findOne({ id });
}

export async function deleteLocalAccount(id: string) {
  const collection = await getAccountsCollection();
  await collection.deleteOne({ id });
}
