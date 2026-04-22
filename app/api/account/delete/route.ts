import { NextRequest, NextResponse } from "next/server";
import { applyAuthEventCookie, applyClearedSessionCookies, getSession, hasSpotifyConnection } from "@/lib/auth";
import { deleteSpotifyUserData } from "@/lib/account-data";
import { deleteLocalAccount } from "@/lib/local-accounts";
import { getAppUrl } from "@/lib/spotify";

export async function POST(request: NextRequest) {
  const session = await getSession();

  if (session) {
    if (hasSpotifyConnection(session)) {
      await deleteSpotifyUserData(session.spotifyUserId);
    } else {
      await deleteLocalAccount(session.userId).catch(() => undefined);
    }
  }

  const response = NextResponse.redirect(getAppUrl("/login?deleted=1", request));
  applyClearedSessionCookies(response);
  applyAuthEventCookie(response, "account_deleted_session_cleared");
  return response;
}
