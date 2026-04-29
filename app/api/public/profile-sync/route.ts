import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getPublicProfileSyncState, runPublicProfileInsightsSync } from "@/lib/spotify-public";

export async function POST() {
  const session = await getSession();

  if (!session?.spotifyUserId) {
    return NextResponse.json({ error: "Spotify profile is required." }, { status: 400 });
  }

  const current = await getPublicProfileSyncState(session.spotifyUserId, session.spotifyProfileUrl);

  if (current.status === "running") {
    return NextResponse.json(current, { status: 202 });
  }

  const result = await runPublicProfileInsightsSync(session.spotifyUserId, session.spotifyProfileUrl);
  return NextResponse.json(result, { status: result.status === "failed" ? 500 : 200 });
}
