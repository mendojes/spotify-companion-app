import { NextRequest, NextResponse } from "next/server";
import { AuthorizedSession, getAuthorizedSession, getSession, hasSpotifyConnection, isSessionRefreshFailure } from "@/lib/auth";
import { touchConnectedUser } from "@/lib/connected-users";
import { getDashboardInsightsFromHistory } from "@/lib/spotify-dashboard";
import { getSpotifyTopListsFromHistory } from "@/lib/spotify-toplists";
import { DashboardRange, TopListRange } from "@/lib/types";

function normalizeRange(range?: string): DashboardRange {
  if (range === "month" || range === "all") {
    return range;
  }

  return "week";
}

function normalizeTopRange(range?: string): TopListRange {
  if (range === "week" || range === "month" || range === "year" || range === "all" || range === "custom") {
    return range;
  }

  return "month";
}

function dashboardRangeToTopListRange(range: DashboardRange): TopListRange {
  if (range === "month") {
    return "month";
  }

  if (range === "all") {
    return "all";
  }

  return "week";
}

function normalizeDate(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return undefined;
  }

  return value;
}

export async function GET(request: NextRequest) {
  const session = await getSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasSpotifyConnection(session)) {
    return NextResponse.json({ error: "Spotify connection required." }, { status: 403 });
  }

  let authorizedSession: AuthorizedSession;

  try {
    authorizedSession = await getAuthorizedSession(session);
  } catch (error) {
    if (isSessionRefreshFailure(error)) {
      return NextResponse.json({ error: "Session refresh failed." }, { status: 401 });
    }

    throw error;
  }

  const { searchParams } = new URL(request.url);
  const selectedRange = normalizeRange(searchParams.get("range") ?? undefined);
  const selectedTopRange = normalizeTopRange(searchParams.get("topRange") ?? undefined);
  const selectedTopFrom = normalizeDate(searchParams.get("topFrom") ?? undefined);
  const selectedTopTo = normalizeDate(searchParams.get("topTo") ?? undefined);
  const selectedHeroRange = dashboardRangeToTopListRange(selectedRange);

  try {
    await touchConnectedUser(session.spotifyUserId);

    const [insights, topLists, heroTopLists] = await Promise.all([
      getDashboardInsightsFromHistory(session.spotifyUserId, selectedRange, authorizedSession.accessToken),
      getSpotifyTopListsFromHistory(session.spotifyUserId, selectedTopRange, undefined, selectedTopFrom, selectedTopTo),
      getSpotifyTopListsFromHistory(session.spotifyUserId, selectedHeroRange),
    ]);

    return NextResponse.json({ insights, topLists, heroTopLists });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load dashboard data.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
