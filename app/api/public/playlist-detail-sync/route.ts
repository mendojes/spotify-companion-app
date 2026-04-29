import { NextRequest, NextResponse } from "next/server";
import { hasSpotifyConnection, requireSession } from "@/lib/auth";
import { advancePublicPlaylistDetailAnalysis } from "@/lib/spotify-playlists";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const session = await requireSession();

  if (hasSpotifyConnection(session)) {
    return NextResponse.json(
      { error: "Public playlist detail sync is only used for local accounts." },
      { status: 400 },
    );
  }

  if (!session.spotifyUserId) {
    return NextResponse.json(
      { error: "Missing Spotify profile for local account." },
      { status: 400 },
    );
  }

  const playlistId = request.nextUrl.searchParams.get("playlistId");

  if (!playlistId) {
    return NextResponse.json({ error: "Missing playlistId." }, { status: 400 });
  }

  const state = await advancePublicPlaylistDetailAnalysis(
    session.spotifyUserId,
    playlistId,
  );

  return NextResponse.json(state, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
