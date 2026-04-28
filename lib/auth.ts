import crypto from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCachedValue } from "@/lib/runtime-cache";
import {
  refreshSpotifyAccessToken,
  type SpotifyProfile,
} from "@/lib/spotify";

const SESSION_COOKIE = "soundscope_session";
const STATE_COOKIE = "soundscope_oauth_state";
const AUTH_DEBUG_COOKIE = "soundscope_auth_event";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const STATE_TTL_MS = 1000 * 60 * 10;
const AUTH_DEBUG_TTL_MS = 1000 * 60 * 10;
const ACCESS_TOKEN_CACHE_TTL_MS = 1000 * 60 * 45;

type CookieTarget = {
  set: (name: string, value: string, options: Record<string, unknown>) => void;
  delete: (name: string) => void;
};

export type AuthSession = {
  accountType: "spotify" | "local";
  userId: string;
  displayName: string;
  role?: "user" | "admin";
  email?: string;
  imageUrl?: string;
  spotifyUserId?: string;
  spotifyProfileUrl?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt: number;
};

export type AuthorizedSession = AuthSession & {
  accountType: "spotify";
  accessToken: string;
  refreshToken: string;
  spotifyUserId: string;
};

type PersistedAuthSession = Pick<
  AuthSession,
  "accountType" | "userId" | "displayName" | "email" | "imageUrl" | "spotifyUserId" | "spotifyProfileUrl" | "refreshToken" | "expiresAt"
>;

type SignedEnvelope<T> = {
  payload: T;
  nonce: string;
};

function getAuthSecret() {
  const secret = process.env.AUTH_SECRET;

  if (!secret) {
    throw new Error("Missing AUTH_SECRET environment variable.");
  }

  return secret;
}

function toBase64Url(value: string) {
  return Buffer.from(value).toString("base64url");
}

function fromBase64Url(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signPayload(payload: string) {
  return crypto.createHmac("sha256", getAuthSecret()).update(payload).digest("base64url");
}

function encodeSignedValue<T>(payload: T) {
  const serialized = JSON.stringify(payload);
  const encodedPayload = toBase64Url(serialized);
  const signature = signPayload(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

function decodeSignedValue<T>(value: string | undefined): T | null {
  if (!value) {
    return null;
  }

  const [encodedPayload, signature] = value.split(".");

  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = signPayload(encodedPayload);
  const isValid =
    signature.length === expectedSignature.length &&
    crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));

  if (!isValid) {
    return null;
  }

  return JSON.parse(fromBase64Url(encodedPayload)) as T;
}

function getStateCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: STATE_TTL_MS / 1000,
  };
}

function getSessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  };
}

function getAuthDebugCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: AUTH_DEBUG_TTL_MS / 1000,
  };
}

function setSignedCookie(target: CookieTarget, name: string, value: string, options: Record<string, unknown>) {
  target.set(name, value, options);
}

function toPersistedSession(session: AuthSession): PersistedAuthSession {
  return {
    accountType: session.accountType,
    userId: session.userId,
    displayName: session.displayName,
    email: session.email,
    imageUrl: session.imageUrl,
    spotifyUserId: session.spotifyUserId,
    spotifyProfileUrl: session.spotifyProfileUrl,
    refreshToken: session.refreshToken,
    expiresAt: session.expiresAt,
  };
}

function getAccessTokenCacheKey(refreshToken: string) {
  return `spotify-access:${crypto.createHash("sha256").update(refreshToken).digest("hex")}`;
}

function deriveSpotifyUserIdFromProfileUrl(profileUrl?: string) {
  if (!profileUrl) {
    return undefined;
  }

  try {
    const parsed = new URL(profileUrl);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const userIndex = parts.findIndex((part) => part === "user");
    return userIndex >= 0 ? parts[userIndex + 1] : undefined;
  } catch {
    return undefined;
  }
}

export function buildSession(
  profile: SpotifyProfile,
  accessToken: string,
  refreshToken: string,
  expiresIn: number,
) {
  return {
    accountType: "spotify",
    userId: `spotify:${profile.id}`,
    spotifyUserId: profile.id,
    displayName: profile.display_name ?? "Spotify Listener",
    email: profile.email,
    imageUrl: profile.images?.[0]?.url,
    accessToken,
    refreshToken,
    expiresAt: Date.now() + expiresIn * 1000,
  } satisfies AuthorizedSession;
}

export function buildLocalSession(account: {
  id: string;
  displayName: string;
  email?: string;
  spotifyProfileUrl: string;
  spotifyUserId?: string;
  role?: "user" | "admin";
}) {
  return {
    accountType: "local",
    userId: account.id,
    displayName: account.displayName,
    role: account.role ?? "user",
    email: account.email,
    spotifyProfileUrl: account.spotifyProfileUrl,
    spotifyUserId: account.spotifyUserId ?? deriveSpotifyUserIdFromProfileUrl(account.spotifyProfileUrl),
    expiresAt: Date.now() + SESSION_TTL_MS,
  } satisfies AuthSession;
}

