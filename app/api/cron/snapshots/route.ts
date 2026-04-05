import { NextRequest, NextResponse } from "next/server";
import { listActiveConnectedUsers, markConnectedUserRecentSync, markConnectedUserSnapshotStatus } from "@/lib/connected-users";
import { refreshSpotifyAccessToken } from "@/lib/spotify";
import { refreshDashboardSnapshot, shouldWriteSnapshot } from "@/lib/spotify-dashboard";
import { syncRecentPlays } from "@/lib/spotify-activity";

const MAX_USERS_PER_RUN = 10;
const MIN_RECENT_SYNC_INTERVAL_MS = 1000 * 60 * 60 * 6;

function isAuthorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return false;
  }

  const authHeader = request.headers.get("authorization");
  return authHeader === `Bearer ${secret}`;
}

function isStale(isoDate?: string, ttlMs = MIN_RECENT_SYNC_INTERVAL_MS) {
  if (!isoDate) {
    return true;
  }

  return Date.now() - new Date(isoDate).getTime() >= ttlMs;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const users = await listActiveConnectedUsers(MAX_USERS_PER_RUN);
  const results: Array<{ spotifyUserId: string; recentSync: string; snapshot: string; detail?: string }> = [];

  for (const user of users) {
    try {
      const token = await refreshSpotifyAccessToken(user.refreshToken);
      let recentPlays: Awaited<ReturnType<typeof syncRecentPlays>> = [];
      let recentSync = "skipped";

      if (isStale(user.lastRecentSyncAt)) {
        recentPlays = await syncRecentPlays(token.access_token, user.spotifyUserId).catch(() => []);
        await markConnectedUserRecentSync(user.spotifyUserId);
        recentSync = recentPlays.length > 0 ? `synced ${recentPlays.length}` : "synced 0";
      }

      const shouldSnapshot = await shouldWriteSnapshot(user.spotifyUserId, recentPlays);

      if (shouldSnapshot) {
        await refreshDashboardSnapshot(token.access_token, user.spotifyUserId, recentPlays);
        await markConnectedUserSnapshotStatus(user.spotifyUserId, "success");
        results.push({ spotifyUserId: user.spotifyUserId, recentSync, snapshot: "written" });
      } else {
        results.push({ spotifyUserId: user.spotifyUserId, recentSync, snapshot: "skipped" });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown cron error";
      await markConnectedUserSnapshotStatus(user.spotifyUserId, "error", message).catch(() => undefined);
      results.push({ spotifyUserId: user.spotifyUserId, recentSync: "error", snapshot: "error", detail: message });
    }
  }

  return NextResponse.json({
    processedUsers: users.length,
    results,
    ranAt: new Date().toISOString(),
  });
}
