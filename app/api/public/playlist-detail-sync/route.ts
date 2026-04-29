import { NextRequest, NextResponse } from "next/server";
import { hasSpotifyConnection, requireSession } from "@/lib/auth";
import { getPublicSpotifyPlaylistDetail, getPublicSpotifyProfileInsights } from "@/lib/spotify-public";
import { getPlaylistPageDataFromHistory, seedStoredPublicPlaylistSnapshot } from "@/lib/spotify-playlists";
import { PlaylistInsight } from "@/lib/types";

export const dynamic = "force-dynamic";

function detailToPlaylistInsight(detail: Awaited<ReturnType<typeof getPublicSpotifyPlaylistDetail>>): PlaylistInsight | null {
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
        ? detail.topGenres.slice(0, 3).join(", ")
        : detail.diversity,
    diversity: detail.diversity,
    listeningCadence: detail.listeningCadence,
    overlap: detail.overlap,
  };
}

export async function POST(request: NextRequest) {
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

  try {
    const [detail, publicInsights, storedPageData] = await Promise.all([
      getPublicSpotifyPlaylistDetail(playlistId),
      getPublicSpotifyProfileInsights(session.spotifyUserId, session.spotifyProfileUrl).catch(() => null),
      getPlaylistPageDataFromHistory(session.spotifyUserId, "last_listened_desc").catch(() => null),
    ]);

    if (!detail) {
      return NextResponse.json(
        { error: "Public playlist detail could not be loaded." },
        { status: 404 },
      );
    }

    const publicLibrary = publicInsights?.publicPlaylists ?? [];
    const existingInsights = storedPageData?.playlists ?? [];
    const nextInsight = detailToPlaylistInsight(detail);

    const mergedInsightsById = new Map<string, PlaylistInsight>();

    for (const insight of existingInsights) {
      if (insight.id) {
        mergedInsightsById.set(insight.id, insight);
      }
    }

    if (nextInsight?.id) {
      mergedInsightsById.set(nextInsight.id, nextInsight);
    }

    await seedStoredPublicPlaylistSnapshot(
      session.spotifyUserId,
      publicLibrary,
      [...mergedInsightsById.values()],
    ).catch(() => undefined);

    return NextResponse.json(
      { ok: true, playlistId },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to refresh public playlist detail.",
      },
      { status: 500 },
    );
  }
}