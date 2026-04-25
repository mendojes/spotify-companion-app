import { NextRequest, NextResponse } from "next/server";
import { getAuthorizedSession, getSession, hasSpotifyConnection, isSessionRefreshFailure } from "@/lib/auth";
import {
  getConnectedUser,
  markConnectedUserDashboardEnrichmentStatus,
} from "@/lib/connected-users";
import { writeStoredDashboardOverviewCache } from "@/lib/dashboard-overview";

function normalizeRange(range?: string) {
  if (range === "month" || range === "all") {
    return range;
  }

  return "week";
}

function logEnrichmentTiming(spotifyUserId: string, step: string, startedAt: number) {
  console.log(`[dashboard-enrich] user=${spotifyUserId} step=${step} elapsedMs=${Date.now() - startedAt}`);
}

export async function POST(request: NextRequest) {
  const session = await getSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasSpotifyConnection(session)) {
    return NextResponse.json({ error: "Spotify connection required." }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const range = normalizeRange(searchParams.get("range") ?? undefined);

  try {
    const authorizedSession = await getAuthorizedSession(session);
    const connectedUser = await getConnectedUser(authorizedSession.spotifyUserId).catch(() => null);

    if (connectedUser?.dashboardEnrichmentStatus === "running") {
      return NextResponse.json({ status: "running" }, { status: 202 });
    }

    const startedAt = Date.now();
    await markConnectedUserDashboardEnrichmentStatus(authorizedSession.spotifyUserId, "running", { range }).catch(() => undefined);
    await writeStoredDashboardOverviewCache(authorizedSession.spotifyUserId, authorizedSession.accessToken, range, {
      allowLiveEnrichment: true,
    });
    await markConnectedUserDashboardEnrichmentStatus(authorizedSession.spotifyUserId, "success", { range }).catch(() => undefined);
    logEnrichmentTiming(authorizedSession.spotifyUserId, "total", startedAt);

    return NextResponse.json({ status: "success" });
  } catch (error) {
    if (isSessionRefreshFailure(error)) {
      return NextResponse.json({ error: "Session refresh failed." }, { status: 401 });
    }

    const session = await getSession();
    if (session?.spotifyUserId) {
      const message = error instanceof Error ? error.message : "Dashboard enrichment failed.";
      await markConnectedUserDashboardEnrichmentStatus(session.spotifyUserId, "error", { range, errorMessage: message }).catch(() => undefined);
    }

    const message = error instanceof Error ? error.message : "Dashboard enrichment failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
