import { NextRequest, NextResponse } from "next/server";
import { getAuthorizedSession, getSession, hasSpotifyConnection, isSessionRefreshFailure } from "@/lib/auth";
import { resolveImportedLastFmGroupWithSpotifyTrack } from "@/lib/lastfm-import";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasSpotifyConnection(session)) {
    return NextResponse.json({ error: "Spotify connection required." }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const trackName = isNonEmptyString(body?.trackName) ? body.trackName.trim() : "";
  const artistName = isNonEmptyString(body?.artistName) ? body.artistName.trim() : "";
  const albumName = typeof body?.albumName === "string" ? body.albumName.trim() : "";
  const spotifyLink = isNonEmptyString(body?.spotifyLink) ? body.spotifyLink.trim() : "";

  if (!trackName || !artistName || !spotifyLink) {
    return NextResponse.json({ error: "Track, artist, and Spotify link are required." }, { status: 400 });
  }

  try {
    const authorizedSession = await getAuthorizedSession(session);
    const result = await resolveImportedLastFmGroupWithSpotifyTrack(
      authorizedSession.spotifyUserId,
      { trackName, artistName, albumName },
      spotifyLink,
      authorizedSession.accessToken,
    );

    return NextResponse.json({
      ...result,
      message:
        result.matchedPlayCount === 0
          ? "No unresolved imported plays were left for that exact track, artist, and album."
          : `Resolved ${result.updatedPlayCount} imported play${result.updatedPlayCount === 1 ? "" : "s"} and removed ${result.deletedDuplicatePlayCount} duplicate${result.deletedDuplicatePlayCount === 1 ? "" : "s"}.`,
    });
  } catch (error) {
    if (isSessionRefreshFailure(error)) {
      return NextResponse.json({ error: "Session refresh failed." }, { status: 401 });
    }

    const message = error instanceof Error ? error.message : "Could not resolve this imported track.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
