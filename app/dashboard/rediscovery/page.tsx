import Image from "next/image";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { redirect } from "next/navigation";
import { requireSpotifySession } from "@/lib/auth";
import { getStoredRediscoverySection } from "@/lib/dashboard-section-cache";
import { getDashboardInsightsFromHistory } from "@/lib/spotify-dashboard";
import { DashboardRange, FavoriteTrack } from "@/lib/types";
import { PST_TIME_ZONE } from "@/lib/time";

const ranges: Array<{ key: DashboardRange; label: string }> = [
  { key: "week", label: "This Week" },
  { key: "month", label: "This Month" },
  { key: "all", label: "All Time" },
];

function normalizeRange(value?: string): DashboardRange {
  if (value === "month" || value === "all") {
    return value;
  }

  return "week";
}

function TrackRow({ track, accent }: { track: FavoriteTrack; accent: "mint" | "gold" }) {
  const accentClass = accent === "gold"
    ? "border-gold/35 bg-gold/18 text-[#8a5a00]"
    : "border-mint/35 bg-mint/18 text-[#167a63]";

  return (
    <div className="desktop-card p-5">
      <div className="flex items-start gap-4">
        {track.imageUrl ? (
          <div className="media-frame relative h-28 w-28 shrink-0 p-1.5">
            <Image src={track.imageUrl} alt={track.title} fill sizes="112px" className="rounded-[18px] object-contain bg-white/[0.2] p-1" />
          </div>
        ) : (
          <div className="media-frame flex h-28 w-28 shrink-0 items-center justify-center p-3 font-mono text-lg uppercase tracking-[0.16em] text-ink/60">
            Art
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="font-display text-2xl uppercase tracking-[0.08em] text-[var(--theme-title)] md:text-3xl">{track.title}</p>
              <p className="mt-2 text-sm uppercase tracking-[0.18em] text-[var(--theme-body)]">{track.artist} / {track.album}</p>
            </div>
            <span className={`rounded-full px-3 py-1 text-xs uppercase tracking-[0.18em] ${accentClass}`}>
              {track.affinity}% match
            </span>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="rounded-full border border-[rgba(57,18,98,0.16)] bg-white/[0.55] px-3 py-1 text-xs uppercase tracking-[0.18em] text-[var(--theme-muted)]">
              {track.lastPlayed}
            </span>
            {track.savedAt ? (
              <span className="rounded-full border border-[rgba(57,18,98,0.16)] bg-white/[0.45] px-3 py-1 text-xs uppercase tracking-[0.18em] text-[var(--theme-muted)]">
                Saved {new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: PST_TIME_ZONE }).format(new Date(track.savedAt))}
              </span>
            ) : null}
          </div>
          {track.reason ? <p className="mt-4 text-sm leading-7 text-[var(--theme-body)]">{track.reason}</p> : null}
        </div>
      </div>
    </div>
  );
}

export default async function RediscoveryPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const session = await requireSpotifySession("/dashboard/rediscovery");

  const { range } = await searchParams;
  const selectedRange = normalizeRange(range);
  const loadStartedAt = Date.now();
  const insights = await getStoredRediscoverySection(session.spotifyUserId, selectedRange)
    ?? await getDashboardInsightsFromHistory(session.spotifyUserId, selectedRange);
  console.log(`[dashboard-page] user=${session.spotifyUserId} page=rediscovery step=load elapsedMs=${Date.now() - loadStartedAt}`);

  if (!insights) {
    redirect(`/dashboard?range=${selectedRange}`);
  }

  return (
    <main className="relative overflow-hidden px-6 py-10 md:px-10">
      <div className="mx-auto max-w-7xl space-y-8 text-[var(--theme-text)]">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-3xl space-y-3">
            <p className="section-kicker">Rediscovery archive</p>
            <h1 className="font-display text-5xl uppercase tracking-[0.08em] text-[var(--theme-title)] md:text-6xl">Revisit what your library forgot.</h1>
            <p className="text-base leading-8 text-[var(--theme-body)]">
              Forgotten favorites stay in one lane, and older saved deep cuts live in another so you can revisit both the obvious classics and the quieter library pulls.
            </p>
          </div>
          <Link href={`/dashboard?range=${selectedRange}`} className="pixel-chip text-[var(--theme-text)] transition hover:text-[#2d0d46]">
            Back to dashboard
          </Link>
        </div>

        <div className="flex flex-wrap gap-3">
          {ranges.map((option) => {
            const active = option.key === selectedRange;
            return (
              <Link
                key={option.key}
                href={`/dashboard/rediscovery?range=${option.key}`}
                className={`rounded-full px-4 py-2 text-sm uppercase tracking-[0.16em] transition ${active ? "bg-gold text-[#24160f]" : "border border-[rgba(57,18,98,0.16)] bg-white/[0.18] text-[var(--theme-text)]"}`}
              >
                {option.label}
              </Link>
            );
          })}
        </div>

        <div className="rounded-[24px] border border-cyan/20 bg-cyan/10 px-5 py-4 text-sm text-[var(--theme-body)]">
          Rediscovery is being generated from stored Listening Lore history so this page stays fast and predictable.
        </div>

        <section className="glass-panel rounded-[36px] p-6 md:p-8">
          <div className="mb-6 flex items-center gap-3">
            <div className="icon-bubble h-11 w-11 text-[var(--theme-accent)]">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <p className="section-kicker">Forgotten favorites</p>
              <h2 className="mt-2 font-display text-3xl uppercase tracking-[0.08em] text-[var(--theme-title)]">Historically important tracks that disappeared from rotation</h2>
            </div>
          </div>
          <div className="space-y-4">
            {insights.forgottenFavorites.length > 0 ? (
              insights.forgottenFavorites.map((track) => <TrackRow key={`${track.title}-${track.artist}`} track={track} accent="mint" />)
            ) : (
              <div className="desktop-card p-5 text-sm leading-7 text-[var(--theme-body)]">No rediscovery candidates yet. Give Listening Lore more listening history and saved-track data to work with.</div>
            )}
          </div>
        </section>

        <section className="window-panel p-6 pt-16 md:p-8 md:pt-16">
          <div className="mb-6 flex items-center gap-3">
            <div className="icon-bubble h-11 w-11 text-[var(--theme-highlight)]">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <p className="section-kicker">Saved deep cuts</p>
              <h2 className="mt-2 font-display text-3xl uppercase tracking-[0.08em] text-[var(--theme-title)]">Older saved songs that have gone quiet</h2>
            </div>
          </div>
          <div className="mb-6 desktop-card p-5 text-sm leading-7 text-[var(--theme-body)]">
            This view widens rediscovery beyond favorites. It surfaces older library saves that have not shown up in your recent listening window, even when they were never top-ranked staples.
          </div>
          <div className="space-y-4">
            {insights.quietSavedTracks.length > 0 ? (
              insights.quietSavedTracks.map((track) => <TrackRow key={`${track.title}-${track.artist}`} track={track} accent="gold" />)
            ) : (
              <div className="desktop-card p-5 text-sm leading-7 text-[var(--theme-body)]">No quiet saved-track picks yet. This list fills in as Listening Lore sees more of your library and recent listening.</div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}




