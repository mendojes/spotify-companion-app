import { NextRequest, NextResponse } from "next/server";
import { hasSpotifyConnection, requireSession } from "@/lib/auth";
import {
  getPlaylistDetailFromHistory,
  getPlaylistPageDataFromHistory,
  getStoredPlaylistLibrary,
  seedStoredPublicPlaylistSnapshot,
} from "@/lib/spotify-playlists";
import { getPublicSpotifyPlaylistDetail } from "@/lib/spotify-public";
import { PlaylistInsight } from "@/lib/types";

export const dynamic = "force-dynamic";

function detailToPlaylistInsight(
  detail: Awaited<ReturnType<typeof getPublicSpotifyPlaylistDetail>>,
): PlaylistInsight | null {
  if (!detail) {
    return null;
  }

  return {
    id: detail.id,
    name: detail.name,
    imageUrl: detail.imageUrl,
    trackCount: detail.trackCount,
    createdAt: detail.createdAt,
    lastListenedAt: detail.lastListenedAt,
    mood: detail.mood,
    topGenresSummary:
      detail.topGenres.length > 0
        ? detail.topGenres.slice(0, 3).map((genre) => genre.genre).join(", ")
        : detail.diversity,
    diversity: detail.diversity,
    listeningCadence: detail.listeningCadence,
    overlap: detail.overlap,
  };
}

function buildPendingInsightFromStoredLibrary(args: {
  playlistId: string;
  storedLibrary: Awaited<ReturnType<typeof getStoredPlaylistLibrary>>;
}): PlaylistInsight | null {
  const playlist = args.storedLibrary.find((item) => item.id === args.playlistId);

  if (!playlist) {
    return null;
  }

  return {
    id: playlist.id,
    name: playlist.name,
    imageUrl: playlist.images?.[0]?.url,
    trackCount: playlist.tracks?.total ?? 0,
    createdAt: undefined,
    lastListenedAt: undefined,
    mood: "Analysis pending",
    topGenresSummary: "Background refresh will retry after rate limit",
    diversity: "Pending genre analysis",
    listeningCadence: "Pending cadence analysis",
    overlap: "Pending overlap analysis",
  };
}

async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<T>((resolve) => {
    timeoutId = setTimeout(() => resolve(fallback), ms);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const session = await requireSession();

  if (hasSpotifyConnection(session)) {
    return NextResponse.json(
      { error: "Public playlist detail sync is only used for local accounts." },
      { status: 400 },
    );
  }

  if (!session.spotifyUserId) {
    return NextResponse.json(
      { error: "Missing Spotify profile for local account." },
      { status: 400 },
    );
  }

  const playlistId = request.nextUrl.searchParams.get("playlistId");

  if (!playlistId) {
    return NextResponse.json({ error: "Missing playlistId." }, { status: 400 });
  }

  console.log(
    `[public-detail-sync] START user=${session.spotifyUserId} playlist=${playlistId}`,
  );

  try {
    const [storedLibrary, storedPageData, storedDetail] = await Promise.all([
      getStoredPlaylistLibrary(session.spotifyUserId).catch(() => []),
      getPlaylistPageDataFromHistory(
        session.spotifyUserId,
        "last_listened_desc",
      ).catch(() => null),
      getPlaylistDetailFromHistory(session.spotifyUserId, playlistId).catch(() => null),
    ]);

    if (
      storedDetail &&
      storedDetail.trackCount > 0 &&
      storedDetail.uniqueArtistCount > 0 &&
      !storedDetail.mood.toLowerCase().includes("pending")
    ) {
      console.log(
        `[public-detail-sync] CACHE-HIT user=${session.spotifyUserId} playlist=${playlistId} durationMs=${Date.now() - startedAt}`,
      );

      return NextResponse.json(
        { ok: true, cached: true, playlistId },
        {
          headers: {
            "Cache-Control": "no-store",
          },
        },
      );
    }

    const detail = await withTimeout(
      getPublicSpotifyPlaylistDetail(playlistId).catch((error) => {
        console.error(
          `[public-detail-sync] detail fetch failed playlist=${playlistId}`,
          error,
        );
        return null;
      }),
      12_000,
      null,
    );

    const nextInsight =
      detailToPlaylistInsight(detail) ??
      buildPendingInsightFromStoredLibrary({
        playlistId,
        storedLibrary,
      });

    if (!nextInsight) {
      console.warn(
        `[public-detail-sync] NO DETAIL OR STORED LIBRARY user=${session.spotifyUserId} playlist=${playlistId} durationMs=${Date.now() - startedAt}`,
      );

      return NextResponse.json(
        { ok: false, playlistId, reason: "detail_unavailable" },
        {
          status: 202,
          headers: {
            "Cache-Control": "no-store",
          },
        },
      );
    }

    const existingInsights = storedPageData?.playlists ?? [];
    const mergedInsightsById = new Map<string, PlaylistInsight>();

    for (const insight of existingInsights) {
      if (insight.id) {
        mergedInsightsById.set(insight.id, insight);
      }
    }

    mergedInsightsById.set(nextInsight.id!, nextInsight);

    await seedStoredPublicPlaylistSnapshot(
      session.spotifyUserId,
      storedLibrary,
      [...mergedInsightsById.values()],
    ).catch((error) => {
      console.error(
        `[public-detail-sync] SNAPSHOT WRITE FAILED user=${session.spotifyUserId} playlist=${playlistId}`,
        error,
      );
    });

    console.log(
      `[public-detail-sync] ${detail ? "DONE" : "PARTIAL"} user=${session.spotifyUserId} playlist=${playlistId} durationMs=${Date.now() - startedAt}`,
    );

    return NextResponse.json(
      {
        ok: true,
        partial: !detail,
        playlistId,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    console.error(
      `[public-detail-sync] ERROR user=${session.spotifyUserId} playlist=${playlistId}`,
      error,
    );

    return NextResponse.json(
      {
        ok: false,
        playlistId,
        error:
          error instanceof Error
            ? error.message
            : "Failed to refresh public playlist detail.",
      },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }
}