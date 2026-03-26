import Link from "next/link";
import { Disc3, LogOut, RefreshCcw, Settings2, Sparkles, Users } from "lucide-react";
import { redirect } from "next/navigation";
import { DashboardView } from "@/components/dashboard-view";
import { NowPlayingPanel } from "@/components/now-playing-panel";
import { SpotifyComplianceNote } from "@/components/spotify-compliance-note";
import { ThemeToggle } from "@/components/theme-toggle";
import { requireSession } from "@/lib/auth";
import { getDashboardInsights, getDashboardInsightsFromHistory } from "@/lib/spotify-dashboard";
import { getSpotifyTopLists, getSpotifyTopListsFromHistory } from "@/lib/spotify-toplists";
import { DashboardRange, TopListRange } from "@/lib/types";

type DashboardPageProps = {
  searchParams: Promise<{ range?: string; topRange?: string; topFrom?: string; topTo?: string; refreshed?: string; refresh_error?: string }>;
};

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

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown Spotify error";
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

  const activeSession = session;

  const { range, topRange, topFrom, topTo, refreshed, refresh_error: refreshErrorFlag } = await searchParams;
  const selectedRange = normalizeRange(range);
  const selectedTopRange = normalizeTopRange(topRange);
  const selectedTopFrom = normalizeDate(topFrom);
  const selectedTopTo = normalizeDate(topTo);
  const selectedHeroRange = dashboardRangeToTopListRange(selectedRange);

  let insights;
  let topLists;
  let heroTopLists;
  let dashboardError: string | null = null;
  let topListsError: string | null = null;

  try {
    [insights, topLists, heroTopLists] = await Promise.all([
      getDashboardInsightsFromHistory(activeSession.spotifyUserId, selectedRange),
      getSpotifyTopListsFromHistory(activeSession.spotifyUserId, selectedTopRange, undefined, selectedTopFrom, selectedTopTo),
      getSpotifyTopListsFromHistory(activeSession.spotifyUserId, selectedHeroRange),
    ]);
  } catch (error) {
    dashboardError = `Cached dashboard data could not be loaded, so SoundScope fell back to live Spotify data for this page load. (${getErrorMessage(error)})`;

    try {
      [insights, topLists, heroTopLists] = await Promise.all([
        getDashboardInsights(activeSession.accessToken, activeSession.spotifyUserId, selectedRange),
        getSpotifyTopLists(activeSession.accessToken, activeSession.spotifyUserId, selectedTopRange, undefined, selectedTopFrom, selectedTopTo),
        getSpotifyTopLists(activeSession.accessToken, activeSession.spotifyUserId, selectedHeroRange),
      ]);
    } catch (liveError) {
      dashboardError = `Cached dashboard data could not be loaded right now, and the live Spotify fallback also failed, so the dashboard is showing preview fallback sections. (${getErrorMessage(liveError)})`;
    }
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
            <Link href="/social" className="pixel-chip inline-flex items-center gap-2 text-[var(--theme-text)] transition hover:text-[#2d0d46]">
              <Users className="h-4 w-4" /> Social
            </Link>
            <Link href="/settings" className="pixel-chip inline-flex items-center gap-2 text-[var(--theme-text)] transition hover:text-[#2d0d46]">
              <Settings2 className="h-4 w-4" /> Settings
            </Link>
            <Link href="/privacy" className="pixel-chip inline-flex items-center gap-2 text-[var(--theme-text)] transition hover:text-[#2d0d46]">
              <Sparkles className="h-4 w-4" /> Privacy
            </Link>
            <a href={`/api/dashboard/refresh?range=${selectedRange}`} className="pixel-chip inline-flex items-center gap-2 text-[var(--theme-text)] transition hover:text-[#2d0d46]">
              <RefreshCcw className="h-4 w-4" /> Refresh snapshot
            </a>
            <div className="hidden desktop-card px-4 py-2 text-right md:block">
              <p className="text-sm text-[var(--theme-title)]">{activeSession.displayName}</p>
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
        insights={insights ?? undefined}
        selectedRange={selectedRange}
        topLists={topLists ?? undefined}
        heroTopLists={heroTopLists ?? undefined}
        selectedTopRange={selectedTopRange}
        selectedTopFrom={selectedTopFrom}
        selectedTopTo={selectedTopTo}
        sidebar={<NowPlayingPanel />}
        rediscoveryPagePath="/dashboard/rediscovery"
      />

      <div className="px-6 pb-12 md:px-10">
        <div className="mx-auto max-w-7xl space-y-4">
          <SpotifyComplianceNote />
          <Link href="/" className="pixel-chip inline-flex items-center gap-2 text-[var(--theme-text)] transition hover:text-[#2d0d46]">
            <Disc3 className="h-4 w-4" /> Back to home
          </Link>
        </div>
      </div>
    </main>
  );
}
