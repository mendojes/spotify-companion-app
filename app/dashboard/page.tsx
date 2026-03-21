import Link from "next/link";
import { Disc3, LogOut, RefreshCcw, Sparkles } from "lucide-react";
import { redirect } from "next/navigation";
import { DashboardView } from "@/components/dashboard-view";
import { NowPlayingPanel } from "@/components/now-playing-panel";
import { ThemeToggle } from "@/components/theme-toggle";
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
    cyan: "bg-[rgba(229,255,255,0.78)] text-[#3a1a58]",
    coral: "bg-[rgba(255,236,245,0.82)] text-[#3a1a58]",
    gold: "bg-[rgba(255,247,224,0.86)] text-[#3a1a58]",
  };

  return <div className={`mx-auto max-w-7xl rounded-[24px] border-[3px] border-[rgba(44,12,70,0.9)] px-5 py-4 text-sm shadow-glow ${styles[tone]}`}>{children}</div>;
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
      <nav className="sticky top-0 z-40 border-b-[3px] border-[rgba(44,12,70,0.9)] bg-[rgba(255,240,253,0.74)] px-6 py-4 backdrop-blur-2xl md:px-10">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="neon-outline flex h-14 w-14 items-center justify-center rounded-[20px] border-[3px] border-[rgba(44,12,70,0.9)] bg-[linear-gradient(135deg,#fff8ff,#ff97e8_44%,#87f2ff)] font-display text-lg font-bold uppercase tracking-[0.18em] text-[#2d0d46]">
              SS
            </div>
            <div>
              <p className="font-display text-2xl uppercase tracking-[0.14em] text-[var(--theme-title)] md:text-3xl">SoundScope</p>
              <p className="font-mono text-lg uppercase tracking-[0.24em] text-[var(--theme-muted)]">pastel listening desktop</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <ThemeToggle />
            <a href={`/api/dashboard/refresh?range=${selectedRange}`} className="pixel-chip inline-flex items-center gap-2 text-[var(--theme-text)] transition hover:text-[#2d0d46]">
              <RefreshCcw className="h-4 w-4" /> Refresh snapshot
            </a>
            <div className="hidden desktop-card px-4 py-2 text-right md:block">
              <p className="text-sm text-[var(--theme-title)]">{session.displayName}</p>
              <p className="font-mono text-lg uppercase tracking-[0.14em] text-[var(--theme-muted)]">{session.email ?? "Spotify connected"}</p>
            </div>
            <a href="/api/auth/logout" className="pixel-chip inline-flex items-center gap-2 text-[var(--theme-text)] transition hover:text-[#2d0d46]">
              <LogOut className="h-4 w-4" /> Log out
            </a>
          </div>
        </div>
      </nav>

      <div className="px-6 pt-5 md:px-10">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 text-[var(--theme-text)]">
          <div className="sticker-badge inline-flex items-center gap-2 px-4 py-2 font-mono text-sm uppercase tracking-[0.16em]">
            <Disc3 className="h-4 w-4 text-[var(--theme-accent)]" /> live archive
          </div>
          <div className="sticker-badge inline-flex items-center gap-2 px-4 py-2 font-mono text-sm uppercase tracking-[0.16em]">
            <Sparkles className="h-4 w-4 text-[var(--theme-highlight)]" /> image-first mode
          </div>
        </div>
      </div>

      <div className="space-y-4 px-6 pt-6 md:px-10">
        {refreshed ? <Notice tone="cyan">Spotify snapshot refreshed successfully.</Notice> : null}
        {refreshErrorFlag ? <Notice tone="coral">Snapshot refresh failed. The dashboard is still using your previous cached data when available.</Notice> : null}
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
          <Link href="/" className="pixel-chip inline-flex items-center gap-2 text-[var(--theme-text)] transition hover:text-[#2d0d46]">
            <Disc3 className="h-4 w-4" /> Back to home
          </Link>
        </div>
      </div>
    </main>
  );
}
