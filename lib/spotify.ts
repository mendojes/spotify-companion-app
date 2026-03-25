const spotifyApiBase = "https://api.spotify.com/v1";
const spotifyAccountsBase = "https://accounts.spotify.com";
const spotifyCallbackPath = "/api/auth/callback/spotify";
const MAX_SPOTIFY_RETRIES = 2;
const SPOTIFY_FETCH_TIMEOUT_MS = 10_000;

export const spotifyScopes = [
  "user-read-email",
  "user-read-private",
  "user-read-recently-played",
  "user-read-currently-playing",
  "user-top-read",
  "user-library-read",
  "playlist-read-private",
];

export type SpotifyTokenResponse = {
  access_token: string;
  token_type: string;
  scope: string;
  expires_in: number;
  refresh_token?: string;
};

export type SpotifyProfile = {
  id: string;
  display_name: string | null;
  email?: string;
  images?: Array<{ url: string }>;
};

type OriginRequestLike = {
  url: string;
  headers?: Headers;
};

function normalizeOrigin(origin: string) {
  return origin.endsWith("/") ? origin.slice(0, -1) : origin;
}

function getOriginFromRequest(request?: OriginRequestLike) {
  if (!request) {
    return "";
  }

  const forwardedProto = request.headers?.get("x-forwarded-proto");
  const forwardedHost = request.headers?.get("x-forwarded-host") ?? request.headers?.get("host");

  if (forwardedProto && forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }

  return new URL(request.url).origin;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRetryDelayMs(response: Response, attempt: number) {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return seconds * 1000;
    }
  }

  return 400 * Math.pow(2, attempt);
}

async function spotifyRequest(pathOrUrl: string, init: RequestInit, allowRetry: boolean) {
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${spotifyApiBase}${pathOrUrl}`;

  for (let attempt = 0; attempt <= MAX_SPOTIFY_RETRIES; attempt += 1) {
    const response = await fetch(url, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(SPOTIFY_FETCH_TIMEOUT_MS),
      cache: "no-store",
    });

    const shouldRetry = allowRetry && (response.status === 429 || response.status >= 500);
    if (response.ok || !shouldRetry || attempt === MAX_SPOTIFY_RETRIES) {
      return response;
    }

    await wait(getRetryDelayMs(response, attempt));
  }

  throw new Error("Spotify request retry loop exhausted.");
}

export function getSpotifyRedirectUri(request?: OriginRequestLike) {
  const configuredRedirectUri = process.env.SPOTIFY_REDIRECT_URI;

  if (configuredRedirectUri) {
    return configuredRedirectUri;
  }

  const requestOrigin = getOriginFromRequest(request);

  if (!requestOrigin) {
    return "";
  }

  return `${normalizeOrigin(requestOrigin)}${spotifyCallbackPath}`;
}

export function getAppOrigin(request?: OriginRequestLike) {
  const redirectUri = getSpotifyRedirectUri(request);

  if (!redirectUri) {
    return "http://127.0.0.1:3000";
  }

  return new URL(redirectUri).origin;
}

export function getAppUrl(path: string, request?: OriginRequestLike) {
  return new URL(path, getAppOrigin(request)).toString();
}

export function getSpotifyLoginUrl(state: string, request?: OriginRequestLike) {
  const params = new URLSearchParams({
    client_id: process.env.SPOTIFY_CLIENT_ID ?? "",
    response_type: "code",
    redirect_uri: getSpotifyRedirectUri(request),
    scope: spotifyScopes.join(" "),
    state,
    show_dialog: "true",
  });

  return `${spotifyAccountsBase}/authorize?${params.toString()}`;
}

function getSpotifyBasicAuthHeader() {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Missing Spotify client credentials.");
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  return `Basic ${credentials}`;
}

export async function exchangeSpotifyCode(code: string, request?: OriginRequestLike) {
  const response = await fetch(`${spotifyAccountsBase}/api/token`, {
    method: "POST",
    headers: {
      Authorization: getSpotifyBasicAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: getSpotifyRedirectUri(request),
    }),
    signal: AbortSignal.timeout(SPOTIFY_FETCH_TIMEOUT_MS),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Spotify token exchange failed: ${response.status}`);
  }

  return (await response.json()) as SpotifyTokenResponse;
}

export async function refreshSpotifyAccessToken(refreshToken: string) {
  const response = await fetch(`${spotifyAccountsBase}/api/token`, {
    method: "POST",
    headers: {
      Authorization: getSpotifyBasicAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
    signal: AbortSignal.timeout(SPOTIFY_FETCH_TIMEOUT_MS),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Spotify token refresh failed: ${response.status}`);
  }

  return (await response.json()) as SpotifyTokenResponse;
}

export async function spotifyFetch<T>(path: string, accessToken: string, options?: { allowRetry?: boolean }): Promise<T> {
  const response = await spotifyRequest(path, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  }, options?.allowRetry ?? true);

  if (!response.ok) {
    throw new Error(`Spotify request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export async function spotifyFetchOptional<T>(path: string, accessToken: string): Promise<T | null> {
  const response = await spotifyRequest(path, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  }, true);

  if (!response.ok) {
    return null;
  }

  return response.json() as Promise<T>;
}

export function getSpotifyProfile(accessToken: string) {
  return spotifyFetch<SpotifyProfile>("/me", accessToken, { allowRetry: true });
}



