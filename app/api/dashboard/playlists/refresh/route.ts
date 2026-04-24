import { NextRequest, NextResponse } from "next/server";
import { AuthorizedSession, getAuthorizedSession, getSession, hasSpotifyConnection, isSessionRefreshFailure } from "@/lib/auth";
import { invalidateDashboardSectionRuntimeCache, writeStoredDashboardSectionCache } from "@/lib/dashboard-section-cache";
import { getAppUrl } from "@/lib/spotify";
import { invalidatePlaylistInsightsCache, syncPlaylistLibrary } from "@/lib/spotify-playlists";

export async function GET(request: NextRequest) {
  const session = await getSession();

  if (!session) {
    return NextResponse.redirect(getAppUrl("/login?error=session_required", request));
  }

  if (!hasSpotifyConnection(session)) {
    return NextResponse.redirect(getAppUrl("/dashboard?connect_spotify=1", request));
  }

  let authorizedSession: AuthorizedSession;

  try {
    authorizedSession = await getAuthorizedSession(session);
  } catch (error) {
    if (isSessionRefreshFailure(error)) {
      return NextResponse.redirect(getAppUrl("/login?error=session_refresh_failed", request));
    }

    throw error;
  }

  try {
    await syncPlaylistLibrary(authorizedSession.accessToken, authorizedSession.spotifyUserId);
    invalidatePlaylistInsightsCache(authorizedSession.spotifyUserId);
    invalidateDashboardSectionRuntimeCache(authorizedSession.spotifyUserId);
    await writeStoredDashboardSectionCache(authorizedSession.spotifyUserId).catch(() => undefined);
    return NextResponse.redirect(getAppUrl("/dashboard/playlists?refreshed=1", request));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Playlist refresh failed.";
    return NextResponse.redirect(getAppUrl(`/dashboard/playlists?refresh_error=${encodeURIComponent(message)}`, request));
  }
}
