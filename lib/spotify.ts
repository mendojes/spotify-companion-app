const spotifyApiBase = "https://api.spotify.com/v1";
const spotifyAccountsBase = "https://accounts.spotify.com";

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

export function getSpotifyRedirectUri() {
  return process.env.SPOTIFY_REDIRECT_URI ?? "";
}

export function getAppOrigin() {
  const redirectUri = getSpotifyRedirectUri();

  if (!redirectUri) {
    return "http://127.0.0.1:3000";
  }

  return new URL(redirectUri).origin;
}

export function getAppUrl(path: string) {
  return new URL(path, getAppOrigin()).toString();
}

export function getSpotifyLoginUrl(state: string) {
  const params = new URLSearchParams({
    client_id: process.env.SPOTIFY_CLIENT_ID ?? "",
    response_type: "code",
    redirect_uri: getSpotifyRedirectUri(),
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

export async function exchangeSpotifyCode(code: string) {
  const response = await fetch(`${spotifyAccountsBase}/api/token`, {
    method: "POST",
    headers: {
      Authorization: getSpotifyBasicAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: getSpotifyRedirectUri(),
    }),
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
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Spotify token refresh failed: ${response.status}`);
  }

  return (await response.json()) as SpotifyTokenResponse;
}

export async function spotifyFetch<T>(path: string, accessToken: string): Promise<T> {
  const response = await fetch(`${spotifyApiBase}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Spotify request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export async function spotifyFetchOptional<T>(path: string, accessToken: string): Promise<T | null> {
  const response = await fetch(`${spotifyApiBase}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    return null;
  }

  return response.json() as Promise<T>;
}

export function getSpotifyProfile(accessToken: string) {
  return spotifyFetch<SpotifyProfile>("/me", accessToken);
}