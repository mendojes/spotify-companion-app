import { NextResponse } from "next/server";
import { getAuthorizedSession, isSessionRefreshFailure, requireSpotifySession } from "@/lib/auth";
import {
  markConnectedUserArtistMetadataBackfillStatus,
  markConnectedUserDashboardEnrichmentStatus,
  markConnectedUserRecentSync,
  touchConnectedUser,
} from "@/lib/connected-users";
import { importLastFmScrobbles, refreshLastFmImportCaches } from "@/lib/lastfm-import";

export async function POST(request: Request) {
  const session = await requireSpotifySession("/settings");
  const formData = await request.formData();
  const uploadedFile = formData.get("lastfmCsv");

  if (!(uploadedFile instanceof File)) {
    return NextResponse.json({ error: "Please choose a CSV export from Last.fm." }, { status: 400 });
  }

  if (!uploadedFile.name.toLowerCase().endsWith(".csv")) {
    return NextResponse.json({ error: "The uploaded file must be a CSV export." }, { status: 400 });
  }

  const csvText = await uploadedFile.text();
  if (!csvText.trim()) {
    return NextResponse.json({ error: "The uploaded CSV file was empty." }, { status: 400 });
  }

  let authorizedSession;

  try {
    authorizedSession = await getAuthorizedSession(session);
  } catch (error) {
    if (isSessionRefreshFailure(error)) {
      return NextResponse.json({ error: "Session refresh failed. Please sign in again." }, { status: 401 });
    }

    throw error;
  }

  try {
    await touchConnectedUser(authorizedSession.spotifyUserId).catch(() => undefined);
    await markConnectedUserDashboardEnrichmentStatus(authorizedSession.spotifyUserId, "running", {
      range: "all",
    }).catch(() => undefined);
    await markConnectedUserArtistMetadataBackfillStatus(authorizedSession.spotifyUserId, "running").catch(() => undefined);

    const result = await importLastFmScrobbles(csvText, authorizedSession.spotifyUserId);

    await markConnectedUserRecentSync(authorizedSession.spotifyUserId).catch(() => undefined);

    if (result.importedCount > 0) {
      await refreshLastFmImportCaches(authorizedSession.spotifyUserId, authorizedSession.accessToken);
    }

    await markConnectedUserDashboardEnrichmentStatus(authorizedSession.spotifyUserId, "success", {
      range: "all",
    }).catch(() => undefined);
    await markConnectedUserArtistMetadataBackfillStatus(authorizedSession.spotifyUserId, "success", {
      backfilledCount: result.importedCount,
    }).catch(() => undefined);

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not import Last.fm history.";

    await markConnectedUserDashboardEnrichmentStatus(authorizedSession.spotifyUserId, "error", {
      range: "all",
      errorMessage: message,
    }).catch(() => undefined);
    await markConnectedUserArtistMetadataBackfillStatus(authorizedSession.spotifyUserId, "error", {
      errorMessage: message,
    }).catch(() => undefined);

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
