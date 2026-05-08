import { NextResponse } from "next/server";
import { getAuthorizedSession, getSession, hasSpotifyConnection, isSessionRefreshFailure } from "@/lib/auth";
import {
  markConnectedUserArtistMetadataBackfillStatus,
  markConnectedUserDashboardEnrichmentStatus,
} from "@/lib/connected-users";

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
    await markConnectedUserDashboardEnrichmentStatus(authorizedSession.spotifyUserId, "idle", {
      detail: "",
      step: "",
      checkpoint: null,
    }).catch(() => undefined);
    await markConnectedUserArtistMetadataBackfillStatus(authorizedSession.spotifyUserId, "idle", {
      detail: "",
      step: "",
      checkpoint: null,
      backfilledCount: 0,
    }).catch(() => undefined);

    return NextResponse.json({ status: "cancelled" });
  } catch (error) {
    if (isSessionRefreshFailure(error)) {
      return NextResponse.json({ error: "Session refresh failed." }, { status: 401 });
    }

    const message = error instanceof Error ? error.message : "Could not cancel refresh progress.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
