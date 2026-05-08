import { NextResponse } from "next/server";
import { getAuthorizedSession, getSession, hasSpotifyConnection, isSessionRefreshFailure } from "@/lib/auth";
import { backfillMissingArtistMetadataForUser } from "@/lib/spotify-dashboard";
import { hydrateStoredDashboardOverviewTopListMetadata, invalidateDashboardOverviewRuntimeCache, writeStoredDashboardOverviewCache } from "@/lib/dashboard-overview";
import { hydrateStoredTopListsSectionMetadata, invalidateDashboardSectionRuntimeCache } from "@/lib/dashboard-section-cache";
import { getConnectedUser, markConnectedUserArtistMetadataBackfillStatus } from "@/lib/connected-users";
import { normalizeImportedLastFmScrobbles } from "@/lib/lastfm-import";
import { resetStoredAllTimeTopListAggregate } from "@/lib/spotify-toplists";

const RESUME_STALE_MS = 1000 * 60 * 4;
const BACKFILL_ROUTE_BUDGET_MS = 1000 * 60 * 2;

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
      : connectedUser?.artistMetadataBackfillStatus === "pending"
        ? connectedUser.artistMetadataBackfillStep ?? "artist-seed"
        : "artist-seed";
    let backfilledCount = connectedUser?.artistMetadataBackfillCount ?? 0;

    console.log(`[artist-backfill] user=${authorizedSession.spotifyUserId} step=start`);
    await markConnectedUserArtistMetadataBackfillStatus(
      authorizedSession.spotifyUserId,
      "running",
      {
        detail: "Collecting missing artist ids and fetching metadata",
        step: resumeStep,
        backfilledCount,
      },
    ).catch(() => undefined);

    if (resumeStep === "artist-seed") {
      backfilledCount = await backfillMissingArtistMetadataForUser(
        authorizedSession.spotifyUserId,
        authorizedSession.accessToken,
      );
      console.log(`[artist-backfill] user=${authorizedSession.spotifyUserId} step=backfilled count=${backfilledCount}`);
      if (shouldPause()) {
        await markConnectedUserArtistMetadataBackfillStatus(
          authorizedSession.spotifyUserId,
          "pending",
          {
            detail: `Paused after artist metadata fetch for ${backfilledCount} artists. Next refresh will continue with imported-track normalization.`,
            step: "normalize-imports",
            backfilledCount,
          },
        ).catch(() => undefined);
        return NextResponse.json({ status: "paused", resumeStep: "normalize-imports", backfilledCount }, { status: 202 });
      }
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
    };

    if (resumeStep === "artist-seed" || resumeStep === "normalize-imports") {
      await markConnectedUserArtistMetadataBackfillStatus(
        authorizedSession.spotifyUserId,
        "running",
        {
          detail: "Resolving imported Last.fm plays to real Spotify track metadata",
          step: "normalize-imports",
          backfilledCount,
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
              },
            ).catch(() => undefined);
          },
        },
      );
      console.log(
        `[artist-backfill] user=${authorizedSession.spotifyUserId} step=normalize matched=${normalizationResult.matchedTrackGroups} unresolved=${normalizationResult.unresolvedTrackGroups} updated=${normalizationResult.updatedPlayCount} deletedDuplicates=${normalizationResult.deletedDuplicatePlayCount}`,
      );

      if (normalizationResult.stoppedEarly || shouldPause()) {
        await markConnectedUserArtistMetadataBackfillStatus(
          authorizedSession.spotifyUserId,
          "pending",
          {
            detail: `Paused imported-track normalization after ${normalizationResult.processedTrackGroups}/${normalizationResult.scannedTrackGroups} groups. Next refresh will resume from remaining unresolved tracks.`,
            step: "normalize-imports",
            backfilledCount,
          },
        ).catch(() => undefined);
        return NextResponse.json({
          status: "paused",
          resumeStep: "normalize-imports",
          backfilledCount,
          normalizationResult,
        }, { status: 202 });
      }
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
        },
      ).catch(() => undefined);
    }

    const postNormalizeStartStep =
      resumeStep === "hydrate-overview" || resumeStep === "refresh-overview-insights" || resumeStep === "complete"
        ? resumeStep
        : "hydrate-top-lists";

    if (postNormalizeStartStep === "hydrate-top-lists") {
      await markConnectedUserArtistMetadataBackfillStatus(
        authorizedSession.spotifyUserId,
        "running",
        {
          detail: `Updating stored top-list section cache metadata (${backfilledCount} artists)`,
          step: "hydrate-top-lists",
          backfilledCount,
        },
      ).catch(() => undefined);
      await hydrateStoredTopListsSectionMetadata(
        authorizedSession.spotifyUserId,
        authorizedSession.accessToken,
      ).catch(() => undefined);
      if (shouldPause()) {
        await markConnectedUserArtistMetadataBackfillStatus(
          authorizedSession.spotifyUserId,
          "pending",
          {
            detail: "Paused after updating stored top-list metadata. Next refresh will continue with overview metadata refresh.",
            step: "hydrate-overview",
            backfilledCount,
          },
        ).catch(() => undefined);
        return NextResponse.json({ status: "paused", resumeStep: "hydrate-overview", backfilledCount }, { status: 202 });
      }
    }

    if (postNormalizeStartStep === "hydrate-top-lists" || postNormalizeStartStep === "hydrate-overview") {
      await markConnectedUserArtistMetadataBackfillStatus(
        authorizedSession.spotifyUserId,
        "running",
        {
          detail: "Updating stored overview metadata after imported-track normalization",
          step: "hydrate-overview",
          backfilledCount,
        },
      ).catch(() => undefined);
      await hydrateStoredDashboardOverviewTopListMetadata(
        authorizedSession.spotifyUserId,
        authorizedSession.accessToken,
      ).catch(() => undefined);
      if (shouldPause()) {
        await markConnectedUserArtistMetadataBackfillStatus(
          authorizedSession.spotifyUserId,
          "pending",
          {
            detail: "Paused after updating overview metadata. Next refresh will continue with overview insights refresh.",
            step: "refresh-overview-insights",
            backfilledCount,
          },
        ).catch(() => undefined);
        return NextResponse.json({ status: "paused", resumeStep: "refresh-overview-insights", backfilledCount }, { status: 202 });
      }
    }

    if (postNormalizeStartStep !== "complete") {
      await markConnectedUserArtistMetadataBackfillStatus(
        authorizedSession.spotifyUserId,
        "running",
        {
          detail: "Refreshing overview insights cache after imported-track normalization",
          step: "refresh-overview-insights",
          backfilledCount,
        },
      ).catch(() => undefined);
      await writeStoredDashboardOverviewCache(authorizedSession.spotifyUserId, authorizedSession.accessToken, undefined, {
        allowLiveEnrichment: false,
        includeTopLists: false,
      }).catch(() => undefined);
    }

    await markConnectedUserArtistMetadataBackfillStatus(
      authorizedSession.spotifyUserId,
      "success",
      {
        backfilledCount,
        detail: `Artist metadata backfill finished for ${backfilledCount} artists. Imported-track normalization updated ${normalizationResult.updatedPlayCount} plays and removed ${normalizationResult.deletedDuplicatePlayCount} duplicates.`,
        step: "complete",
      },
    ).catch(() => undefined);
    console.log(`[artist-backfill] user=${authorizedSession.spotifyUserId} step=success count=${backfilledCount}`);

    return NextResponse.json({ status: "success", backfilledCount });
  } catch (error) {
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
