import { NextRequest, NextResponse } from "next/server";
import { hasSpotifyConnection, requireSession } from "@/lib/auth";
import {
  getStoredPlaylistLibrary,
  getPlaylistDetailFromHistory,
  storePublicPlaylistAnalysisResult,
  seedStoredPublicPlaylistSnapshot,
} from "@/lib/spotify-playlists";
import { getPublicSpotifyPlaylistDetail } from "@/lib/spotify-public";
import { acquireLease, releaseLease, getSyncState } from "@/lib/public-playlist-sync-state";
import { invalidateDashboardSectionRuntimeCache } from "@/lib/dashboard-section-cache";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const session = await requireSession();

  if (hasSpotifyConnection(session)) {
    return NextResponse.json({ error: "Local only" }, { status: 400 });
  }

  const playlistId = request.nextUrl.searchParams.get("playlistId");
  if (!playlistId || !session.spotifyUserId) {
    return NextResponse.json({ error: "Missing data" }, { status: 400 });
  }

  const user = session.spotifyUserId;

  // 🚫 Skip if already running
  const leaseAcquired = await acquireLease(user, playlistId);
  if (!leaseAcquired) {
    return NextResponse.json({ ok: true, skipped: "already_running" });
  }

  try {
    // 🚫 Skip if already completed recently
    const existing = await getPlaylistDetailFromHistory(user, playlistId).catch(() => null);

    if (
      existing &&
      existing.trackCount > 0 &&
      existing.topGenres.length > 0 &&
      !existing.mood.toLowerCase().includes("pending")
    ) {
      await releaseLease(user, playlistId, true);
      return NextResponse.json({ ok: true, done: true });
    }

    const detail = await getPublicSpotifyPlaylistDetail(playlistId);

    if (detail) {
      await storePublicPlaylistAnalysisResult(user, detail);
    }

    const storedLibrary = await getStoredPlaylistLibrary(user).catch(() => []);
    await seedStoredPublicPlaylistSnapshot(user, storedLibrary, []).catch(() => {});

    invalidateDashboardSectionRuntimeCache(user);

    await releaseLease(user, playlistId, Boolean(detail));

    return NextResponse.json({
      ok: true,
      done: Boolean(detail && detail.topGenres.length > 0),
    });
  } catch (err) {
    await releaseLease(user, playlistId, false, String(err));
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}