import { NextResponse } from "next/server";
import { hasSpotifyConnection, requireSession } from "@/lib/auth";
import { getPublicProfileSyncState } from "@/lib/spotify-public";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireSession();

  if (hasSpotifyConnection(session)) {
    return NextResponse.json(
      { error: "Public profile sync status is only used for local accounts." },
      { status: 400 },
    );
  }

  if (!session.spotifyUserId) {
    return NextResponse.json(
      { error: "Missing Spotify profile for local account." },
      { status: 400 },
    );
  }

  const state = await getPublicProfileSyncState(
    session.spotifyUserId,
    session.spotifyProfileUrl,
  );

  return NextResponse.json(state, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}