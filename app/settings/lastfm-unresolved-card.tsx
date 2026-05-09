import Link from "next/link";
import { formatPstDateTime } from "@/lib/time";
import { UnresolvedImportedLastFmGroup } from "@/lib/lastfm-import";
import { ManualLastFmResolutionForm } from "./manual-lastfm-resolution-form";

type LastFmUnresolvedCardProps = {
  unresolvedGroups: {
    items: UnresolvedImportedLastFmGroup[];
    totalCount: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
  saved?: string;
};

function buildSettingsPageHref(page: number, saved?: string) {
  const params = new URLSearchParams();
  if (saved) {
    params.set("saved", saved);
  }
  params.set("unresolvedPage", String(page));
  return `/settings?${params.toString()}`;
}

export function LastFmUnresolvedCard({ unresolvedGroups, saved }: LastFmUnresolvedCardProps) {
  const { items, totalCount, page, totalPages } = unresolvedGroups;

  return (
    <section className="desktop-card space-y-4 p-5">
      <div className="space-y-2">
        <p className="font-display text-2xl uppercase tracking-[0.08em] text-[var(--theme-title)]">Unresolved Last.fm imports</p>
        <p className="max-w-3xl text-sm leading-7 text-[var(--theme-body)]">
          These imported scrobbles are still using synthetic Last.fm ids because we have not matched them to a real Spotify track yet. You can retry them from the dashboard maintenance panel, or manually paste a Spotify track link here.
        </p>
        <p className="text-sm text-[var(--theme-muted)]">
          {totalCount} unresolved track group{totalCount === 1 ? "" : "s"} total.
        </p>
      </div>

      {items.length === 0 ? (
        <div className="rounded-[24px] border-[2px] border-[rgba(44,12,70,0.18)] bg-white/[0.36] px-4 py-4 text-sm leading-7 text-[var(--theme-body)]">
          Every imported Last.fm track currently has a resolved Spotify match.
        </div>
      ) : (
        <>
          <div className="space-y-4">
            {items.map((item) => (
              <div
                key={`${item.trackName}::${item.artistName}::${item.albumName}`}
                className="rounded-[24px] border-[2px] border-[rgba(44,12,70,0.18)] bg-white/[0.44] p-4"
              >
                <div className="space-y-2">
                  <p className="font-display text-xl uppercase tracking-[0.08em] text-[var(--theme-title)]">{item.trackName}</p>
                  <p className="text-sm text-[var(--theme-body)]">
                    {item.artistName} / {item.albumName || "Unknown album"}
                  </p>
                  <p className="text-xs uppercase tracking-[0.14em] text-[var(--theme-muted)]">
                    {item.playCount} imported play{item.playCount === 1 ? "" : "s"} | earliest {formatPstDateTime(item.earliestPlayedAt)} | latest {formatPstDateTime(item.latestPlayedAt)}
                  </p>
                </div>
                <div className="mt-4">
                  <ManualLastFmResolutionForm
                    trackName={item.trackName}
                    artistName={item.artistName}
                    albumName={item.albumName}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <p className="text-sm text-[var(--theme-muted)]">
              Page {page} of {Math.max(totalPages, 1)}
            </p>
            <div className="flex flex-wrap gap-3">
              {page > 1 ? (
                <Link href={buildSettingsPageHref(page - 1, saved)} className="pixel-chip text-[var(--theme-text)] transition hover:text-[#2d0d46]">
                  Previous page
                </Link>
              ) : null}
              {page < totalPages ? (
                <Link href={buildSettingsPageHref(page + 1, saved)} className="pixel-chip text-[var(--theme-text)] transition hover:text-[#2d0d46]">
                  Next page
                </Link>
              ) : null}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
