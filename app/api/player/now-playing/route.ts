import { NextRequest, NextResponse } from "next/server";
import { applySessionCookie, getSession, isSessionExpired, refreshSession } from "@/lib/auth";
import { getNowPlaying, getStoredRecentPlays, syncRecentPlays } from "@/lib/spotify-activity";
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

  let activeSession = session;
  let sessionWasRefreshed = false;

  if (isSessionExpired(session)) {
    activeSession = await refreshSession(session);
    sessionWasRefreshed = true;
  }

  const payload = await getCachedValue(`now-playing:${activeSession.spotifyUserId}:${limit}`, NOW_PLAYING_TTL_MS, async () => {
    const [nowPlaying, syncedRecent, storedRecent] = await Promise.all([
      getNowPlaying(activeSession.accessToken).catch(() => ({ isPlaying: false })),
      syncRecentPlays(activeSession.accessToken, activeSession.spotifyUserId).catch(() => []),
      getStoredRecentPlays(activeSession.spotifyUserId, limit).catch(() => []),
    ]);

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
      syncedRecentCount: syncedRecent.length,
      syncedAt: new Date().toISOString(),
    };
  });

  const response = NextResponse.json(payload);

  if (sessionWasRefreshed) {
    applySessionCookie(response, activeSession);
  }

  return response;
}

