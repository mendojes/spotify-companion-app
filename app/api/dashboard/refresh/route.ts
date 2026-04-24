import { NextRequest, NextResponse } from "next/server";
import { AuthorizedSession, getAuthorizedSession, getSession, hasSpotifyConnection, isSessionRefreshFailure } from "@/lib/auth";
import { markConnectedUserRecentSync, markConnectedUserSnapshotStatus, touchConnectedUser } from "@/lib/connected-users";
import { invalidateDashboardOverviewRuntimeCache, writeStoredDashboardOverviewCache } from "@/lib/dashboard-overview";
import { getAppUrl } from "@/lib/spotify";
import { invalidateDashboardSnapshotCaches, refreshDashboardSnapshot } from "@/lib/spotify-dashboard";
import { invalidateDashboardPlaylistPreviewCache, invalidatePlaylistInsightsCache, syncPlaylistLibrary } from "@/lib/spotify-playlists";
import { syncRecentPlays } from "@/lib/spotify-activity";
import { invalidateTopListHistoryCache } from "@/lib/spotify-toplists";

function normalizeRange(range?: string) {
  if (range === "month" || range === "all") {
    return range;
  }

  return "week";
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
    await touchConnectedUser(session.spotifyUserId);
    const recentPlays = await syncRecentPlays(
      authorizedSession.accessToken,
      authorizedSession.spotifyUserId,
      { fullBackfill: true },
    ).catch(() => []);
    await markConnectedUserRecentSync(authorizedSession.spotifyUserId).catch(() => undefined);
    await refreshDashboardSnapshot(authorizedSession.accessToken, authorizedSession.spotifyUserId, recentPlays);
    await markConnectedUserSnapshotStatus(authorizedSession.spotifyUserId, "success");
    await syncPlaylistLibrary(authorizedSession.accessToken, authorizedSession.spotifyUserId).catch(() => []);
    invalidateDashboardSnapshotCaches(authorizedSession.spotifyUserId);
    invalidateTopListHistoryCache(authorizedSession.spotifyUserId);
    invalidateDashboardPlaylistPreviewCache(authorizedSession.spotifyUserId);
    invalidateDashboardOverviewRuntimeCache(authorizedSession.spotifyUserId);
    await writeStoredDashboardOverviewCache(authorizedSession.spotifyUserId).catch(() => undefined);
    invalidatePlaylistInsightsCache(authorizedSession.spotifyUserId);
    return NextResponse.redirect(getAppUrl(`/dashboard?range=${range}&refreshed=1`));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Snapshot refresh failed.";
    await markConnectedUserSnapshotStatus(authorizedSession.spotifyUserId, "error", message);
    return NextResponse.redirect(getAppUrl(`/dashboard?range=${range}&refresh_error=1`));
  }
}


