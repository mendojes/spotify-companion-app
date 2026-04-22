import { NextResponse } from "next/server";
import { getAuthorizedSession, getSession, hasSpotifyConnection, isSessionRefreshFailure } from "@/lib/auth";
import { syncPlaylistDetail } from "@/lib/spotify-playlists";

type RouteContext = {
  params: Promise<{ playlistId: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const session = await getSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasSpotifyConnection(session)) {
    return NextResponse.json({ error: "Spotify connection required." }, { status: 403 });
  }

  let authorizedSession;

  try {
    authorizedSession = await getAuthorizedSession(session);
  } catch (error) {
    if (isSessionRefreshFailure(error)) {
      return NextResponse.json({ error: "Session refresh failed." }, { status: 401 });
    }

    throw error;
  }

  const { playlistId } = await context.params;

  try {
    const result = await syncPlaylistDetail(authorizedSession.accessToken, authorizedSession.spotifyUserId, playlistId);
    return NextResponse.json({
      completed: result.completed,
      fetchedCount: result.fetchedCount,
      totalTracks: result.totalTracks,
      updated: Boolean(result.detail),
    });
  } catch {
    return NextResponse.json({ error: "Could not sync playlist detail." }, { status: 500 });
  }
}
