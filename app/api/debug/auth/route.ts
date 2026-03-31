import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getSession, isSessionExpired } from "@/lib/auth";
import { getAppOrigin, getSpotifyRedirectUri } from "@/lib/spotify";

const SESSION_COOKIE = "soundscope_session";
const STATE_COOKIE = "soundscope_oauth_state";

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE)?.value;
  const stateCookie = cookieStore.get(STATE_COOKIE)?.value;
  const session = await getSession();

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    request: {
      url: request.url,
      host: request.headers.get("host"),
      forwardedHost: request.headers.get("x-forwarded-host"),
      forwardedProto: request.headers.get("x-forwarded-proto"),
      origin: request.headers.get("origin"),
      referer: request.headers.get("referer"),
      appOrigin: getAppOrigin(request),
      spotifyRedirectUri: getSpotifyRedirectUri(request),
    },
    cookies: {
      sessionCookiePresent: Boolean(sessionCookie),
      stateCookiePresent: Boolean(stateCookie),
      sessionCookieLength: sessionCookie?.length ?? 0,
      stateCookieLength: stateCookie?.length ?? 0,
    },
    session: session
      ? {
          authenticated: true,
          spotifyUserId: session.spotifyUserId,
          displayName: session.displayName,
          expiresAt: session.expiresAt,
          needsRefresh: isSessionExpired(session),
        }
      : {
          authenticated: false,
        },
  });
}
