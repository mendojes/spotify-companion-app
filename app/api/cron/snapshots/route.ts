import { NextRequest, NextResponse } from "next/server";
import { listActiveConnectedUsers, markConnectedUserSnapshotStatus } from "@/lib/connected-users";
import { refreshSpotifyAccessToken } from "@/lib/spotify";
import { refreshDashboardSnapshot } from "@/lib/spotify-dashboard";

function isAuthorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return false;
  }

  const authHeader = request.headers.get("authorization");
  return authHeader === `Bearer ${secret}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const users = await listActiveConnectedUsers(25);
  const results: Array<{ spotifyUserId: string; status: "success" | "error"; message?: string }> = [];

  for (const user of users) {
    try {
      const token = await refreshSpotifyAccessToken(user.refreshToken);
      await refreshDashboardSnapshot(token.access_token, user.spotifyUserId);
      await markConnectedUserSnapshotStatus(user.spotifyUserId, "success");
      results.push({ spotifyUserId: user.spotifyUserId, status: "success" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown snapshot failure";
      await markConnectedUserSnapshotStatus(user.spotifyUserId, "error", message);
      results.push({ spotifyUserId: user.spotifyUserId, status: "error", message });
    }
  }

  return NextResponse.json({
    processedUsers: users.length,
    results,
    ranAt: new Date().toISOString(),
  });
}
