import crypto from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
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

type CookieTarget = {
  set: (name: string, value: string, options: Record<string, unknown>) => void;
  delete: (name: string) => void;
};

export type AuthSession = {
  spotifyUserId: string;
  displayName: string;
  email?: string;
  imageUrl?: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

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

export function buildSession(
  profile: SpotifyProfile,
  accessToken: string,
  refreshToken: string,
  expiresIn: number,
) {
  return {
    spotifyUserId: profile.id,
    displayName: profile.display_name ?? "Spotify Listener",
    email: profile.email,
    imageUrl: profile.images?.[0]?.url,
    accessToken,
    refreshToken,
    expiresAt: Date.now() + expiresIn * 1000,
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
  return encodeSignedValue<SignedEnvelope<AuthSession>>({
    payload: session,
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
  const parsed = decodeSignedValue<SignedEnvelope<AuthSession>>(cookieStore.get(SESSION_COOKIE)?.value);
  return parsed?.payload ?? null;
}

export function isSessionExpired(session: AuthSession) {
  return session.expiresAt <= Date.now() + 15_000;
}

export async function requireSession() {
  const session = await getSession();

  if (!session) {
    redirect("/login");
  }

  if (isSessionExpired(session)) {
    redirect("/api/auth/refresh?returnTo=/dashboard");
  }

  return session;
}

export async function refreshSession(session: AuthSession) {
  const token = await refreshSpotifyAccessToken(session.refreshToken);
  return {
    ...session,
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? session.refreshToken,
    expiresAt: Date.now() + token.expires_in * 1000,
  } satisfies AuthSession;
}

export function createOauthState() {
  return crypto.randomBytes(24).toString("base64url");
}





