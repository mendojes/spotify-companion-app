import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { refreshPublicSpotifyProfileInsights } from "@/lib/spotify-public";

export async function POST() {
  const session = await getSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.accountType !== "local") {
    return NextResponse.json({ error: "Local account required." }, { status: 403 });
  }

  if (!session.spotifyUserId) {
    return NextResponse.json({ error: "Missing Spotify profile id." }, { status: 400 });
  }

  try {
    const result = await refreshPublicSpotifyProfileInsights(
      session.spotifyUserId,
      session.spotifyProfileUrl,
    );

    return NextResponse.json({
      ok: true,
      refreshed: result.refreshed,
      playlistCount: result.playlistCount,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not refresh public profile.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
