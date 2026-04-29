import { NextRequest, NextResponse } from "next/server";
import { hasSpotifyConnection, requireSession } from "@/lib/auth";
import {
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
    const [storedLibrary, storedPageData] = await Promise.all([
      getStoredPlaylistLibrary(session.spotifyUserId).catch(() => []),
      getPlaylistPageDataFromHistory(
        session.spotifyUserId,
        "last_listened_desc",
      ).catch(() => null),
    ]);

    const detail = await withTimeout(
      getPublicSpotifyPlaylistDetail(playlistId).catch((error) => {
        console.error(
          `[public-detail-sync] detail fetch failed playlist=${playlistId}`,
          error,
        );
        return null;
      }),
      12000,
      null,
    );

    if (!detail) {
      console.warn(
        `[public-detail-sync] NO DETAIL user=${session.spotifyUserId} playlist=${playlistId} durationMs=${Date.now() - startedAt}`,
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

    const nextInsight = detailToPlaylistInsight(detail);

    if (!nextInsight) {
      console.warn(
        `[public-detail-sync] INSIGHT BUILD FAILED user=${session.spotifyUserId} playlist=${playlistId} durationMs=${Date.now() - startedAt}`,
      );

      return NextResponse.json(
        { ok: false, playlistId, reason: "insight_conversion_failed" },
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
      `[public-detail-sync] DONE user=${session.spotifyUserId} playlist=${playlistId} durationMs=${Date.now() - startedAt}`,
    );

    return NextResponse.json(
      { ok: true, playlistId },
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