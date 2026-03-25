import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDashboardPlaylistInsights } from "@/lib/spotify-playlists";

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
