import { NextResponse } from "next/server";
import { getSession, isSessionExpired, refreshSession } from "@/lib/auth";
import { getPlaylistInsights } from "@/lib/spotify-playlists";

export async function GET() {
  const session = await getSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const activeSession = isSessionExpired(session) ? await refreshSession(session) : session;

  try {
    const playlistInsights = await getPlaylistInsights(activeSession.accessToken, activeSession.spotifyUserId);
    return NextResponse.json({ playlistInsights });
  } catch {
    return NextResponse.json({ error: "Could not load playlist insights." }, { status: 500 });
  }
}
