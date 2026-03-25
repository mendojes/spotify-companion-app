import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { markConnectedUserSnapshotStatus, touchConnectedUser } from "@/lib/connected-users";
import { getAppUrl } from "@/lib/spotify";
import { refreshDashboardSnapshot } from "@/lib/spotify-dashboard";
import { invalidatePlaylistInsightsCache, syncPlaylistLibrary } from "@/lib/spotify-playlists";

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

  try {
    await touchConnectedUser(session.spotifyUserId);
    await refreshDashboardSnapshot(session.accessToken, session.spotifyUserId);
    await markConnectedUserSnapshotStatus(session.spotifyUserId, "success");
    await syncPlaylistLibrary(session.accessToken, session.spotifyUserId).catch(() => []);
    invalidatePlaylistInsightsCache(session.spotifyUserId);
    return NextResponse.redirect(getAppUrl(`/dashboard?range=${range}&refreshed=1`));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Snapshot refresh failed.";
    await markConnectedUserSnapshotStatus(session.spotifyUserId, "error", message);
    return NextResponse.redirect(getAppUrl(`/dashboard?range=${range}&refresh_error=1`));
  }
}
