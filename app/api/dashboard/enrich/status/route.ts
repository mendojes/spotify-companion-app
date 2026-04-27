import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getConnectedUser } from "@/lib/connected-users";

export async function GET() {
  const session = await getSession();

  if (!session?.spotifyUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const connectedUser = await getConnectedUser(session.spotifyUserId).catch(() => null);

  return NextResponse.json({
    status: connectedUser?.dashboardEnrichmentStatus ?? "idle",
    range: connectedUser?.dashboardEnrichmentRange,
    startedAt: connectedUser?.dashboardEnrichmentStartedAt,
    finishedAt: connectedUser?.dashboardEnrichmentFinishedAt,
    error: connectedUser?.dashboardEnrichmentError,
    artistBackfillStatus: connectedUser?.artistMetadataBackfillStatus ?? "idle",
    artistBackfillStartedAt: connectedUser?.artistMetadataBackfillStartedAt,
    artistBackfillFinishedAt: connectedUser?.artistMetadataBackfillFinishedAt,
    artistBackfillError: connectedUser?.artistMetadataBackfillError,
    artistBackfillCount: connectedUser?.artistMetadataBackfillCount,
  });
}
