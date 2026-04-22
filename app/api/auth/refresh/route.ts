import { NextRequest, NextResponse } from "next/server";
import { applyAuthEventCookie, applyClearedSessionCookies, applySessionCookie, getSession, hasSpotifyConnection, refreshSession } from "@/lib/auth";
import { getAppUrl } from "@/lib/spotify";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const returnTo = searchParams.get("returnTo") || "/dashboard";
  const session = await getSession();

  if (!session) {
    const response = NextResponse.redirect(getAppUrl("/login", request));
    applyAuthEventCookie(response, "refresh_missing_session");
    return response;
  }

  if (!hasSpotifyConnection(session)) {
    const response = NextResponse.redirect(getAppUrl("/dashboard?connect_spotify=1", request));
    applyAuthEventCookie(response, "refresh_skipped_local_session");
    return response;
  }

  try {
    const nextSession = await refreshSession(session);

    const response = NextResponse.redirect(getAppUrl(returnTo, request));
    applySessionCookie(response, nextSession);
    applyAuthEventCookie(response, "refresh_success", `user:${session.spotifyUserId}`);
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const response = NextResponse.redirect(getAppUrl("/login?error=session_refresh_failed", request));
    applyClearedSessionCookies(response);
    applyAuthEventCookie(response, "refresh_failed", message);
    return response;
  }
}
