import { NextResponse } from "next/server";
import { getAuthorizedSession, getSession, hasSpotifyConnection, isSessionRefreshFailure } from "@/lib/auth";
import { backfillMissingArtistMetadataForUser } from "@/lib/spotify-dashboard";
import { hydrateStoredDashboardOverviewTopListMetadata, invalidateDashboardOverviewRuntimeCache, writeStoredDashboardOverviewCache } from "@/lib/dashboard-overview";
import { hydrateStoredTopListsSectionMetadata, invalidateDashboardSectionRuntimeCache, writeStoredDashboardSectionCache } from "@/lib/dashboard-section-cache";
import { getConnectedUser, markConnectedUserArtistMetadataBackfillStatus } from "@/lib/connected-users";
import { normalizeImportedLastFmScrobbles } from "@/lib/lastfm-import";

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

    if (connectedUser?.artistMetadataBackfillStatus === "running") {
      return NextResponse.json({ status: "running" }, { status: 202 });
    }

    console.log(`[artist-backfill] user=${authorizedSession.spotifyUserId} step=start`);
    await markConnectedUserArtistMetadataBackfillStatus(
      authorizedSession.spotifyUserId,
      "running",
      { detail: "Collecting missing artist ids and fetching metadata" },
    ).catch(() => undefined);
    const backfilledCount = await backfillMissingArtistMetadataForUser(
      authorizedSession.spotifyUserId,
      authorizedSession.accessToken,
    );
    console.log(`[artist-backfill] user=${authorizedSession.spotifyUserId} step=backfilled count=${backfilledCount}`);
    await markConnectedUserArtistMetadataBackfillStatus(
      authorizedSession.spotifyUserId,
      "running",
      { detail: "Resolving imported Last.fm plays to real Spotify track metadata" },
    ).catch(() => undefined);
    const normalizationResult = await normalizeImportedLastFmScrobbles(
      authorizedSession.spotifyUserId,
      authorizedSession.accessToken,
      {
        onProgress: async (detail) => {
          await markConnectedUserArtistMetadataBackfillStatus(
            authorizedSession.spotifyUserId,
            "running",
            { detail },
          ).catch(() => undefined);
        },
      },
    );
    console.log(
      `[artist-backfill] user=${authorizedSession.spotifyUserId} step=normalize matched=${normalizationResult.matchedTrackGroups} unresolved=${normalizationResult.unresolvedTrackGroups} updated=${normalizationResult.updatedPlayCount} deletedDuplicates=${normalizationResult.deletedDuplicatePlayCount}`,
    );

    invalidateDashboardSectionRuntimeCache(authorizedSession.spotifyUserId);
    invalidateDashboardOverviewRuntimeCache(authorizedSession.spotifyUserId);

    if (normalizationResult.updatedPlayCount > 0 || normalizationResult.deletedDuplicatePlayCount > 0) {
      await markConnectedUserArtistMetadataBackfillStatus(
        authorizedSession.spotifyUserId,
        "running",
        {
          detail: `Rebuilding cached top lists after imported-track normalization (${normalizationResult.updatedPlayCount} updated plays, ${normalizationResult.deletedDuplicatePlayCount} duplicate removals)`,
        },
      ).catch(() => undefined);
      await Promise.all([
        writeStoredDashboardSectionCache(authorizedSession.spotifyUserId, {
          accessToken: authorizedSession.accessToken,
          includeRediscovery: false,
          onProgress: async (detail) => {
            await markConnectedUserArtistMetadataBackfillStatus(
              authorizedSession.spotifyUserId,
              "running",
              { detail },
            ).catch(() => undefined);
          },
        }).catch(() => undefined),
        writeStoredDashboardOverviewCache(authorizedSession.spotifyUserId, authorizedSession.accessToken, undefined, {
          allowLiveEnrichment: false,
        }).catch(() => undefined),
      ]);
    } else {
      await markConnectedUserArtistMetadataBackfillStatus(
        authorizedSession.spotifyUserId,
        "running",
        { detail: `Hydrating cached top-list metadata after artist metadata backfill (${backfilledCount} artists)` },
      ).catch(() => undefined);
      await Promise.all([
        (async () => {
          await markConnectedUserArtistMetadataBackfillStatus(
            authorizedSession.spotifyUserId,
            "running",
            { detail: `Updating stored top-list section cache metadata (${backfilledCount} artists)` },
          ).catch(() => undefined);
          await hydrateStoredTopListsSectionMetadata(
            authorizedSession.spotifyUserId,
            authorizedSession.accessToken,
          ).catch(() => undefined);
        })(),
        (async () => {
          await markConnectedUserArtistMetadataBackfillStatus(
            authorizedSession.spotifyUserId,
            "running",
            { detail: `Updating stored overview top-list metadata (${backfilledCount} artists)` },
          ).catch(() => undefined);
          await hydrateStoredDashboardOverviewTopListMetadata(
            authorizedSession.spotifyUserId,
            authorizedSession.accessToken,
          ).catch(() => undefined);
        })(),
      ]);
    }

    await markConnectedUserArtistMetadataBackfillStatus(
      authorizedSession.spotifyUserId,
      "success",
      {
        backfilledCount,
        detail: `Artist metadata backfill finished for ${backfilledCount} artists. Imported-track normalization updated ${normalizationResult.updatedPlayCount} plays and removed ${normalizationResult.deletedDuplicatePlayCount} duplicates.`,
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
