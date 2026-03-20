import crypto from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  getSpotifyProfile,
  refreshSpotifyAccessToken,
  type SpotifyProfile,
} from "@/lib/spotify";
import { ensureConnectedUserIndexes, upsertConnectedUser } from "@/lib/connected-users";

const SESSION_COOKIE = "soundscope_session";
const STATE_COOKIE = "soundscope_oauth_state";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const STATE_TTL_MS = 1000 * 60 * 10;

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
  cookieStore.set(
    STATE_COOKIE,
    encodeSignedValue({ state, expiresAt: Date.now() + STATE_TTL_MS, nonce: crypto.randomUUID() }),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: STATE_TTL_MS / 1000,
    },
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

export async function setSessionCookie(session: AuthSession) {
  const cookieStore = await cookies();
  cookieStore.set(
    SESSION_COOKIE,
    encodeSignedValue<SignedEnvelope<AuthSession>>({
      payload: session,
      nonce: crypto.randomUUID(),
    }),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_TTL_MS / 1000,
    },
  );

  await ensureConnectedUserIndexes();
  await upsertConnectedUser({
    spotifyUserId: session.spotifyUserId,
    displayName: session.displayName,
    email: session.email,
    imageUrl: session.imageUrl,
    refreshToken: session.refreshToken,
  });
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
  const profile = await getSpotifyProfile(token.access_token);
  const nextSession = buildSession(
    profile,
    token.access_token,
    token.refresh_token ?? session.refreshToken,
    token.expires_in,
  );

  await setSessionCookie(nextSession);
  return nextSession;
}

export function createOauthState() {
  return crypto.randomBytes(24).toString("base64url");
}
