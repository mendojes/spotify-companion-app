import { NextRequest, NextResponse } from "next/server";
import { hasSpotifyConnection, requireSession } from "@/lib/auth";
import {
  getPlaylistPageDataFromHistory,
  seedStoredPublicPlaylistSnapshot,
} from "@/lib/spotify-playlists";
import {
  getPublicSpotifyPlaylistDetail,
  getPublicSpotifyProfileInsights,
} from "@/lib/spotify-public";
import { PlaylistInsight } from "@/lib/types";

export const dynamic = "force-dynamic";

function detailToPlaylistInsight(
  detail: Awaited<ReturnType<typeof getPublicSpotifyPlaylistDetail>>,
): PlaylistInsight | null {
  if (!detail) return null;

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
        ? detail.topGenres.slice(0, 3).map((g) => g.genre).join(", ")
        : detail.diversity,
    diversity: detail.diversity,
    listeningCadence: detail.listeningCadence,
    overlap: detail.overlap,
  };
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

  console.log(`[public-detail-sync] START user=${session.spotifyUserId} playlist=${playlistId}`);

  try {
    const [detail, publicInsights, storedPageData] = await Promise.all([
      getPublicSpotifyPlaylistDetail(playlistId).catch((err) => {
        console.error("[public-detail-sync] detail fetch failed", err);
        return null;
      }),
      getPublicSpotifyProfileInsights(session.spotifyUserId, session.spotifyProfileUrl).catch(() => null),
      getPlaylistPageDataFromHistory(session.spotifyUserId, "last_listened_desc").catch(() => null),
    ]);

    if (!detail) {
      console.warn(`[public-detail-sync] NO DETAIL playlist=${playlistId}`);
      return NextResponse.json({ error: "No detail returned" }, { status: 404 });
    }

    const nextInsight = detailToPlaylistInsight(detail);

    if (!nextInsight) {
      console.warn(`[public-detail-sync] FAILED TO BUILD INSIGHT playlist=${playlistId}`);
      return NextResponse.json({ error: "Insight conversion failed" }, { status: 500 });
    }

    const publicLibrary = publicInsights?.publicPlaylists ?? [];
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
      publicLibrary,
      [...mergedInsightsById.values()],
    ).catch((err) => {
      console.error("[public-detail-sync] snapshot write failed", err);
    });

    console.log(
      `[public-detail-sync] DONE playlist=${playlistId} durationMs=${Date.now() - startedAt}`,
    );

    return NextResponse.json(
      { ok: true, playlistId },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[public-detail-sync] ERROR", error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}