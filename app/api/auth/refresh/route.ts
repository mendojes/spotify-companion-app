import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookie, getSession, refreshSession } from "@/lib/auth";
import { touchConnectedUser } from "@/lib/connected-users";
import { getAppUrl } from "@/lib/spotify";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const returnTo = searchParams.get("returnTo") || "/dashboard";
  const session = await getSession();

  if (!session) {
    return NextResponse.redirect(getAppUrl("/login"));
  }

  try {
    await refreshSession(session);

    try {
      await touchConnectedUser(session.spotifyUserId);
    } catch {
      // A Mongo hiccup should not log the user out after a successful token refresh.
    }

    return NextResponse.redirect(getAppUrl(returnTo));
  } catch {
    await clearSessionCookie();
    return NextResponse.redirect(getAppUrl("/login?error=session_refresh_failed"));
  }
}
