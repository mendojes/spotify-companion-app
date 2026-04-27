import { NextResponse } from "next/server";
import { getAuthorizedSession, getSession, hasSpotifyConnection, isSessionRefreshFailure } from "@/lib/auth";
import { backfillMissingArtistMetadataForUser } from "@/lib/spotify-dashboard";
import { invalidateDashboardOverviewRuntimeCache, writeStoredDashboardOverviewCache } from "@/lib/dashboard-overview";
import { invalidateDashboardSectionRuntimeCache, writeStoredDashboardSectionCache } from "@/lib/dashboard-section-cache";
import { getConnectedUser, markConnectedUserArtistMetadataBackfillStatus } from "@/lib/connected-users";

export async function POST() {
  const session = await getSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasSpotifyConnection(session)) {
    return NextResponse.json({ error: "Spotify connection required." }, { status: 403 });
  }

  try {
    const authorizedSession = await getAuthorizedSession(session);
    const connectedUser = await getConnectedUser(authorizedSession.spotifyUserId).catch(() => null);

    if (connectedUser?.artistMetadataBackfillStatus === "running") {
      return NextResponse.json({ status: "running" }, { status: 202 });
    }

    await markConnectedUserArtistMetadataBackfillStatus(
      authorizedSession.spotifyUserId,
      "running",
    ).catch(() => undefined);
    const backfilledCount = await backfillMissingArtistMetadataForUser(
      authorizedSession.spotifyUserId,
      authorizedSession.accessToken,
    );

    invalidateDashboardSectionRuntimeCache(authorizedSession.spotifyUserId);
    invalidateDashboardOverviewRuntimeCache(authorizedSession.spotifyUserId);

    await Promise.all([
      writeStoredDashboardSectionCache(authorizedSession.spotifyUserId, authorizedSession.accessToken).catch(() => undefined),
      writeStoredDashboardOverviewCache(authorizedSession.spotifyUserId, undefined, undefined, {
        allowLiveEnrichment: false,
      }).catch(() => undefined),
    ]);

    await markConnectedUserArtistMetadataBackfillStatus(
      authorizedSession.spotifyUserId,
      "success",
      { backfilledCount },
    ).catch(() => undefined);

    return NextResponse.json({ status: "success", backfilledCount });
  } catch (error) {
    if (isSessionRefreshFailure(error)) {
      return NextResponse.json({ error: "Session refresh failed." }, { status: 401 });
    }

    const message = error instanceof Error ? error.message : "Artist metadata backfill failed.";
    if (session?.spotifyUserId) {
      await markConnectedUserArtistMetadataBackfillStatus(session.spotifyUserId, "error", {
        errorMessage: message,
      }).catch(() => undefined);
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
