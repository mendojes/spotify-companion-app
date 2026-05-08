import { NextRequest, NextResponse } from "next/server";
import { getAuthorizedSession, getSession, hasSpotifyConnection, isSessionRefreshFailure } from "@/lib/auth";
import {
  MaintenanceAction,
  writeMaintenanceHistoryEntry,
  runDashboardMaintenanceAction,
} from "@/lib/dashboard-maintenance";
import {
  markConnectedUserArtistMetadataBackfillStatus,
  markConnectedUserDashboardEnrichmentStatus,
} from "@/lib/connected-users";

function isMaintenanceAction(value: string): value is MaintenanceAction {
  return [
    "rebuild-playlist-cache",
    "rebuild-overview-cache",
    "rebuild-top-list-caches",
    "backfill-artist-metadata",
    "normalize-lastfm-imports",
    "refresh-track-library-full",
    "refresh-track-library-incremental",
    "refresh-artist-library-full",
    "refresh-artist-library-incremental",
    "refresh-album-library-full",
    "refresh-album-library-incremental",
    "refresh-all-time-full",
    "refresh-all-time-incremental",
  ].includes(value);
}

function describeMaintenanceAction(action: MaintenanceAction) {
  switch (action) {
    case "rebuild-playlist-cache":
      return "Rebuilding playlist section cache";
    case "rebuild-overview-cache":
      return "Rebuilding overview cache";
    case "rebuild-top-list-caches":
      return "Rebuilding cached week, month, and year top lists";
    case "backfill-artist-metadata":
      return "Backfilling artist metadata";
    case "normalize-lastfm-imports":
      return "Normalizing imported Last.fm scrobbles";
    case "refresh-track-library-full":
      return "Fully rebuilding permanent track metadata and counts";
    case "refresh-track-library-incremental":
      return "Incrementally updating permanent track metadata and counts";
    case "refresh-artist-library-full":
      return "Fully rebuilding permanent artist metadata and counts";
    case "refresh-artist-library-incremental":
      return "Incrementally updating permanent artist metadata and counts";
    case "refresh-album-library-full":
      return "Fully rebuilding permanent album metadata and counts";
    case "refresh-album-library-incremental":
      return "Incrementally updating permanent album metadata and counts";
    case "refresh-all-time-full":
      return "Fully rebuilding all-time top lists from permanent libraries";
    case "refresh-all-time-incremental":
      return "Incrementally updating all-time top lists from permanent libraries";
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

  const body = await request.json().catch(() => ({}));
  const action = typeof body?.action === "string" && isMaintenanceAction(body.action) ? body.action : null;
  if (!action) {
    return NextResponse.json({ error: "Invalid maintenance action." }, { status: 400 });
  }

  try {
    const authorizedSession = await getAuthorizedSession(session);
    const baseDetail = describeMaintenanceAction(action);
    const startedAt = new Date().toISOString();

    if (action === "normalize-lastfm-imports") {
      await markConnectedUserArtistMetadataBackfillStatus(authorizedSession.spotifyUserId, "running", {
        detail: baseDetail,
        step: action,
        checkpoint: null,
      }).catch(() => undefined);
    } else {
      await markConnectedUserDashboardEnrichmentStatus(authorizedSession.spotifyUserId, "running", {
        range: "week",
        detail: baseDetail,
        step: action,
        checkpoint: null,
      }).catch(() => undefined);
    }
    await writeMaintenanceHistoryEntry(
      authorizedSession.spotifyUserId,
      action,
      "running",
      baseDetail,
      { startedAt },
    ).catch(() => undefined);

    const result = await runDashboardMaintenanceAction(
      action,
      authorizedSession.spotifyUserId,
      authorizedSession.accessToken,
      async (detail) => {
        if (action === "normalize-lastfm-imports") {
          await markConnectedUserArtistMetadataBackfillStatus(authorizedSession.spotifyUserId, "running", {
            detail,
            step: action,
          }).catch(() => undefined);
        } else {
          await markConnectedUserDashboardEnrichmentStatus(authorizedSession.spotifyUserId, "running", {
            range: "week",
            detail,
            step: action,
          }).catch(() => undefined);
        }
      },
    );

    const successDetail = result && typeof result === "object" && "partial" in result && result.partial
      ? `${baseDetail} saved a partial batch. Run it again to continue from the smaller remaining set.`
      : `${baseDetail} finished successfully.`;

    if (action === "normalize-lastfm-imports") {
      await markConnectedUserArtistMetadataBackfillStatus(authorizedSession.spotifyUserId, "success", {
        detail: successDetail,
        step: action,
        checkpoint: null,
      }).catch(() => undefined);
    } else {
      await markConnectedUserDashboardEnrichmentStatus(authorizedSession.spotifyUserId, "success", {
        range: "week",
        detail: successDetail,
        step: action,
        checkpoint: null,
      }).catch(() => undefined);
    }
    await writeMaintenanceHistoryEntry(
      authorizedSession.spotifyUserId,
      action,
      "success",
      successDetail,
      {
        partial: Boolean(result && typeof result === "object" && "partial" in result && result.partial),
        startedAt,
      },
    ).catch(() => undefined);

    return NextResponse.json({ status: "success", action, result });
  } catch (error) {
    if (isSessionRefreshFailure(error)) {
      return NextResponse.json({ error: "Session refresh failed." }, { status: 401 });
    }

    const message = error instanceof Error ? error.message : "Dashboard maintenance failed.";
    if (session.spotifyUserId) {
      await writeMaintenanceHistoryEntry(
        session.spotifyUserId,
        action,
        "error",
        message,
      ).catch(() => undefined);
      if (action === "normalize-lastfm-imports") {
        await markConnectedUserArtistMetadataBackfillStatus(session.spotifyUserId, "error", {
          errorMessage: message,
          detail: `Maintenance action failed: ${action}`,
        }).catch(() => undefined);
      } else {
        await markConnectedUserDashboardEnrichmentStatus(session.spotifyUserId, "error", {
          range: "week",
          errorMessage: message,
          detail: `Maintenance action failed: ${action}`,
        }).catch(() => undefined);
      }
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
