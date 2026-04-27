import { NextRequest, NextResponse } from "next/server";
import { AuthorizedSession, getAuthorizedSession, getSession, hasSpotifyConnection, isSessionRefreshFailure } from "@/lib/auth";
import {
  markConnectedUserArtistMetadataBackfillStatus,
  markConnectedUserDashboardEnrichmentStatus,
  markConnectedUserRecentSync,
  markConnectedUserSnapshotStatus,
  touchConnectedUser,
} from "@/lib/connected-users";
import { invalidateDashboardOverviewRuntimeCache } from "@/lib/dashboard-overview";
import { getAppUrl } from "@/lib/spotify";
import { invalidateDashboardSnapshotCaches, refreshDashboardSnapshot } from "@/lib/spotify-dashboard";
import { invalidateDashboardPlaylistPreviewCache } from "@/lib/spotify-playlists";
import { syncRecentPlays } from "@/lib/spotify-activity";
import { invalidateTopListHistoryCache } from "@/lib/spotify-toplists";

function normalizeRange(range?: string) {
  if (range === "month" || range === "all") {
    return range;
  }

  return "week";
}

function logRefreshTiming(spotifyUserId: string, step: string, startedAt: number) {
  console.log(`[dashboard-refresh] user=${spotifyUserId} step=${step} elapsedMs=${Date.now() - startedAt}`);
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  const { searchParams } = new URL(request.url);
  const range = normalizeRange(searchParams.get("range") ?? undefined);

  if (!session) {
    return NextResponse.redirect(getAppUrl(`/login?error=session_required`));
  }

  if (!hasSpotifyConnection(session)) {
    return NextResponse.redirect(getAppUrl(`/dashboard?connect_spotify=1`, request));
  }

  let authorizedSession: AuthorizedSession;

  try {
    authorizedSession = await getAuthorizedSession(session);
  } catch (error) {
    if (isSessionRefreshFailure(error)) {
      return NextResponse.redirect(getAppUrl(`/login?error=session_refresh_failed`));
    }

    throw error;
  }

  try {
    const refreshStartedAt = Date.now();
    await touchConnectedUser(session.spotifyUserId);
    const recentSyncStartedAt = Date.now();
    const recentPlays = await syncRecentPlays(
      authorizedSession.accessToken,
      authorizedSession.spotifyUserId,
      { fullBackfill: false },
    ).catch(() => []);
    logRefreshTiming(authorizedSession.spotifyUserId, "recent-sync", recentSyncStartedAt);
    await markConnectedUserRecentSync(authorizedSession.spotifyUserId).catch(() => undefined);
    const snapshotStartedAt = Date.now();
    await refreshDashboardSnapshot(authorizedSession.accessToken, authorizedSession.spotifyUserId, recentPlays);
    logRefreshTiming(authorizedSession.spotifyUserId, "snapshot", snapshotStartedAt);
    await markConnectedUserSnapshotStatus(authorizedSession.spotifyUserId, "success");
    invalidateDashboardSnapshotCaches(authorizedSession.spotifyUserId);
    invalidateTopListHistoryCache(authorizedSession.spotifyUserId);
    invalidateDashboardPlaylistPreviewCache(authorizedSession.spotifyUserId);
    invalidateDashboardOverviewRuntimeCache(authorizedSession.spotifyUserId);
    await markConnectedUserDashboardEnrichmentStatus(authorizedSession.spotifyUserId, "pending", { range }).catch(() => undefined);
    await markConnectedUserArtistMetadataBackfillStatus(authorizedSession.spotifyUserId, "pending").catch(() => undefined);
    logRefreshTiming(authorizedSession.spotifyUserId, "total", refreshStartedAt);
    return NextResponse.redirect(getAppUrl(`/dashboard?range=${range}&refreshed=1`));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Snapshot refresh failed.";
    await markConnectedUserSnapshotStatus(authorizedSession.spotifyUserId, "error", message);
    return NextResponse.redirect(getAppUrl(`/dashboard?range=${range}&refresh_error=1`));
  }
}


