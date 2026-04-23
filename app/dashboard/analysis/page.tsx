import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSpotifySession } from "@/lib/auth";
import { getDashboardAnalysisDetailFromHistory } from "@/lib/spotify-dashboard";
import { DashboardRange } from "@/lib/types";
import { formatPstDateTime } from "@/lib/time";

type AnalysisPageProps = {
  searchParams: Promise<{ section?: string; range?: string; label?: string; mood?: string; period?: string; day?: string; from?: string; to?: string }>;
};

const ranges: Array<{ key: DashboardRange; label: string }> = [
  { key: "week", label: "1 Week" },
  { key: "month", label: "1 Month" },
  { key: "all", label: "All Time" },
];

function normalizeRange(value?: string): DashboardRange {
  if (value === "month" || value === "all") {
    return value;
  }

  return "week";
}

function normalizeDate(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return undefined;
  }

  return value;
}

function formatDateKey(value?: string) {
  if (!value) {
    return "Unavailable";
  }

  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

function buildAnalysisHref(params: {
  section: "trend" | "heatmap";
  range: DashboardRange;
  label?: string;
  mood?: string;
  period?: string;
  day?: string;
  from?: string;
  to?: string;
}) {
  const search = new URLSearchParams({
    section: params.section,
    range: params.range,
  });

  if (params.label) {
    search.set("label", params.label);
  }

  if (params.mood) {
    search.set("mood", params.mood);
  }

  if (params.period) {
    search.set("period", params.period);
  }

  if (params.day) {
    search.set("day", params.day);
  }

  if (params.from) {
    search.set("from", params.from);
  }

  if (params.to) {
    search.set("to", params.to);
  }

  return `/dashboard/analysis?${search.toString()}`;
}

export default async function DashboardAnalysisPage({ searchParams }: AnalysisPageProps) {
  const session = await requireSpotifySession("/dashboard/analysis");

  const { section, range, label, mood, period, day, from, to } = await searchParams;
  const selectedRange = normalizeRange(range);
  const selectedSection = section === "heatmap" ? "heatmap" : "trend";
  const selectedDay = normalizeDate(day);
  const selectedFrom = normalizeDate(from);
  const selectedTo = normalizeDate(to);
  const topListsQuery = selectedDay
    ? `&from=${selectedDay}&to=${selectedDay}`
    : selectedFrom || selectedTo
      ? `${selectedFrom ? `&from=${selectedFrom}` : ""}${selectedTo ? `&to=${selectedTo}` : ""}`
      : "";

  const detail = await getDashboardAnalysisDetailFromHistory(session.spotifyUserId, selectedRange, {
    section: selectedSection,
    label,
    mood,
    period,
    day: selectedDay,
    from: selectedFrom,
    to: selectedTo,
  });

  if (!detail) {
    redirect(`/dashboard?range=${selectedRange}`);
  }

  return (
    <main className="relative overflow-hidden px-6 py-10 md:px-10">
      <div className="mx-auto max-w-7xl space-y-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-3xl space-y-3">
            <p className="text-sm uppercase tracking-[0.3em] text-gold/75">Analysis Drilldown</p>
            <h1 className="font-display text-5xl text-[var(--theme-title)] md:text-6xl">{detail.title}</h1>
            <p className="text-base leading-7 text-[var(--theme-body)]">{detail.subtitle}</p>
          </div>
          <Link href={`/dashboard?range=${selectedRange}`} className="rounded-full border border-[rgba(57,18,98,0.16)] bg-white/[0.18] px-4 py-2 text-sm text-[var(--theme-text)] transition hover:border-gold/25 hover:text-gold">
            Back to dashboard
          </Link>
        </div>

        <div className="flex flex-wrap gap-3">
          {ranges.map((option) => {
            const active = option.key === selectedRange;
            return (
              <Link
                key={option.key}
                href={buildAnalysisHref({ section: selectedSection, range: option.key, label, mood, period, day: selectedDay, from: selectedFrom, to: selectedTo })}
                className={`rounded-full px-4 py-2 text-sm transition ${active ? "bg-gold text-[#24160f]" : "border border-[rgba(57,18,98,0.16)] bg-white/[0.18] text-[var(--theme-text)]"}`}
              >
                {option.label}
              </Link>
            );
          })}
        </div>

        <form action="/dashboard/analysis" method="get" className="glass-panel flex flex-wrap items-end gap-3 rounded-[30px] p-4">
          <input type="hidden" name="section" value={selectedSection} />
          <input type="hidden" name="range" value={selectedRange} />
          {label ? <input type="hidden" name="label" value={label} /> : null}
          {mood ? <input type="hidden" name="mood" value={mood} /> : null}
          {period ? <input type="hidden" name="period" value={period} /> : null}
          <label className="space-y-2 text-sm text-[var(--theme-body)]">
            <span className="block uppercase tracking-[0.18em]">Single day</span>
            <input name="day" type="date" defaultValue={selectedDay} className="rounded-2xl border border-ink/15 bg-white/10 px-3 py-2 text-ink" />
          </label>
          <label className="space-y-2 text-sm text-[var(--theme-body)]">
            <span className="block uppercase tracking-[0.18em]">From</span>
            <input name="from" type="date" defaultValue={selectedFrom} className="rounded-2xl border border-ink/15 bg-white/10 px-3 py-2 text-ink" />
          </label>
          <label className="space-y-2 text-sm text-[var(--theme-body)]">
            <span className="block uppercase tracking-[0.18em]">To</span>
            <input name="to" type="date" defaultValue={selectedTo} className="rounded-2xl border border-ink/15 bg-white/10 px-3 py-2 text-ink" />
          </label>
          <button type="submit" className="rounded-full border border-gold/25 bg-gold/15 px-4 py-2 text-sm text-gold transition hover:border-gold/40 hover:bg-gold/20">
            Apply period
          </button>
          <Link href={buildAnalysisHref({ section: selectedSection, range: selectedRange, label, mood, period })} className="rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm text-[var(--theme-text)] transition hover:border-cyan/30 hover:text-cyan">
            Clear dates
          </Link>
        </form>

        <div className="glass-panel rounded-[34px] p-6 md:p-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm uppercase tracking-[0.24em] text-gold/70">{detail.section === "trend" ? "Trend analysis" : "Time-of-day analysis"}</p>
              <h2 className="mt-2 font-display text-3xl text-[var(--theme-title)]">{detail.filterLabel}</h2>
            </div>
            <div className="text-right text-sm text-[var(--theme-muted)]">
              <p>Range: {detail.range === "week" ? "This Week" : detail.range === "month" ? "This Month" : "All Time"}</p>
              <p className="mt-1">{detail.entries.length} matching play{detail.entries.length === 1 ? "" : "s"}</p>
            </div>
          </div>

          <div className="mt-4 rounded-[24px] border border-cyan/20 bg-cyan/10 px-4 py-3 text-sm text-[var(--theme-body)]">
            This drilldown is using stored snapshot history. Heatmap drilldowns show cached time-of-day sessions without live audio-feature refresh.
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {detail.summaryCards.map((card) => (
              <div key={card.label} className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
                <p className="text-xs uppercase tracking-[0.18em] text-[var(--theme-muted)]">{card.label}</p>
                <p className="mt-3 font-display text-3xl text-[var(--theme-title)]">{card.value}</p>
                <p className="mt-2 text-sm leading-6 text-[var(--theme-body)]">{card.delta}</p>
              </div>
            ))}
          </div>

          <div className="mt-8 grid gap-6 xl:grid-cols-2">
            <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-gold/70">Top artists</p>
                  <h3 className="mt-2 font-display text-2xl text-[var(--theme-title)]">Who drove the window</h3>
                </div>
                <Link href={`/dashboard/top-lists?range=${selectedRange}${topListsQuery}`} className="text-sm text-cyan transition hover:text-gold">
                  Open rankings
                </Link>
              </div>
              <div className="mt-5 space-y-3">
                {detail.topArtists.length === 0 ? (
                  <p className="text-sm text-[var(--theme-muted)]">Not enough stored artist data for this selection yet.</p>
                ) : (
                  detail.topArtists.map((item) => (
                    <div key={item.label} className="flex items-center justify-between gap-3 rounded-[22px] border border-white/8 bg-white/[0.03] px-4 py-3">
                      <div>
                        <p className="font-display text-xl text-[var(--theme-title)]">{item.label}</p>
                        <p className="text-sm text-[var(--theme-body)]">{item.detail}</p>
                      </div>
                      <p className="font-mono text-lg uppercase text-gold">{item.value}</p>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
              <p className="text-xs uppercase tracking-[0.18em] text-gold/70">Time pattern</p>
              <h3 className="mt-2 font-display text-2xl text-[var(--theme-title)]">When you showed up</h3>
              <div className="mt-5 space-y-3">
                {detail.periodBreakdown.map((item) => (
                  <div key={item.label} className="rounded-[22px] border border-white/8 bg-white/[0.03] px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-display text-xl text-[var(--theme-title)]">{item.label}</p>
                      <p className="font-mono text-lg uppercase text-cyan">{item.value}</p>
                    </div>
                    <p className="mt-1 text-sm text-[var(--theme-body)]">{item.detail}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-6 grid gap-6 xl:grid-cols-2">
            <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
              <p className="text-xs uppercase tracking-[0.18em] text-gold/70">Top albums</p>
              <h3 className="mt-2 font-display text-2xl text-[var(--theme-title)]">Repeat homes in the mix</h3>
              <div className="mt-5 space-y-3">
                {detail.topAlbums.length === 0 ? (
                  <p className="text-sm text-[var(--theme-muted)]">No album repeats were stored for this selection yet.</p>
                ) : (
                  detail.topAlbums.map((item) => (
                    <div key={item.label} className="rounded-[22px] border border-white/8 bg-white/[0.03] px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-display text-xl text-[var(--theme-title)]">{item.label}</p>
                        <p className="font-mono text-lg uppercase text-gold">{item.value}</p>
                      </div>
                      <p className="mt-1 text-sm text-[var(--theme-body)]">{item.detail}</p>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
              <p className="text-xs uppercase tracking-[0.18em] text-gold/70">Genre pulse</p>
              <h3 className="mt-2 font-display text-2xl text-[var(--theme-title)]">Styles behind this window</h3>
              <div className="mt-5 space-y-3">
                {detail.topGenres.length === 0 ? (
                  <p className="text-sm text-[var(--theme-muted)]">Stored genre metadata was not rich enough for this slice yet.</p>
                ) : (
                  detail.topGenres.map((item) => (
                    <div key={item.label} className="rounded-[22px] border border-white/8 bg-white/[0.03] px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-display text-xl text-[var(--theme-title)]">{item.label}</p>
                        <p className="font-mono text-lg uppercase text-cyan">{item.value}</p>
                      </div>
                      <p className="mt-1 text-sm text-[var(--theme-body)]">{item.detail}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {detail.entries.length === 0 ? (
            <div className="mt-8 rounded-[28px] border border-dashed border-[rgba(57,18,98,0.16)] bg-white/[0.08] p-8 text-center text-[var(--theme-muted)]">
              No matching sessions were available yet for this slice.
            </div>
          ) : (
            <div className="mt-8 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-gold/70">Play history</p>
                  <h3 className="mt-2 font-display text-2xl text-[var(--theme-title)]">Every stored play in this slice</h3>
                </div>
                <p className="text-sm text-[var(--theme-muted)]">
                  {detail.from || detail.to
                    ? `${detail.from ? formatDateKey(detail.from) : "Earliest stored"} to ${detail.to ? formatDateKey(detail.to) : "Latest stored"}`
                    : "Showing the current dashboard window"}
                </p>
              </div>
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
                        <p className="mt-2 text-base text-[var(--theme-body)]">{entry.artist}</p>
                        <p className="mt-2 text-sm uppercase tracking-[0.2em] text-[var(--theme-muted)]">{entry.album}</p>
                      </div>
                      <div className="text-right text-sm text-[var(--theme-muted)]">
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





