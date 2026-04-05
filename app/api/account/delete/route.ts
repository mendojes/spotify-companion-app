import { NextRequest, NextResponse } from "next/server";
import { applyAuthEventCookie, applyClearedSessionCookies, getSession } from "@/lib/auth";
import { deleteSpotifyUserData } from "@/lib/account-data";
import { getAppUrl } from "@/lib/spotify";

export async function POST(request: NextRequest) {
  const session = await getSession();

  if (session) {
    await deleteSpotifyUserData(session.spotifyUserId);
  }

  const response = NextResponse.redirect(getAppUrl("/login?deleted=1", request));
  applyClearedSessionCookies(response);
  applyAuthEventCookie(response, "account_deleted_session_cleared");
  return response;
}
