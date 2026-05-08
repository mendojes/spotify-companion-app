import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getAuthorizedSession, getSession, hasSpotifyConnection, isSessionRefreshFailure } from "@/lib/auth";
import {
  getConnectedUser,
  markConnectedUserDashboardEnrichmentStatus,
} from "@/lib/connected-users";
import { invalidateDashboardSectionRuntimeCache, writeStoredDashboardSectionCache, writeStoredPlaylistsSectionCache } from "@/lib/dashboard-section-cache";
import { writeStoredDashboardOverviewCache } from "@/lib/dashboard-overview";
import { invalidateDashboardPlaylistPreviewCache, invalidatePlaylistInsightsCache, syncPlaylistLibrary } from "@/lib/spotify-playlists";

function normalizeRange(range?: string) {
  if (range === "month" || range === "all") {
    return range;
  }

  return "week";
}

function logEnrichmentTiming(spotifyUserId: string, step: string, startedAt: number) {
  console.log(`[dashboard-enrich] user=${spotifyUserId} step=${step} elapsedMs=${Date.now() - startedAt}`);
}

const RESUME_STALE_MS = 1000 * 60 * 4;

class CancelledEnrichmentRunError extends Error {
  constructor() {
    super("Dashboard enrichment was cancelled or superseded.");
    this.name = "CancelledEnrichmentRunError";
  }
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

    const enrichmentIsFreshlyRunning =
      connectedUser?.dashboardEnrichmentStatus === "running" &&
      connectedUser.dashboardEnrichmentStartedAt &&
      Date.now() - new Date(connectedUser.dashboardEnrichmentStartedAt).getTime() < RESUME_STALE_MS;

    if (enrichmentIsFreshlyRunning) {
      return NextResponse.json({ status: "running" }, { status: 202 });
    }

    const startedAt = Date.now();
    const runId =
      connectedUser?.dashboardEnrichmentStatus === "running" ||
      connectedUser?.dashboardEnrichmentStatus === "pending" ||
      connectedUser?.dashboardEnrichmentStatus === "paused"
        ? connectedUser.dashboardEnrichmentRunId ?? randomUUID()
        : randomUUID();
    const assertRunIsStillActive = async () => {
      const latestConnectedUser = await getConnectedUser(authorizedSession.spotifyUserId).catch(() => null);
      if (
        latestConnectedUser?.dashboardEnrichmentStatus === "idle" ||
        (latestConnectedUser?.dashboardEnrichmentRunId && latestConnectedUser.dashboardEnrichmentRunId !== runId)
      ) {
        throw new CancelledEnrichmentRunError();
      }
    };
    await markConnectedUserDashboardEnrichmentStatus(authorizedSession.spotifyUserId, "running", {
      range,
      detail: "Starting dashboard enrichment",
      step: connectedUser?.dashboardEnrichmentStatus === "running" ? connectedUser.dashboardEnrichmentStep : "start",
      runId,
    }).catch(() => undefined);
    const resumeStep = connectedUser?.dashboardEnrichmentStatus === "running"
      ? connectedUser.dashboardEnrichmentStep ?? "start"
      : "start";

    if (resumeStep === "start" || resumeStep === "playlist-sync") {
      const playlistSyncStartedAt = Date.now();
      await markConnectedUserDashboardEnrichmentStatus(authorizedSession.spotifyUserId, "running", {
        range,
        detail: "Syncing playlist library",
        step: "playlist-sync",
        runId,
      }).catch(() => undefined);
      await syncPlaylistLibrary(authorizedSession.accessToken, authorizedSession.spotifyUserId).catch(() => undefined);
      await assertRunIsStillActive();
      logEnrichmentTiming(authorizedSession.spotifyUserId, "playlist-library-sync", playlistSyncStartedAt);
      invalidatePlaylistInsightsCache(authorizedSession.spotifyUserId);
      invalidateDashboardPlaylistPreviewCache(authorizedSession.spotifyUserId);
      invalidateDashboardSectionRuntimeCache(authorizedSession.spotifyUserId);
    }

    if (resumeStep === "start" || resumeStep === "playlist-sync" || resumeStep === "playlist-section") {
      const playlistSectionStartedAt = Date.now();
      await markConnectedUserDashboardEnrichmentStatus(authorizedSession.spotifyUserId, "running", {
        range,
        detail: "Rebuilding playlist section cache",
        step: "playlist-section",
        runId,
      }).catch(() => undefined);
      await writeStoredPlaylistsSectionCache(authorizedSession.spotifyUserId).catch(() => undefined);
      await assertRunIsStillActive();
      logEnrichmentTiming(authorizedSession.spotifyUserId, "playlist-section-cache", playlistSectionStartedAt);
    }

    if (["start", "playlist-sync", "playlist-section", "overview"].includes(resumeStep)) {
      const overviewStartedAt = Date.now();
      await markConnectedUserDashboardEnrichmentStatus(authorizedSession.spotifyUserId, "running", {
        range,
        detail: "Rebuilding overview cache",
        step: "overview",
        runId,
      }).catch(() => undefined);
      await writeStoredDashboardOverviewCache(authorizedSession.spotifyUserId, authorizedSession.accessToken, range, {
        allowLiveEnrichment: false,
        includeTopLists: false,
        onProgress: async (detail) => {
          await markConnectedUserDashboardEnrichmentStatus(authorizedSession.spotifyUserId, "running", {
            range,
            detail: `Overview cache: ${detail}`,
            step: "overview",
            runId,
          }).catch(() => undefined);
        },
      });
      await assertRunIsStillActive();
      logEnrichmentTiming(authorizedSession.spotifyUserId, "overview-cache", overviewStartedAt);
    }

    if (["start", "playlist-sync", "playlist-section", "overview", "section-cache"].includes(resumeStep)) {
      const sectionCacheStartedAt = Date.now();
      await markConnectedUserDashboardEnrichmentStatus(authorizedSession.spotifyUserId, "running", {
        range,
        detail: "Rebuilding section caches including top lists",
        step: "section-cache",
        runId,
      }).catch(() => undefined);
      await writeStoredDashboardSectionCache(authorizedSession.spotifyUserId, {
        includeRediscovery: false,
        includeAnalysis: false,
        includeAllTimeAnalysis: false,
        includeAllTimeTopLists: false,
        onProgress: async (detail) => {
          await markConnectedUserDashboardEnrichmentStatus(authorizedSession.spotifyUserId, "running", {
            range,
            detail,
            step: "section-cache",
            runId,
          }).catch(() => undefined);
        },
      }).catch(() => undefined);
      await assertRunIsStillActive();
      logEnrichmentTiming(authorizedSession.spotifyUserId, "section-cache", sectionCacheStartedAt);
    }
    await markConnectedUserDashboardEnrichmentStatus(authorizedSession.spotifyUserId, "success", {
      range,
      detail: "Dashboard caches rebuilt successfully.",
      step: "complete",
      runId,
    }).catch(() => undefined);
    logEnrichmentTiming(authorizedSession.spotifyUserId, "total", startedAt);

    return NextResponse.json({ status: "success", needsArtistMetadataBackfill: false });
  } catch (error) {
    if (error instanceof CancelledEnrichmentRunError) {
      return NextResponse.json({ status: "cancelled" }, { status: 202 });
    }
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