export async function setAuthStateCookie(state: string) {
  const cookieStore = await cookies();
  setSignedCookie(
    cookieStore,
    STATE_COOKIE,
    encodeSignedValue({ state, expiresAt: Date.now() + STATE_TTL_MS, nonce: crypto.randomUUID() }),
    getStateCookieOptions(),
  );
}

export async function consumeAuthStateCookie(expectedState: string) {
  const cookieStore = await cookies();
  const stateCookie = decodeSignedValue<{ state: string; expiresAt: number; nonce: string }>(
    cookieStore.get(STATE_COOKIE)?.value,
  );

  cookieStore.delete(STATE_COOKIE);

  if (!stateCookie) {
    return false;
  }

  return stateCookie.state === expectedState && stateCookie.expiresAt > Date.now();
}

function buildSessionCookieValue(session: AuthSession) {
  return encodeSignedValue<SignedEnvelope<PersistedAuthSession>>({
    payload: toPersistedSession(session),
    nonce: crypto.randomUUID(),
  });
}

export async function setSessionCookie(session: AuthSession) {
  const cookieStore = await cookies();
  setSignedCookie(cookieStore, SESSION_COOKIE, buildSessionCookieValue(session), getSessionCookieOptions());
}

export function applySessionCookie(target: { cookies: CookieTarget }, session: AuthSession) {
  setSignedCookie(target.cookies, SESSION_COOKIE, buildSessionCookieValue(session), getSessionCookieOptions());
}

export function applyAuthEventCookie(target: { cookies: CookieTarget }, event: string, details?: string) {
  const payload = JSON.stringify({ event, details: details ?? null, at: new Date().toISOString() });
  setSignedCookie(target.cookies, AUTH_DEBUG_COOKIE, encodeSignedValue(payload), getAuthDebugCookieOptions());
}

export async function getAuthEventCookie() {
  const cookieStore = await cookies();
  const rawValue = cookieStore.get(AUTH_DEBUG_COOKIE)?.value;
  const payload = decodeSignedValue<string>(rawValue);

  if (!payload) {
    return null;
  }

  try {
    return JSON.parse(payload) as { event: string; details?: string | null; at: string };
  } catch {
    return null;
  }
}

export function applyClearedSessionCookies(target: { cookies: CookieTarget }) {
  target.cookies.delete(SESSION_COOKIE);
  target.cookies.delete(STATE_COOKIE);
}

export async function clearSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
  cookieStore.delete(STATE_COOKIE);
}

export async function getSession() {
  const cookieStore = await cookies();
  const parsed = decodeSignedValue<SignedEnvelope<PersistedAuthSession>>(cookieStore.get(SESSION_COOKIE)?.value);
  return parsed?.payload ?? null;
}

export function isSessionExpired(session: Pick<AuthSession, "expiresAt">) {
  return session.expiresAt <= Date.now() + 15_000;
}

export function hasSpotifyConnection(session: AuthSession | null | undefined): session is AuthorizedSession | (AuthSession & {
  accountType: "spotify";
  refreshToken: string;
  spotifyUserId: string;
}) {
  return Boolean(
    session &&
    session.accountType === "spotify" &&
    session.spotifyUserId &&
    session.refreshToken,
  );
}

export function isAdminSession(session: AuthSession | null | undefined) {
  return Boolean(session?.accountType === "local" && session.role === "admin");
}

export async function requireSession() {
  const session = await getSession();

  if (!session) {
    redirect("/login");
  }

  if (isSessionExpired(session)) {
    if (hasSpotifyConnection(session)) {
      redirect("/api/auth/refresh?returnTo=/dashboard");
    }

    redirect("/login?error=session_expired");
  }

  return session;
}

export async function requireSpotifySession(returnTo = "/dashboard") {
  const session = await requireSession();

  if (!hasSpotifyConnection(session)) {
    redirect(`/dashboard?connect_spotify=1`);
  }

  return session;
}

export async function requireAdminSession() {
  const session = await requireSession();

  if (!isAdminSession(session)) {
    redirect("/dashboard");
  }

  return session;
}

export function isSessionRefreshFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Spotify token refresh failed: 400") || message.includes("Spotify token refresh failed: 401");
}

export async function refreshSession(session: AuthSession) {
  if (!hasSpotifyConnection(session)) {
    throw new Error("Spotify connection required.");
  }

  const token = await refreshSpotifyAccessToken(session.refreshToken);
  return {
    ...session,
    accountType: "spotify",
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? session.refreshToken,
    expiresAt: Date.now() + token.expires_in * 1000,
  } satisfies AuthorizedSession;
}

export async function getAuthorizedSession(session: AuthSession): Promise<AuthorizedSession> {
  if (!hasSpotifyConnection(session)) {
    throw new Error("Spotify connection required.");
  }

  if (session.accessToken && !isSessionExpired(session)) {
    return session as AuthorizedSession;
  }

  return getCachedValue(getAccessTokenCacheKey(session.refreshToken), ACCESS_TOKEN_CACHE_TTL_MS, async () => refreshSession(session));
}

export function createOauthState() {
  return crypto.randomBytes(24).toString("base64url");
}
