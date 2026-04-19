import { NextRequest, NextResponse } from "next/server";
import { AuthorizedSession, getAuthorizedSession, getSession, isSessionRefreshFailure } from "@/lib/auth";
import { getNowPlaying, getRecentPlaySyncStatus, getStoredRecentPlays } from "@/lib/spotify-activity";
import { getCachedValue } from "@/lib/runtime-cache";

const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 50;
const NOW_PLAYING_TTL_MS = 1000 * 2;

export async function GET(request: NextRequest) {
  const session = await getSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const limitParam = Number(url.searchParams.get("limit"));
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

  const payload = await getCachedValue(`now-playing:${activeSession.spotifyUserId}:${limit}`, NOW_PLAYING_TTL_MS, async () => {
    const [nowPlaying, storedRecent] = await Promise.all([
      getNowPlaying(activeSession.accessToken).catch(() => ({ isPlaying: false })),
      getStoredRecentPlays(activeSession.spotifyUserId, limit).catch(() => []),
    ]);
    const syncStatus = getRecentPlaySyncStatus(activeSession.spotifyUserId);

    return {
      ...nowPlaying,
      recentTracks: storedRecent.map((play) => ({
        trackId: play.trackId,
        title: play.trackName,
        artist: play.artistName,
        album: play.albumName,
        imageUrl: play.imageUrl,
        playedAt: play.playedAt,
      })),
      syncedRecentCount: syncStatus?.syncedCount ?? storedRecent.length,
      syncedAt: syncStatus?.syncedAt,
    };
  });

  return NextResponse.json(payload);
}

