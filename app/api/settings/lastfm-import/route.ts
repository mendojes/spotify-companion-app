import { NextResponse } from "next/server";
import { getAuthorizedSession, isSessionRefreshFailure, requireSpotifySession } from "@/lib/auth";
import {
  markConnectedUserArtistMetadataBackfillStatus,
  markConnectedUserDashboardEnrichmentStatus,
  markConnectedUserRecentSync,
  touchConnectedUser,
} from "@/lib/connected-users";
import { importLastFmScrobbles, refreshLastFmImportCaches } from "@/lib/lastfm-import";

async function getCsvTextFromRequest(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const payload = await request.json() as { csvChunk?: string };
    return payload.csvChunk?.trim() ? payload.csvChunk : "";
  }

  const formData = await request.formData();
  const uploadedFile = formData.get("lastfmCsv");

  if (!(uploadedFile instanceof File)) {
    throw new Error("Please choose a CSV export from Last.fm.");
  }

  if (!uploadedFile.name.toLowerCase().endsWith(".csv")) {
    throw new Error("The uploaded file must be a CSV export.");
  }

  return uploadedFile.text();
}

export async function POST(request: Request) {
  const session = await requireSpotifySession("/settings");

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
    const contentType = request.headers.get("content-type") ?? "";
    const isChunkedJsonRequest = contentType.includes("application/json");
    const requestPayload = isChunkedJsonRequest
      ? await request.clone().json() as { finalize?: boolean; csvChunk?: string }
      : null;
    const csvText = isChunkedJsonRequest
      ? requestPayload?.csvChunk ?? ""
      : await getCsvTextFromRequest(request);

    if (!csvText.trim()) {
      return NextResponse.json({ error: "The uploaded CSV file was empty." }, { status: 400 });
    }

    await touchConnectedUser(authorizedSession.spotifyUserId).catch(() => undefined);
    await markConnectedUserDashboardEnrichmentStatus(authorizedSession.spotifyUserId, "running", {
      range: "all",
    }).catch(() => undefined);
    await markConnectedUserArtistMetadataBackfillStatus(authorizedSession.spotifyUserId, "running").catch(() => undefined);

    const result = await importLastFmScrobbles(csvText, authorizedSession.spotifyUserId);

    await markConnectedUserRecentSync(authorizedSession.spotifyUserId).catch(() => undefined);

    const shouldFinalize = !isChunkedJsonRequest || Boolean(requestPayload?.finalize);

    if (shouldFinalize) {
      await refreshLastFmImportCaches(authorizedSession.spotifyUserId, authorizedSession.accessToken);
      await markConnectedUserDashboardEnrichmentStatus(authorizedSession.spotifyUserId, "success", {
        range: "all",
      }).catch(() => undefined);
      await markConnectedUserArtistMetadataBackfillStatus(authorizedSession.spotifyUserId, "success", {
        backfilledCount: result.importedCount,
      }).catch(() => undefined);
    }

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
