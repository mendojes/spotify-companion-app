import { NextRequest, NextResponse } from "next/server";
import { AuthorizedSession, getAuthorizedSession, getSession, isSessionRefreshFailure } from "@/lib/auth";
import { getRecentPlaySyncStatus, getStoredRecentPlaysPage } from "@/lib/spotify-activity";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

export async function GET(request: NextRequest) {
  const session = await getSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const limitParam = Number(url.searchParams.get("limit"));
  const before = url.searchParams.get("before") ?? undefined;
  const limit = Number.isFinite(limitParam)
    ? Math.max(1, Math.min(MAX_LIMIT, Math.floor(limitParam)))
    : DEFAULT_LIMIT;

  let activeSession: AuthorizedSession;

  try {
    activeSession = await getAuthorizedSession(session);
  } catch (error) {
    if (isSessionRefreshFailure(error)) {
      return NextResponse.json({ error: "Session refresh failed." }, { status: 401 });
    }

    throw error;
  }

  const page = await getStoredRecentPlaysPage(activeSession.spotifyUserId, {
    limit,
    beforePlayedAt: before,
  }).catch(() => ({
    recentPlays: [],
    nextCursor: null,
  }));
  const syncStatus = getRecentPlaySyncStatus(activeSession.spotifyUserId);

  return NextResponse.json({
    recentTracks: page.recentPlays.map((play) => ({
      trackId: play.trackId,
      title: play.trackName,
      artist: play.artistName,
      album: play.albumName,
      imageUrl: play.imageUrl,
      playedAt: play.playedAt,
    })),
    nextCursor: page.nextCursor,
    syncState: syncStatus?.state,
    syncMode: syncStatus?.mode,
    syncStartedAt: syncStatus?.startedAt,
    syncError: syncStatus?.error,
    syncedRecentCount: syncStatus?.syncedCount ?? page.recentPlays.length,
    syncedAt: syncStatus?.syncedAt,
  });
}
