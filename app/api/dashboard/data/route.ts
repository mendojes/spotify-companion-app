import { NextRequest, NextResponse } from "next/server";
import { getSession, hasSpotifyConnection } from "@/lib/auth";
import { getDashboardInsightsFromSnapshots } from "@/lib/spotify-dashboard";
import { getSpotifyTopListsFromHistoryData, getTopListHistoryData } from "@/lib/spotify-toplists";
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

  const { searchParams } = new URL(request.url);
  const selectedRange = normalizeRange(searchParams.get("range") ?? undefined);
  const selectedTopRange = normalizeTopRange(searchParams.get("topRange") ?? undefined);
  const selectedTopFrom = normalizeDate(searchParams.get("topFrom") ?? undefined);
  const selectedTopTo = normalizeDate(searchParams.get("topTo") ?? undefined);
  const selectedHeroRange = dashboardRangeToTopListRange(selectedRange);

  try {
    const history = await getTopListHistoryData(session.spotifyUserId);
    const insights = history.snapshots.length > 0
      ? await getDashboardInsightsFromSnapshots(history.snapshots, selectedRange, undefined, session.spotifyUserId)
      : null;
    const [topLists, heroTopLists] = await Promise.all([
      getSpotifyTopListsFromHistoryData(history, selectedTopRange, undefined, selectedTopFrom, selectedTopTo),
      getSpotifyTopListsFromHistoryData(history, selectedHeroRange),
    ]);

    return NextResponse.json({ insights, topLists, heroTopLists });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load dashboard data.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
