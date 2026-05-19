import { NextRequest, NextResponse } from "next/server";
import { getAuthorizedSession, getSession, hasSpotifyConnection, isSessionRefreshFailure } from "@/lib/auth";
import { listCachedResolutionSuggestionsForImportedGroup } from "@/lib/dashboard-maintenance";
import { getSpotifyTrackMetadataById, resolveImportedLastFmGroupManuallyAsLocalTrack, resolveImportedLastFmGroupWithSpotifyTrack, skipImportedLastFmGroupMatching } from "@/lib/lastfm-import";

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
  const intent = body?.intent === "preview" || body?.intent === "suggest" || body?.intent === "skip" ? body.intent : "save";
  const mode = body?.mode === "local" ? "local" : "spotify";
  const trackName = isNonEmptyString(body?.trackName) ? body.trackName.trim() : "";
  const artistName = isNonEmptyString(body?.artistName) ? body.artistName.trim() : "";
  const albumName = typeof body?.albumName === "string" ? body.albumName.trim() : "";
  const spotifyLink = isNonEmptyString(body?.spotifyLink) ? body.spotifyLink.trim() : "";
  const localTrackName = isNonEmptyString(body?.localTrackName) ? body.localTrackName.trim() : "";
  const localArtistName = isNonEmptyString(body?.localArtistName) ? body.localArtistName.trim() : "";
  const localAlbumName = typeof body?.localAlbumName === "string" ? body.localAlbumName.trim() : "";
  const localImageUrl = typeof body?.localImageUrl === "string" ? body.localImageUrl.trim() : "";

  if (!trackName || !artistName) {
    return NextResponse.json({ error: "Track and artist are required." }, { status: 400 });
  }
  if ((intent === "preview" || intent === "save") && mode === "spotify" && !spotifyLink) {
    return NextResponse.json({ error: "A Spotify link is required for Spotify-based resolution." }, { status: 400 });
  }
  if (intent === "save" && mode === "local" && (!localTrackName || !localArtistName)) {
    return NextResponse.json({ error: "Track and artist are required for a manual local song." }, { status: 400 });
  }

  try {
    if (intent === "suggest") {
      const suggestions = await listCachedResolutionSuggestionsForImportedGroup(
        session.spotifyUserId,
        { trackName, artistName, albumName },
        { limit: 5 },
      );
      return NextResponse.json({ suggestions });
    }
    if (intent === "skip") {
      const result = await skipImportedLastFmGroupMatching(
        session.spotifyUserId,
        { trackName, artistName, albumName },
      );
      return NextResponse.json({
        ...result,
        message:
          result.matchedPlayCount === 0
            ? "No unresolved imported plays were left for that exact track, artist, and album."
            : "Marked this unresolved song group as skipped. Cache-only retries will leave it alone until you manually resolve it later.",
      });
    }

    const authorizedSession = await getAuthorizedSession(session);
    if (intent === "preview" && mode === "spotify") {
      const metadata = await getSpotifyTrackMetadataById(authorizedSession.accessToken, spotifyLink);
      if (!metadata.trackId) {
        return NextResponse.json({ error: "Could not load that Spotify track." }, { status: 404 });
      }

      return NextResponse.json({
        preview: {
          trackId: metadata.trackId,
          trackName: metadata.trackName,
          artistName: metadata.artistName,
          artistNames: metadata.artistNames,
          albumName: metadata.albumName,
          durationMs: metadata.durationMs,
          imageUrl: metadata.imageUrl,
        },
        message: "Preview loaded. Confirm to save this Spotify match.",
      });
    }

    const result = mode === "local"
      ? await resolveImportedLastFmGroupManuallyAsLocalTrack(
        authorizedSession.spotifyUserId,
        { trackName, artistName, albumName },
        {
          trackName: localTrackName,
          artistName: localArtistName,
          albumName: localAlbumName,
          imageUrl: localImageUrl,
        },
      )
      : await resolveImportedLastFmGroupWithSpotifyTrack(
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
          : mode === "local"
            ? `Created a manual local-song match for ${result.updatedPlayCount} imported play${result.updatedPlayCount === 1 ? "" : "s"} and removed ${result.deletedDuplicatePlayCount} duplicate${result.deletedDuplicatePlayCount === 1 ? "" : "s"}.`
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
