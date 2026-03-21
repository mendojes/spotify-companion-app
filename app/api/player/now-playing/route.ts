import { NextResponse } from "next/server";
import { getSession, isSessionExpired, refreshSession } from "@/lib/auth";
import { getNowPlaying, getStoredRecentPlays, syncRecentPlays } from "@/lib/spotify-activity";

const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 50;

export async function GET(request: Request) {
  const session = await getSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const limitParam = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitParam)
    ? Math.max(1, Math.min(MAX_LIMIT, Math.floor(limitParam)))
    : DEFAULT_LIMIT;

  const activeSession = isSessionExpired(session) ? await refreshSession(session) : session;

  const [nowPlaying, syncedRecent, storedRecent] = await Promise.all([
    getNowPlaying(activeSession.accessToken).catch(() => ({ isPlaying: false })),
    syncRecentPlays(activeSession.accessToken, activeSession.spotifyUserId).catch(() => []),
    getStoredRecentPlays(activeSession.spotifyUserId, limit).catch(() => []),
  ]);

  return NextResponse.json({
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
  });
}
