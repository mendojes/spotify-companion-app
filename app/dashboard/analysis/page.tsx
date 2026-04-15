import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthorizedSession, getAuthorizedSession, isSessionRefreshFailure, requireSession } from "@/lib/auth";
import { getDashboardAnalysisDetail } from "@/lib/spotify-dashboard";
import { DashboardRange } from "@/lib/types";
import { formatPstDateTime } from "@/lib/time";

type AnalysisPageProps = {
  searchParams: Promise<{ section?: string; range?: string; label?: string; mood?: string; period?: string }>;
};

function normalizeRange(value?: string): DashboardRange {
  if (value === "month" || value === "all") {
    return value;
  }

  return "week";
}

export default async function DashboardAnalysisPage({ searchParams }: AnalysisPageProps) {
  const session = await requireSession();

  if (!session) {
    redirect("/login");
  }

  let authorizedSession: AuthorizedSession;

  try {
    authorizedSession = await getAuthorizedSession(session);
  } catch (error) {
    if (isSessionRefreshFailure(error)) {
      redirect("/login?error=session_refresh_failed");
    }

    throw error;
  }

  const { section, range, label, mood, period } = await searchParams;
  const selectedRange = normalizeRange(range);
  const selectedSection = section === "heatmap" ? "heatmap" : "trend";

  const detail = await getDashboardAnalysisDetail(authorizedSession.accessToken, authorizedSession.spotifyUserId, selectedRange, {
    section: selectedSection,
    label,
    mood,
    period,
  });

  return (
    <main className="relative overflow-hidden px-6 py-10 md:px-10">
      <div className="mx-auto max-w-7xl space-y-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-3xl space-y-3">
            <p className="text-sm uppercase tracking-[0.3em] text-gold/75">Analysis Drilldown</p>
            <h1 className="font-display text-5xl text-[var(--theme-title)] md:text-6xl">{detail.title}</h1>
            <p className="text-base leading-7 text-ink/80">{detail.subtitle}</p>
          </div>
          <Link href="/dashboard" className="rounded-full border border-ink/15 bg-white/5 px-4 py-2 text-sm text-ink transition hover:border-gold/25 hover:text-gold">
            Back to dashboard
          </Link>
        </div>

        <div className="glass-panel rounded-[34px] p-6 md:p-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm uppercase tracking-[0.24em] text-gold/70">{detail.section === "trend" ? "Trend bucket" : "Heatmap cell"}</p>
              <h2 className="mt-2 font-display text-3xl text-[var(--theme-title)]">{detail.entries.length} matching play{detail.entries.length === 1 ? "" : "s"}</h2>
            </div>
            <p className="text-sm text-ink/70">Range: {detail.range === "week" ? "This Week" : detail.range === "month" ? "This Month" : "All Time"}</p>
          </div>

          {detail.entries.length === 0 ? (
            <div className="mt-8 rounded-[28px] border border-dashed border-white/15 bg-white/[0.04] p-8 text-center text-ink/70">
              No matching sessions were available yet for this slice.
            </div>
          ) : (
            <div className="mt-8 space-y-4">
              {detail.entries.map((entry) => (
                <div key={`${entry.trackId}-${entry.playedAt}`} className="flex items-start gap-5 rounded-[28px] border border-white/10 bg-white/[0.03] p-5">
                  {entry.imageUrl ? (
                    <div className="relative h-28 w-28 shrink-0 overflow-hidden rounded-[28px] border border-white/10 bg-white/5">
                      <Image src={entry.imageUrl} alt={entry.title} fill sizes="112px" className="object-contain bg-white/[0.2]" />
                    </div>
                  ) : (
                    <div className="flex h-28 w-28 shrink-0 items-center justify-center rounded-[28px] border border-dashed border-white/15 text-xs uppercase tracking-[0.18em] text-ink/50">
                      Art
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-display text-3xl text-[var(--theme-title)]">{entry.title}</p>
                        <p className="mt-2 text-base text-ink/80">{entry.artist}</p>
                        <p className="mt-2 text-sm uppercase tracking-[0.2em] text-ink/55">{entry.album}</p>
                      </div>
                      <div className="text-right text-sm text-ink/70">
                        <p>{formatPstDateTime(entry.playedAt)}</p>
                        <p className="mt-2 uppercase tracking-[0.14em]">{Math.round(entry.durationMs / 60000)} min</p>
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {entry.period ? <span className="rounded-full border border-cyan/20 bg-cyan/10 px-3 py-1 text-xs uppercase tracking-[0.18em] text-cyan">{entry.period}</span> : null}
                      {entry.mood ? <span className="rounded-full border border-gold/20 bg-gold/10 px-3 py-1 text-xs uppercase tracking-[0.18em] text-gold">{entry.mood}</span> : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}





