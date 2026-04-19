import { NextRequest, NextResponse } from "next/server";
import { AuthorizedSession, getAuthorizedSession, getSession, isSessionRefreshFailure } from "@/lib/auth";
import { syncRecentPlaysIfNeeded } from "@/lib/spotify-activity";

export async function POST(request: NextRequest) {
  const session = await getSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let activeSession: AuthorizedSession;

  try {
    activeSession = await getAuthorizedSession(session);
  } catch (error) {
    if (isSessionRefreshFailure(error)) {
      return NextResponse.json({ error: "Session refresh failed." }, { status: 401 });
    }

    throw error;
  }

  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "1";

  try {
    const recentPlays = await syncRecentPlaysIfNeeded(activeSession.accessToken, activeSession.spotifyUserId, { force });
    return NextResponse.json({
      syncedCount: recentPlays.length,
      syncedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not sync recent plays.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
