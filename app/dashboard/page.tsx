import Link from "next/link";
import { redirect } from "next/navigation";
import { DashboardView } from "@/components/dashboard-view";
import { NowPlayingPanel } from "@/components/now-playing-panel";
import { requireSession } from "@/lib/auth";
import { touchConnectedUser } from "@/lib/connected-users";
import { getDashboardInsights } from "@/lib/spotify-dashboard";
import { getSpotifyTopLists } from "@/lib/spotify-toplists";
import { DashboardRange, SpotifyTimeRange } from "@/lib/types";

type DashboardPageProps = {
  searchParams: Promise<{ range?: string; topRange?: string; refreshed?: string; refresh_error?: string }>;
};

function normalizeRange(range?: string): DashboardRange {
  if (range === "month" || range === "all") {
    return range;
  }

  return "week";
}

function normalizeTopRange(range?: string): SpotifyTimeRange {
  if (range === "short_term" || range === "long_term") {
    return range;
  }

  return "medium_term";
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const session = await requireSession();

  if (!session) {
    redirect("/login");
  }

  await touchConnectedUser(session.spotifyUserId);

  const { range, topRange, refreshed, refresh_error: refreshErrorFlag } = await searchParams;
  const selectedRange = normalizeRange(range);
  const selectedTopRange = normalizeTopRange(topRange);

  let insights;
  let topLists;
  let dashboardError: string | null = null;
  let topListsError: string | null = null;

  try {
    insights = await getDashboardInsights(session.accessToken, session.spotifyUserId, selectedRange);
  } catch {
    dashboardError = "Spotify data could not be loaded right now, so the dashboard is showing preview fallback sections.";
  }

  try {
    topLists = await getSpotifyTopLists(session.accessToken, selectedTopRange);
  } catch {
    topListsError = "Top artist, track, and album lists could not be loaded right now, so preview rankings are showing instead.";
  }

  return (
    <main className="relative overflow-hidden">
      <nav className="sticky top-0 z-40 border-b border-white/10 bg-night/70 px-6 py-4 backdrop-blur-xl md:px-10">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <div>
            <p className="font-display text-xl text-white">SoundScope</p>
            <p className="text-xs uppercase tracking-[0.24em] text-ink/50">Live Spotify session</p>
          </div>
          <div className="flex items-center gap-3">
            <a
              href={`/api/dashboard/refresh?range=${selectedRange}`}
              className="rounded-full border border-cyan/20 bg-cyan/10 px-4 py-2 text-sm text-cyan"
            >
              Refresh snapshot
            </a>
            <div className="hidden text-right md:block">
              <p className="text-sm text-white">{session.displayName}</p>
              <p className="text-xs text-ink/55">{session.email ?? "Spotify connected"}</p>
            </div>
            <a
              href="/api/auth/logout"
              className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm text-white"
            >
              Log out
            </a>
          </div>
        </div>
      </nav>
      {refreshed ? (
        <div className="px-6 pt-6 md:px-10">
          <div className="mx-auto max-w-7xl rounded-[24px] border border-cyan/30 bg-cyan/10 px-5 py-4 text-sm text-ink/85">
            Spotify snapshot refreshed successfully.
          </div>
        </div>
      ) : null}
      {refreshErrorFlag ? (
        <div className="px-6 pt-6 md:px-10">
          <div className="mx-auto max-w-7xl rounded-[24px] border border-coral/30 bg-coral/10 px-5 py-4 text-sm text-ink/85">
            Snapshot refresh failed. The dashboard is still using your previous cached data when available.
          </div>
        </div>
      ) : null}
      {dashboardError ? (
        <div className="px-6 pt-6 md:px-10">
          <div className="mx-auto max-w-7xl rounded-[24px] border border-gold/30 bg-gold/10 px-5 py-4 text-sm text-ink/85">
            {dashboardError}
          </div>
        </div>
      ) : null}
      {topListsError ? (
        <div className="px-6 pt-6 md:px-10">
          <div className="mx-auto max-w-7xl rounded-[24px] border border-gold/30 bg-gold/10 px-5 py-4 text-sm text-ink/85">
            {topListsError}
          </div>
        </div>
      ) : null}
      <NowPlayingPanel />
      <DashboardView
        mode="authenticated"
        insights={insights}
        selectedRange={selectedRange}
        topLists={topLists}
        selectedTopRange={selectedTopRange}
      />
      <div className="px-6 pb-12 md:px-10">
        <div className="mx-auto max-w-7xl">
          <Link href="/" className="text-sm text-cyan/80 hover:text-cyan">
            Back to home
          </Link>
        </div>
      </div>
    </main>
  );
}