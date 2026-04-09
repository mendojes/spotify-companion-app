import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDashboardPlaylistInsights, promoteRecentlyPlayedPlaylist } from "@/lib/spotify-playlists";

export async function GET() {
  const session = await getSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const playlistInsights = await getDashboardPlaylistInsights(session.spotifyUserId);
    return NextResponse.json({ playlistInsights });
  } catch {
    return NextResponse.json({ error: "Could not load playlist insights." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await getSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as {
      playlistId?: string;
      playlistName?: string;
      imageUrl?: string;
      playedAt?: string;
    };

    if (!body.playlistId) {
      return NextResponse.json({ error: "Missing playlist id." }, { status: 400 });
    }

    const playlistInsights = await promoteRecentlyPlayedPlaylist(
      session.spotifyUserId,
      {
        id: body.playlistId,
        name: body.playlistName,
        imageUrl: body.imageUrl,
      },
      body.playedAt,
    );

    return NextResponse.json({ playlistInsights });
  } catch {
    return NextResponse.json({ error: "Could not update playlist insights." }, { status: 500 });
  }
}
