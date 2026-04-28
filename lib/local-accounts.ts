import crypto from "node:crypto";
import { getDatabase, hasMongoConfig } from "@/lib/mongodb";

const LOCAL_ACCOUNTS_COLLECTION = "local_accounts";
const PASSWORD_KEY_LENGTH = 64;
const ADMIN_ACCOUNT_ID = "local-admin";
const ADMIN_USERNAME = (process.env.LOCAL_ADMIN_USERNAME ?? process.env.ADMIN_USERNAME ?? "admin").trim().toLowerCase();
const ADMIN_PASSWORD = process.env.LOCAL_ADMIN_PASSWORD ?? process.env.ADMIN_PASSWORD ?? "admin12345!";

export type LocalAccountRole = "user" | "admin";

export type LocalAccount = {
  id: string;
  username: string;
  displayName: string;
  email?: string;
  passwordHash: string;
  spotifyProfileUrl: string;
  spotifyUserId?: string;
  role?: LocalAccountRole;
  createdAt: string;
  updatedAt: string;
};

export type LocalAccountSummary = Pick<LocalAccount, "id" | "username" | "displayName" | "spotifyProfileUrl" | "spotifyUserId" | "createdAt" | "updatedAt" | "role">;

export function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
}

function buildAdminAccount(): LocalAccount {
  const now = new Date().toISOString();

  return {
    id: ADMIN_ACCOUNT_ID,
    username: ADMIN_USERNAME,
    displayName: "Administrator",
    passwordHash: hashPassword(ADMIN_PASSWORD, "local-admin"),
    spotifyProfileUrl: "https://open.spotify.com/user/admin",
    spotifyUserId: "admin",
    role: "admin",
    createdAt: now,
    updatedAt: now,
  };
}

export function isAdminAccount(account: Pick<LocalAccount, "role" | "username" | "id"> | null | undefined) {
  return Boolean(account && (account.role === "admin" || account.id === ADMIN_ACCOUNT_ID || normalizeUsername(account.username) === ADMIN_USERNAME));
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
  await collection.createIndex({ username: 1 }, { unique: true });
  return collection;
}

export async function createLocalAccount(input: {
  username: string;
  password: string;
  spotifyProfileInput: string;
}) {
  const username = normalizeUsername(input.username);
  const password = input.password.trim();

  if (username.length < 3) {
    throw new Error("Username must be at least 3 characters.");
  }

  if (!/^[a-z0-9._-]+$/.test(username)) {
    throw new Error("Username can use letters, numbers, periods, underscores, and hyphens.");
  }

  if (username === ADMIN_USERNAME) {
    throw new Error("That username is reserved.");
  }

  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }

  const { spotifyProfileUrl, spotifyUserId } = parseSpotifyProfileInput(input.spotifyProfileInput);
  const collection = await getAccountsCollection();
  const now = new Date().toISOString();

  const account: LocalAccount = {
    id: crypto.randomUUID(),
    username,
    displayName: input.username.trim(),
    passwordHash: hashPassword(password),
    spotifyProfileUrl,
    spotifyUserId,
    role: "user",
    createdAt: now,
    updatedAt: now,
  };

  try {
    await collection.insertOne(account);
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

    if (message.includes("duplicate")) {
      throw new Error("An account with that username already exists.");
    }

    throw error;
  }

  return account;
}

export async function authenticateLocalAccount(input: { username: string; password: string }) {
  const username = normalizeUsername(input.username);

  if (username === ADMIN_USERNAME) {
    if (input.password !== ADMIN_PASSWORD) {
      throw new Error("Incorrect username or password.");
    }

    return buildAdminAccount();
  }

  const collection = await getAccountsCollection();
  const account = await collection.findOne({ username });

  if (!account || !verifyPassword(input.password, account.passwordHash)) {
    throw new Error("Incorrect username or password.");
  }

  return account;
}

export async function getLocalAccountById(id: string) {
  if (id === ADMIN_ACCOUNT_ID) {
    return buildAdminAccount();
  }

  const collection = await getAccountsCollection();
  return collection.findOne({ id });
}

export async function deleteLocalAccount(id: string) {
  if (id === ADMIN_ACCOUNT_ID) {
    throw new Error("The admin account cannot be deleted.");
  }

  const collection = await getAccountsCollection();
  await collection.deleteOne({ id });
}

export async function listLocalAccounts() {
  if (!hasMongoConfig()) {
    return [buildAdminAccount()] as LocalAccountSummary[];
  }

  const collection = await getAccountsCollection();
  const accounts = await collection
    .find({})
    .project<LocalAccountSummary>({
      id: 1,
      username: 1,
      displayName: 1,
      spotifyProfileUrl: 1,
      spotifyUserId: 1,
      createdAt: 1,
      updatedAt: 1,
      role: 1,
    })
    .sort({ createdAt: -1 })
    .toArray();

  return [buildAdminAccount(), ...accounts];
}
