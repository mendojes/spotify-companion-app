import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDatabase, hasMongoConfig } from "@/lib/mongodb";
import type { DashboardRange, SpotifyDashboardSnapshot } from "@/lib/types";

const SNAPSHOT_HISTORY_COLLECTION = "spotify_snapshots_history";

function getRangeWindow(range: DashboardRange) {
  const now = Date.now();

  if (range === "week") {
    return new Date(now - 1000 * 60 * 60 * 24 * 7);
  }

  if (range === "month") {
    return new Date(now - 1000 * 60 * 60 * 24 * 30);
  }

  return null;
}

function countInRange(snapshots: SpotifyDashboardSnapshot[], range: DashboardRange) {
  const windowStart = getRangeWindow(range);

  if (!windowStart) {
    return snapshots.length;
  }

  return snapshots.filter((snapshot) => new Date(snapshot.fetchedAt).getTime() >= windowStart.getTime()).length;
}

export async function GET() {
  const session = await getSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasMongoConfig()) {
    return NextResponse.json({ error: "MongoDB is not configured." }, { status: 503 });
  }

  const db = await getDatabase({ forceRetry: true });

  if (!db) {
    return NextResponse.json({ error: "MongoDB is unavailable." }, { status: 503 });
  }

  const snapshots = await db
    .collection<SpotifyDashboardSnapshot>(SNAPSHOT_HISTORY_COLLECTION)
    .find({ spotifyUserId: session.spotifyUserId }, { projection: { spotifyUserId: 1, fetchedAt: 1 } })
    .sort({ fetchedAt: -1 })
    .limit(500)
    .toArray();

  const fetchedAtValues = snapshots.map((snapshot) => snapshot.fetchedAt).filter(Boolean);
  const newestFetchedAt = fetchedAtValues[0] ?? null;
  const oldestFetchedAt = fetchedAtValues.length > 0 ? fetchedAtValues[fetchedAtValues.length - 1] : null;

  return NextResponse.json({
    spotifyUserId: session.spotifyUserId,
    totalSnapshotsLoaded: snapshots.length,
    newestFetchedAt,
    oldestFetchedAt,
    counts: {
      week: countInRange(snapshots, "week"),
      month: countInRange(snapshots, "month"),
      all: snapshots.length,
    },
    samples: {
      newest: fetchedAtValues.slice(0, 5),
      oldest: fetchedAtValues.slice(-5),
    },
  });
}
