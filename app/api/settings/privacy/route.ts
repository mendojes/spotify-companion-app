import { NextResponse } from "next/server";
import { requireSpotifySession } from "@/lib/auth";
import { invalidateDashboardOverviewRuntimeCache, writeStoredDashboardOverviewCache } from "@/lib/dashboard-overview";
import { invalidateDashboardSectionRuntimeCache, writeStoredDashboardSectionCache } from "@/lib/dashboard-section-cache";
import { getAppUrl } from "@/lib/spotify";
import { updateConnectedUserIgnoredPlaylists, updateConnectedUserPrivacySettings } from "@/lib/connected-users";
import { deleteStoredRecentPlaysForIgnoredPlaylists } from "@/lib/spotify-activity";
import { invalidateDashboardSnapshotCaches } from "@/lib/spotify-dashboard";
import { invalidateDashboardPlaylistPreviewCache, invalidatePlaylistInsightsCache } from "@/lib/spotify-playlists";
import { invalidateTopListHistoryCache } from "@/lib/spotify-toplists";

function isChecked(formData: FormData, key: string) {
  return formData.get(key) === "on";
}

export async function POST(request: Request) {
  const session = await requireSpotifySession("/settings");
  const formData = await request.formData();
  const ignoredPlaylistIds = formData
    .getAll("ignoredPlaylistIds")
    .map((value) => String(value).trim())
    .filter(Boolean);
  const ignoredPlaylistRules = ignoredPlaylistIds.map((playlistId) => ({ playlistId, mode: "all" as const }));

  await Promise.all([
    updateConnectedUserPrivacySettings(session.spotifyUserId, {
      shareProfile: isChecked(formData, "shareProfile"),
      shareTopLists: isChecked(formData, "shareTopLists"),
      shareListeningActivity: isChecked(formData, "shareListeningActivity"),
    }),
    updateConnectedUserIgnoredPlaylists(session.spotifyUserId, ignoredPlaylistRules),
  ]);

  await deleteStoredRecentPlaysForIgnoredPlaylists(session.spotifyUserId).catch(() => undefined);
  invalidateDashboardSnapshotCaches(session.spotifyUserId);
  invalidateTopListHistoryCache(session.spotifyUserId);
  invalidateDashboardPlaylistPreviewCache(session.spotifyUserId);
  invalidatePlaylistInsightsCache(session.spotifyUserId);
  invalidateDashboardOverviewRuntimeCache(session.spotifyUserId);
  invalidateDashboardSectionRuntimeCache(session.spotifyUserId);
  await writeStoredDashboardOverviewCache(session.spotifyUserId, undefined, undefined, {
    allowLiveEnrichment: false,
  }).catch(() => undefined);
  await writeStoredDashboardSectionCache(session.spotifyUserId).catch(() => undefined);

  return NextResponse.redirect(getAppUrl("/settings?saved=1", request), { status: 303 });
}
