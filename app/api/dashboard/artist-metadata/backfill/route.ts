import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getAuthorizedSession, getSession, hasSpotifyConnection, isSessionRefreshFailure } from "@/lib/auth";
import { backfillMissingArtistMetadataForUser } from "@/lib/spotify-dashboard";
import { hydrateStoredDashboardOverviewTopListMetadata, invalidateDashboardOverviewRuntimeCache, writeStoredDashboardOverviewCache } from "@/lib/dashboard-overview";
import { hydrateStoredTopListsSectionMetadata, invalidateDashboardSectionRuntimeCache } from "@/lib/dashboard-section-cache";
import { getConnectedUser, markConnectedUserArtistMetadataBackfillStatus } from "@/lib/connected-users";
import { normalizeImportedLastFmScrobbles } from "@/lib/lastfm-import";
import { resetStoredAllTimeTopListAggregate } from "@/lib/spotify-toplists";

const RESUME_STALE_MS = 1000 * 60 * 4;
const BACKFILL_ROUTE_BUDGET_MS = 1000 * 60 * 2;

class CancelledBackfillRunError extends Error {
  constructor() {
    super("Artist metadata backfill was cancelled or superseded.");
    this.name = "CancelledBackfillRunError";
  }
}

export async function POST() {
  const session = await getSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasSpotifyConnection(session)) {
    return NextResponse.json({ error: "Spotify connection required." }, { status: 403 });
  }

  try {
    const authorizedSession = await getAuthorizedSession(session);
    const connectedUser = await getConnectedUser(authorizedSession.spotifyUserId).catch(() => null);

    const backfillIsFreshlyRunning =
      connectedUser?.artistMetadataBackfillStatus === "running" &&
      connectedUser.artistMetadataBackfillStartedAt &&
      Date.now() - new Date(connectedUser.artistMetadataBackfillStartedAt).getTime() < RESUME_STALE_MS;

    if (backfillIsFreshlyRunning) {
      return NextResponse.json({ status: "running" }, { status: 202 });
    }

    const startedAt = Date.now();
    const shouldPause = () => Date.now() - startedAt >= BACKFILL_ROUTE_BUDGET_MS;
    const resumeStep = connectedUser?.artistMetadataBackfillStatus === "running"
      ? connectedUser.artistMetadataBackfillStep ?? "artist-seed"
      : "artist-seed";
    const runId =
      connectedUser?.artistMetadataBackfillStatus === "running" ||
      connectedUser?.artistMetadataBackfillStatus === "pending" ||
      connectedUser?.artistMetadataBackfillStatus === "paused"
        ? connectedUser.artistMetadataBackfillRunId ?? randomUUID()
        : randomUUID();
    let backfilledCount = connectedUser?.artistMetadataBackfillCount ?? 0;
    const assertRunIsStillActive = async () => {
      const latestConnectedUser = await getConnectedUser(authorizedSession.spotifyUserId).catch(() => null);
      if (
        latestConnectedUser?.artistMetadataBackfillStatus === "idle" ||
        (latestConnectedUser?.artistMetadataBackfillRunId && latestConnectedUser.artistMetadataBackfillRunId !== runId)
      ) {
        throw new CancelledBackfillRunError();
      }
    };

    console.log(`[artist-backfill] user=${authorizedSession.spotifyUserId} step=start`);
    await markConnectedUserArtistMetadataBackfillStatus(
      authorizedSession.spotifyUserId,
      "running",
      {
        detail: "Collecting missing artist ids and fetching metadata",
        step: resumeStep,
        backfilledCount,
        checkpoint: null,
        runId,
      },
    ).catch(() => undefined);

    if (resumeStep === "artist-seed") {
      await assertRunIsStillActive();
      backfilledCount = await backfillMissingArtistMetadataForUser(
        authorizedSession.spotifyUserId,
        authorizedSession.accessToken,
      );
      await assertRunIsStillActive();
      console.log(`[artist-backfill] user=${authorizedSession.spotifyUserId} step=backfilled count=${backfilledCount}`);
    }

    let normalizationResult = {
      scannedTrackGroups: 0,
      processedTrackGroups: 0,
      matchedTrackGroups: 0,
      unresolvedTrackGroups: 0,
      updatedPlayCount: 0,
      deletedDuplicatePlayCount: 0,
      timedOutTrackGroups: 0,
      stoppedEarly: false,
      processedNameKeys: [] as string[],
    };

    if (resumeStep === "artist-seed" || resumeStep === "normalize-imports") {
      await markConnectedUserArtistMetadataBackfillStatus(
        authorizedSession.spotifyUserId,
        "running",
        {
          detail: "Resolving imported Last.fm plays to real Spotify track metadata",
          step: "normalize-imports",
          backfilledCount,
          checkpoint: null,
          runId,
        },
      ).catch(() => undefined);
      normalizationResult = await normalizeImportedLastFmScrobbles(
        authorizedSession.spotifyUserId,
        authorizedSession.accessToken,
        {
          limitDistinctTracks: 40,
          perTrackTimeoutMs: 2500,
          maxRuntimeMs: 20000,
          onProgress: async (detail) => {
            await markConnectedUserArtistMetadataBackfillStatus(
              authorizedSession.spotifyUserId,
              "running",
              {
                detail,
                step: "normalize-imports",
                backfilledCount,
                checkpoint: null,
                runId,
              },
            ).catch(() => undefined);
          },
        },
      );
      await assertRunIsStillActive();
      console.log(
        `[artist-backfill] user=${authorizedSession.spotifyUserId} step=normalize matched=${normalizationResult.matchedTrackGroups} unresolved=${normalizationResult.unresolvedTrackGroups} updated=${normalizationResult.updatedPlayCount} deletedDuplicates=${normalizationResult.deletedDuplicatePlayCount}`,
      );
    }

    invalidateDashboardSectionRuntimeCache(authorizedSession.spotifyUserId);
    invalidateDashboardOverviewRuntimeCache(authorizedSession.spotifyUserId);

    if (normalizationResult.updatedPlayCount > 0 || normalizationResult.deletedDuplicatePlayCount > 0) {
      await resetStoredAllTimeTopListAggregate(authorizedSession.spotifyUserId).catch(() => undefined);
    } else {
      await markConnectedUserArtistMetadataBackfillStatus(
        authorizedSession.spotifyUserId,
        "running",
        {
          detail: `Hydrating cached top-list metadata after artist metadata backfill (${backfilledCount} artists)`,
          step: "hydrate-top-lists",
          backfilledCount,
          checkpoint: null,
          runId,
        },
      ).catch(() => undefined);
    }

    const postNormalizeStartStep =
      resumeStep === "hydrate-overview" || resumeStep === "refresh-overview-insights" || resumeStep === "complete"
        ? resumeStep
        : "hydrate-top-lists";

    if (postNormalizeStartStep === "hydrate-top-lists") {
      if (shouldPause()) {
        await markConnectedUserArtistMetadataBackfillStatus(
          authorizedSession.spotifyUserId,
          "success",
          {
            detail: `Backfill applied ${normalizationResult.updatedPlayCount} imported-play updates and skipped remaining expensive cache hydration so saved progress could be kept. Run backfill again to continue unresolved tracks.`,
            step: "complete",
            backfilledCount,
            checkpoint: null,
            runId,
          },
        ).catch(() => undefined);
        return NextResponse.json({ status: "success", partial: true, backfilledCount }, { status: 200 });
      }
      await markConnectedUserArtistMetadataBackfillStatus(
        authorizedSession.spotifyUserId,
        "running",
        {
          detail: `Updating stored top-list section cache metadata (${backfilledCount} artists)`,
          step: "hydrate-top-lists",
          backfilledCount,
          runId,
        },
      ).catch(() => undefined);
      await hydrateStoredTopListsSectionMetadata(
        authorizedSession.spotifyUserId,
        authorizedSession.accessToken,
      ).catch(() => undefined);
      await assertRunIsStillActive();
      if (shouldPause()) {
        await markConnectedUserArtistMetadataBackfillStatus(
          authorizedSession.spotifyUserId,
          "success",
          {
            detail: "Backfill updated stored top-list metadata and stopped before the overview refresh so current progress could be kept. Run backfill again to continue unresolved tracks.",
            step: "complete",
            backfilledCount,
            checkpoint: null,
            runId,
          },
        ).catch(() => undefined);
        return NextResponse.json({ status: "success", partial: true, backfilledCount }, { status: 200 });
      }
    }

    if (postNormalizeStartStep === "hydrate-top-lists" || postNormalizeStartStep === "hydrate-overview") {
      if (shouldPause()) {
        await markConnectedUserArtistMetadataBackfillStatus(
          authorizedSession.spotifyUserId,
          "success",
          {
            detail: "Backfill kept its imported-play updates and skipped the overview metadata refresh so the saved progress could land. Run backfill again to continue unresolved tracks.",
            step: "complete",
            backfilledCount,
            checkpoint: null,
            runId,
          },
        ).catch(() => undefined);
        return NextResponse.json({ status: "success", partial: true, backfilledCount }, { status: 200 });
      }
      await markConnectedUserArtistMetadataBackfillStatus(
        authorizedSession.spotifyUserId,
        "running",
        {
          detail: "Updating stored overview metadata after imported-track normalization",
          step: "hydrate-overview",
          backfilledCount,
          runId,
        },
      ).catch(() => undefined);
      await hydrateStoredDashboardOverviewTopListMetadata(
        authorizedSession.spotifyUserId,
        authorizedSession.accessToken,
      ).catch(() => undefined);
      await assertRunIsStillActive();
      if (shouldPause()) {
        await markConnectedUserArtistMetadataBackfillStatus(
          authorizedSession.spotifyUserId,
          "success",
          {
            detail: "Backfill updated overview metadata and stopped before the overview insights refresh so current progress could be kept. Run backfill again to continue unresolved tracks.",
            step: "complete",
            backfilledCount,
            checkpoint: null,
            runId,
          },
        ).catch(() => undefined);
        return NextResponse.json({ status: "success", partial: true, backfilledCount }, { status: 200 });
      }
    }

    if (postNormalizeStartStep !== "complete") {
      if (shouldPause()) {
        await markConnectedUserArtistMetadataBackfillStatus(
          authorizedSession.spotifyUserId,
          "success",
          {
            detail: "Backfill kept its imported-play updates and skipped the overview insights refresh so current progress could be kept. Run backfill again to continue unresolved tracks.",
            step: "complete",
            backfilledCount,
            checkpoint: null,
            runId,
          },
        ).catch(() => undefined);
        return NextResponse.json({ status: "success", partial: true, backfilledCount }, { status: 200 });
      }
      await markConnectedUserArtistMetadataBackfillStatus(
        authorizedSession.spotifyUserId,
        "running",
        {
          detail: "Refreshing overview insights cache after imported-track normalization",
          step: "refresh-overview-insights",
          backfilledCount,
          runId,
        },
      ).catch(() => undefined);
      await writeStoredDashboardOverviewCache(authorizedSession.spotifyUserId, authorizedSession.accessToken, undefined, {
        allowLiveEnrichment: false,
        includeTopLists: false,
      }).catch(() => undefined);
      await assertRunIsStillActive();
      if (shouldPause()) {
        await markConnectedUserArtistMetadataBackfillStatus(
          authorizedSession.spotifyUserId,
          "success",
          {
            detail: "Backfill refreshed overview insights for the work completed so far and stopped before any extra processing. Run backfill again to continue unresolved tracks.",
            step: "complete",
            backfilledCount,
            checkpoint: null,
            runId,
          },
        ).catch(() => undefined);
        return NextResponse.json({ status: "success", partial: true, backfilledCount }, { status: 200 });
      }
    }

    await markConnectedUserArtistMetadataBackfillStatus(
      authorizedSession.spotifyUserId,
      "success",
      {
        backfilledCount,
        detail: normalizationResult.stoppedEarly || shouldPause()
          ? `Backfill saved ${normalizationResult.updatedPlayCount} imported-play updates, removed ${normalizationResult.deletedDuplicatePlayCount} duplicates, and stopped before finishing every unresolved track. Run backfill again to continue with the smaller remaining set.`
          : `Artist metadata backfill finished for ${backfilledCount} artists. Imported-track normalization updated ${normalizationResult.updatedPlayCount} plays and removed ${normalizationResult.deletedDuplicatePlayCount} duplicates.`,
        step: "complete",
        checkpoint: null,
        runId,
      },
    ).catch(() => undefined);
    console.log(`[artist-backfill] user=${authorizedSession.spotifyUserId} step=success count=${backfilledCount}`);

    return NextResponse.json({ status: "success", backfilledCount });
  } catch (error) {
    if (error instanceof CancelledBackfillRunError) {
      return NextResponse.json({ status: "cancelled" }, { status: 202 });
    }
    if (isSessionRefreshFailure(error)) {
      return NextResponse.json({ error: "Session refresh failed." }, { status: 401 });
    }

    const message = error instanceof Error ? error.message : "Artist metadata backfill failed.";
    if (session?.spotifyUserId) {
      await markConnectedUserArtistMetadataBackfillStatus(session.spotifyUserId, "error", {
        errorMessage: message,
        detail: "Artist metadata backfill route failed",
      }).catch(() => undefined);
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
