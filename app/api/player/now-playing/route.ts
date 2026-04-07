import { NextRequest, NextResponse } from "next/server";
import { getAuthorizedSession, getSession } from "@/lib/auth";
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

  const activeSession = await getAuthorizedSession(session);

  const payload = await getCachedValue(`now-playing:${activeSession.spotifyUserId}:${limit}`, NOW_PLAYING_TTL_MS, async () => {
    const [nowPlaying, syncedRecent] = await Promise.all([
      getNowPlaying(activeSession.accessToken).catch(() => ({ isPlaying: false })),
      syncRecentPlays(activeSession.accessToken, activeSession.spotifyUserId).catch(() => []),
    ]);
    const storedRecent = await getStoredRecentPlays(activeSession.spotifyUserId, limit).catch(() => []);
    const recentTracksSource = storedRecent.length > 0 ? storedRecent : syncedRecent.slice(0, limit);

    return {
      ...nowPlaying,
      recentTracks: recentTracksSource.map((play) => ({
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

  return NextResponse.json(payload);
}

