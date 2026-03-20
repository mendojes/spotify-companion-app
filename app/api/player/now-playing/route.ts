import { NextResponse } from "next/server";
import { getSession, isSessionExpired, refreshSession } from "@/lib/auth";
import { getNowPlaying, getStoredRecentPlays, syncRecentPlays } from "@/lib/spotify-activity";

export async function GET() {
  const session = await getSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const activeSession = isSessionExpired(session) ? await refreshSession(session) : session;

  const [nowPlaying, syncedRecent, storedRecent] = await Promise.all([
    getNowPlaying(activeSession.accessToken).catch(() => ({ isPlaying: false })),
    syncRecentPlays(activeSession.accessToken, activeSession.spotifyUserId).catch(() => []),
    getStoredRecentPlays(activeSession.spotifyUserId, 12).catch(() => []),
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