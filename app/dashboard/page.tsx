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

function mapDashboardRangeToTopRange(range: DashboardRange): SpotifyTimeRange {
  if (range === "week") {
    return "short_term";
  }

  if (range === "all") {
    return "long_term";
  }

  return "medium_term";
}

function normalizeTopRange(range: string | undefined, selectedRange: DashboardRange): SpotifyTimeRange {
  if (range === "short_term" || range === "long_term" || range === "medium_term") {
    return range;
  }

  return mapDashboardRangeToTopRange(selectedRange);
}

function Notice({ tone, children }: { tone: "cyan" | "coral" | "gold"; children: React.ReactNode }) {
  const styles = {
    cyan: "border-cyan/35 bg-cyan/10 text-ink/90",
    coral: "border-coral/35 bg-coral/10 text-ink/90",
    gold: "border-gold/35 bg-gold/10 text-ink/90",
  };

  return (
    <div className={`mx-auto max-w-7xl rounded-[24px] border px-5 py-4 text-sm shadow-glow ${styles[tone]}`}>
      {children}
    </div>
  );
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const session = await requireSession();

  if (!session) {
    redirect("/login");
  }

  await touchConnectedUser(session.spotifyUserId);

  const { range, topRange, refreshed, refresh_error: refreshErrorFlag } = await searchParams;
  const selectedRange = normalizeRange(range);
  const selectedTopRange = normalizeTopRange(topRange, selectedRange);

  const heroTopRange = mapDashboardRangeToTopRange(selectedRange);

  let insights;
  let topLists;
  let heroTopLists;
  let dashboardError: string | null = null;
  let topListsError: string | null = null;

  try {
    insights = await getDashboardInsights(session.accessToken, session.spotifyUserId, selectedRange);
  } catch {
    dashboardError = "Spotify data could not be loaded right now, so the dashboard is showing preview fallback sections.";
  }

  try {
    [topLists, heroTopLists] = await Promise.all([
      getSpotifyTopLists(session.accessToken, selectedTopRange),
      getSpotifyTopLists(session.accessToken, heroTopRange),
    ]);
  } catch {
    topListsError = "Top artist, track, and album lists could not be loaded right now, so preview rankings are showing instead.";
  }

  return (
    <main className="city-pop-shell relative overflow-hidden pb-10">
      <nav className="sticky top-0 z-40 border-b border-white/10 bg-night/65 px-6 py-4 backdrop-blur-2xl md:px-10">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="neon-outline flex h-14 w-14 items-center justify-center rounded-[20px] bg-[linear-gradient(135deg,rgba(255,214,243,0.95),rgba(255,94,201,0.95)_32%,rgba(110,130,255,0.95)_68%,rgba(122,247,255,0.95))] font-display text-lg font-bold uppercase tracking-[0.18em] text-[#170718]">
              SS
            </div>
            <div>
              <p className="font-display text-2xl uppercase tracking-[0.14em] text-white md:text-3xl">SoundScope</p>
              <p className="font-mono text-lg uppercase tracking-[0.28em] text-ink/55">live listening archive</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <a
              href={`/api/dashboard/refresh?range=${selectedRange}`}
              className="neon-outline rounded-full bg-[linear-gradient(135deg,rgba(255,214,243,0.95),rgba(255,94,201,0.95)_32%,rgba(110,130,255,0.95)_68%,rgba(122,247,255,0.95))] px-4 py-2 font-mono text-lg uppercase tracking-[0.14em] text-[#170718]"
            >
              Refresh snapshot
            </a>
            <div className="hidden rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-right md:block">
              <p className="text-sm text-white">{session.displayName}</p>
              <p className="font-mono text-lg uppercase tracking-[0.14em] text-ink/50">{session.email ?? "Spotify connected"}</p>
            </div>
            <a
              href="/api/auth/logout"
              className="chrome-line rounded-full bg-white/[0.04] px-4 py-2 font-mono text-lg uppercase tracking-[0.14em] text-ink"
            >
              Log out
            </a>
          </div>
        </div>
      </nav>
      <div className="space-y-4 px-6 pt-6 md:px-10">
        {refreshed ? <Notice tone="cyan">Spotify snapshot refreshed successfully.</Notice> : null}
        {refreshErrorFlag ? (
          <Notice tone="coral">Snapshot refresh failed. The dashboard is still using your previous cached data when available.</Notice>
        ) : null}
        {dashboardError ? <Notice tone="gold">{dashboardError}</Notice> : null}
        {topListsError ? <Notice tone="gold">{topListsError}</Notice> : null}
      </div>
      <DashboardView
        mode="authenticated"
        insights={insights}
        selectedRange={selectedRange}
        topLists={topLists}
        heroTopLists={heroTopLists}
        selectedTopRange={selectedTopRange}
        sidebar={<NowPlayingPanel />}
      />
      <div className="px-6 pb-12 md:px-10">
        <div className="mx-auto max-w-7xl">
          <Link href="/" className="font-mono text-lg uppercase tracking-[0.14em] text-gold/85 transition hover:text-gold">
            Back to home
          </Link>
        </div>
      </div>
    </main>
  );
}
