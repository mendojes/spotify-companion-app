import { invalidateDashboardOverviewRuntimeCache } from "@/lib/dashboard-overview";
import { invalidateDashboardSectionRuntimeCache } from "@/lib/dashboard-section-cache";
import { getDatabase, hasMongoConfig } from "@/lib/mongodb";
import { invalidateDashboardSnapshotCaches } from "@/lib/spotify-dashboard";
import { invalidateDashboardPlaylistPreviewCache, invalidatePlaylistInsightsCache } from "@/lib/spotify-playlists";
import { invalidateTopListHistoryCache } from "@/lib/spotify-toplists";

const USER_SCOPED_COLLECTIONS = [
  "connected_users",
  "spotify_recent_plays",
  "spotify_snapshots_history",
  "spotify_playlist_insights",
  "spotify_playlist_detail_cache",
  "spotify_playlist_library",
  "spotify_playlist_track_cache",
  "spotify_playlist_track_sync",
  "dashboard_overview_cache",
  "dashboard_top_lists_cache",
  "dashboard_analysis_cache",
  "dashboard_rediscovery_cache",
  "dashboard_playlists_cache",
  "spotify_artist_metadata",
  "spotify_audio_feature_cache",
] as const;

export async function deleteSpotifyUserData(spotifyUserId: string) {
  invalidateDashboardSnapshotCaches(spotifyUserId);
  invalidateTopListHistoryCache(spotifyUserId);
  invalidateDashboardPlaylistPreviewCache(spotifyUserId);
  invalidatePlaylistInsightsCache(spotifyUserId);
  invalidateDashboardOverviewRuntimeCache(spotifyUserId);
  invalidateDashboardSectionRuntimeCache(spotifyUserId);

  if (!hasMongoConfig()) {
    return;
  }

  const db = await getDatabase();
  if (!db) {
    return;
  }

  await Promise.all(
    USER_SCOPED_COLLECTIONS.map((collectionName) =>
      db.collection(collectionName).deleteMany({ spotifyUserId }),
    ),
  );
}
