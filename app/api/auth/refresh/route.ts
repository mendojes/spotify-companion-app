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
    await touchConnectedUser(session.spotifyUserId);
    return NextResponse.redirect(getAppUrl(returnTo));
  } catch {
    await clearSessionCookie();
    return NextResponse.redirect(getAppUrl("/login?error=session_refresh_failed"));
  }
}
