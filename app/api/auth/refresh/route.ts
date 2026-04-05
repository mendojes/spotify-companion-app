import { NextRequest, NextResponse } from "next/server";
import { applyAuthEventCookie, applyClearedSessionCookies, applySessionCookie, clearSessionCookie, getSession, refreshSession } from "@/lib/auth";
import { touchConnectedUser } from "@/lib/connected-users";
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

  try {
    const nextSession = await refreshSession(session);

    try {
      await touchConnectedUser(session.spotifyUserId);
    } catch {
      // A Mongo hiccup should not log the user out after a successful token refresh.
    }

    const response = NextResponse.redirect(getAppUrl(returnTo, request));
    applySessionCookie(response, nextSession);
    applyAuthEventCookie(response, "refresh_success", `user:${session.spotifyUserId}`);
    return response;
  } catch (error) {
    await clearSessionCookie();
    const message = error instanceof Error ? error.message : String(error);
    const response = NextResponse.redirect(getAppUrl("/login?error=session_refresh_failed", request));
    applyClearedSessionCookies(response);
    applyAuthEventCookie(response, "refresh_failed", message);
    return response;
  }
}


