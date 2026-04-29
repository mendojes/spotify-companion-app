import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getPublicProfileSyncState } from "@/lib/spotify-public";

export async function GET() {
  const session = await getSession();

  if (!session?.spotifyUserId) {
    return NextResponse.json({ error: "Spotify profile is required." }, { status: 400 });
  }

  const status = await getPublicProfileSyncState(session.spotifyUserId, session.spotifyProfileUrl);
  return NextResponse.json(status);
}
