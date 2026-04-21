import { MongoClient } from "mongodb";

const SPOTIFY_ACCOUNTS_BASE = "https://accounts.spotify.com";
const SPOTIFY_API_BASE = "https://api.spotify.com/v1";
const DEFAULT_LIMIT = 200;
const PAGE_LIMIT = 50;

function parseArgs(argv) {
  const args = {
    limit: DEFAULT_LIMIT,
    refreshToken: process.env.SPOTIFY_REFRESH_TOKEN,
    spotifyUserId: process.env.SPOTIFY_USER_ID,
    json: false,
    verbose: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--limit") {
      args.limit = Number(argv[index + 1] ?? DEFAULT_LIMIT);
      index += 1;
      continue;
    }

    if (arg === "--refresh-token") {
      args.refreshToken = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--spotify-user-id") {
      args.spotifyUserId = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--json") {
      args.json = true;
      continue;
    }

    if (arg === "--verbose") {
      args.verbose = true;
    }
  }

  return args;
}

function getMongoUri() {
  return process.env.spotify_app_MONGODB_URI || process.env.MONGODB_URI;
}

async function getRefreshTokenFromMongo(spotifyUserId) {
  const uri = getMongoUri();
  const dbName = process.env.MONGODB_DB_NAME || "spotify-app-db";

  if (!uri) {
    throw new Error("Missing spotify_app_MONGODB_URI or MONGODB_URI.");
  }

  if (!spotifyUserId) {
    throw new Error("Provide --refresh-token or --spotify-user-id.");
  }

  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 15_000,
    connectTimeoutMS: 15_000,
    socketTimeoutMS: 15_000,
  });

  try {
    await client.connect();
    const db = client.db(dbName);
    const user = await db.collection("connected_users").findOne(
      { spotifyUserId },
      { projection: { refreshToken: 1, spotifyUserId: 1, displayName: 1 } },
    );

    if (!user?.refreshToken) {
      throw new Error(`No refresh token found for spotifyUserId "${spotifyUserId}".`);
    }

    return user.refreshToken;
  } finally {
    await client.close().catch(() => undefined);
  }
}

function getSpotifyBasicAuthHeader() {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Missing SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET.");
  }

  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

async function refreshSpotifyAccessToken(refreshToken) {
  const response = await fetch(`${SPOTIFY_ACCOUNTS_BASE}/api/token`, {
    method: "POST",
    headers: {
      Authorization: getSpotifyBasicAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`Spotify token refresh failed: ${response.status} ${await response.text()}`);
  }

  return response.json();
}

async function spotifyFetch(path, accessToken) {
  const response = await fetch(`${SPOTIFY_API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`Spotify request failed: ${response.status} ${await response.text()}`);
  }

  return response.json();
}

async function getPlaylists(accessToken, requestedLimit) {
  const items = [];
  let offset = 0;
  const pages = [];

  while (items.length < requestedLimit) {
    const pageSize = Math.min(PAGE_LIMIT, requestedLimit - items.length);
    const response = await spotifyFetch(`/me/playlists?limit=${pageSize}&offset=${offset}`, accessToken);
    const pageItems = response.items ?? [];

    pages.push({
      requestedOffset: offset,
      requestedLimit: pageSize,
      returnedCount: pageItems.length,
      total: response.total ?? null,
      next: response.next ?? null,
      firstPlaylist: pageItems[0]?.name ?? null,
      lastPlaylist: pageItems[pageItems.length - 1]?.name ?? null,
    });

    if (pageItems.length === 0) {
      break;
    }

    items.push(...pageItems);

    if (items.length >= requestedLimit || !response.next) {
      break;
    }

    offset += pageItems.length;
  }

  return {
    items: items.slice(0, requestedLimit),
    pages,
  };
}

function formatPlaylist(item, index) {
  const owner = item.owner?.display_name || "Unknown owner";
  const trackCount = item.tracks?.total ?? 0;
  const collaborative = item.collaborative ? "collab" : "solo";
  return `${String(index + 1).padStart(3, " ")}. ${item.name || "Untitled"} | owner=${owner} | tracks=${trackCount} | ${collaborative} | id=${item.id}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const limit = Number.isFinite(args.limit) ? Math.max(1, Math.min(1000, Math.floor(args.limit))) : DEFAULT_LIMIT;

  const refreshToken = args.refreshToken || await getRefreshTokenFromMongo(args.spotifyUserId);
  const token = await refreshSpotifyAccessToken(refreshToken);
  const result = await getPlaylists(token.access_token, limit);
  const playlists = result.items;

  if (args.json) {
    console.log(JSON.stringify({
      totalReturned: playlists.length,
      pages: result.pages,
      items: playlists,
    }, null, 2));
    return;
  }

  console.log(`Spotify returned ${playlists.length} playlist(s).`);
  console.log("");

  if (args.verbose) {
    result.pages.forEach((page, index) => {
      console.log(
        `Page ${index + 1}: count=${page.returnedCount} offset=${page.requestedOffset} requestedLimit=${page.requestedLimit} total=${page.total ?? "unknown"} next=${page.next ?? "none"}`,
      );
      console.log(
        `        firstPlaylist=${page.firstPlaylist ?? "none"} lastPlaylist=${page.lastPlaylist ?? "none"}`,
      );
    });
    console.log("");
  }

  playlists.forEach((item, index) => {
    console.log(formatPlaylist(item, index));
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
