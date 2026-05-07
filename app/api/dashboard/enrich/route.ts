import { NextRequest, NextResponse } from "next/server";
import { getAuthorizedSession, getSession, hasSpotifyConnection, isSessionRefreshFailure } from "@/lib/auth";
import {
  getConnectedUser,
  markConnectedUserArtistMetadataBackfillStatus,
  markConnectedUserDashboardEnrichmentStatus,
} from "@/lib/connected-users";
import { invalidateDashboardSectionRuntimeCache, writeStoredDashboardSectionCache, writeStoredPlaylistsSectionCache } from "@/lib/dashboard-section-cache";
import { writeStoredDashboardOverviewCache } from "@/lib/dashboard-overview";
import { getMissingArtistMetadataIdsForUser as getMissingArtistMetadataIdsForOverviewUser } from "@/lib/spotify-dashboard";
import { invalidateDashboardPlaylistPreviewCache, invalidatePlaylistInsightsCache, syncPlaylistLibrary } from "@/lib/spotify-playlists";

function normalizeRange(range?: string) {
  if (range === "month" || range === "all") {
    return range;
  }

  return "week";
}

function logEnrichmentTiming(spotifyUserId: string, step: string, startedAt: number) {
  console.log(`[dashboard-enrich] user=${spotifyUserId} step=${step} elapsedMs=${Date.now() - startedAt}`);
}

export async function POST(request: NextRequest) {
  const session = await getSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasSpotifyConnection(session)) {
    return NextResponse.json({ error: "Spotify connection required." }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const range = normalizeRange(searchParams.get("range") ?? undefined);

  try {
    const authorizedSession = await getAuthorizedSession(session);
    const connectedUser = await getConnectedUser(authorizedSession.spotifyUserId).catch(() => null);

    if (connectedUser?.dashboardEnrichmentStatus === "running") {
      return NextResponse.json({ status: "running" }, { status: 202 });
    }

    const startedAt = Date.now();
    await markConnectedUserDashboardEnrichmentStatus(authorizedSession.spotifyUserId, "running", {
      range,
      detail: "Starting dashboard enrichment",
    }).catch(() => undefined);
    const playlistSyncStartedAt = Date.now();
    await markConnectedUserDashboardEnrichmentStatus(authorizedSession.spotifyUserId, "running", {
      range,
      detail: "Syncing playlist library",
    }).catch(() => undefined);
    await syncPlaylistLibrary(authorizedSession.accessToken, authorizedSession.spotifyUserId).catch(() => undefined);
    logEnrichmentTiming(authorizedSession.spotifyUserId, "playlist-library-sync", playlistSyncStartedAt);
    invalidatePlaylistInsightsCache(authorizedSession.spotifyUserId);
    invalidateDashboardPlaylistPreviewCache(authorizedSession.spotifyUserId);
    invalidateDashboardSectionRuntimeCache(authorizedSession.spotifyUserId);
    const playlistSectionStartedAt = Date.now();
    await markConnectedUserDashboardEnrichmentStatus(authorizedSession.spotifyUserId, "running", {
      range,
      detail: "Rebuilding playlist section cache",
    }).catch(() => undefined);
    await writeStoredPlaylistsSectionCache(authorizedSession.spotifyUserId).catch(() => undefined);
    logEnrichmentTiming(authorizedSession.spotifyUserId, "playlist-section-cache", playlistSectionStartedAt);
    const overviewStartedAt = Date.now();
    await markConnectedUserDashboardEnrichmentStatus(authorizedSession.spotifyUserId, "running", {
      range,
      detail: "Rebuilding overview cache",
    }).catch(() => undefined);
    await writeStoredDashboardOverviewCache(authorizedSession.spotifyUserId, authorizedSession.accessToken, range, {
      allowLiveEnrichment: false,
    });
    logEnrichmentTiming(authorizedSession.spotifyUserId, "overview-cache", overviewStartedAt);
    const sectionCacheStartedAt = Date.now();
    await markConnectedUserDashboardEnrichmentStatus(authorizedSession.spotifyUserId, "running", {
      range,
      detail: "Rebuilding section caches including top lists",
    }).catch(() => undefined);
    await writeStoredDashboardSectionCache(authorizedSession.spotifyUserId).catch(() => undefined);
    logEnrichmentTiming(authorizedSession.spotifyUserId, "section-cache", sectionCacheStartedAt);
    const missingArtistIds = await getMissingArtistMetadataIdsForOverviewUser(authorizedSession.spotifyUserId).catch(() => [] as string[]);
    if (missingArtistIds.length > 0) {
      await markConnectedUserArtistMetadataBackfillStatus(
        authorizedSession.spotifyUserId,
        "pending",
        { detail: `Queued ${missingArtistIds.length} artist ids for metadata backfill` },
      ).catch(() => undefined);
    } else {
      await markConnectedUserArtistMetadataBackfillStatus(
        authorizedSession.spotifyUserId,
        "idle",
        { backfilledCount: 0, detail: "No missing artist metadata remained after cache rebuild" },
      ).catch(() => undefined);
    }
    await markConnectedUserDashboardEnrichmentStatus(authorizedSession.spotifyUserId, "success", {
      range,
      detail: missingArtistIds.length > 0
        ? `Dashboard caches rebuilt. Artist metadata backfill queued for ${missingArtistIds.length} artists`
        : "Dashboard caches rebuilt with no missing artist metadata",
    }).catch(() => undefined);
    logEnrichmentTiming(authorizedSession.spotifyUserId, "total", startedAt);

    return NextResponse.json({ status: "success", needsArtistMetadataBackfill: missingArtistIds.length > 0 });
  } catch (error) {
    if (isSessionRefreshFailure(error)) {
      return NextResponse.json({ error: "Session refresh failed." }, { status: 401 });
    }

    const session = await getSession();
    if (session?.spotifyUserId) {
      const message = error instanceof Error ? error.message : "Dashboard enrichment failed.";
      await markConnectedUserDashboardEnrichmentStatus(session.spotifyUserId, "error", { range, errorMessage: message }).catch(() => undefined);
    }

    const message = error instanceof Error ? error.message : "Dashboard enrichment failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
