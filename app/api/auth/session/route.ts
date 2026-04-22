import { NextResponse } from "next/server";
import { getSession, hasSpotifyConnection, isSessionExpired } from "@/lib/auth";

export async function GET() {
  const session = await getSession();

  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  return NextResponse.json({
    authenticated: true,
    user: {
      accountType: session.accountType,
      spotifyConnected: hasSpotifyConnection(session),
      spotifyUserId: session.spotifyUserId,
      displayName: session.displayName,
    },
    expiresAt: session.expiresAt,
    needsRefresh: isSessionExpired(session),
  });
}
