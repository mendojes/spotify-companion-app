import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { isSessionRefreshFailure, requireSpotifySession } from "@/lib/auth";
import { getStoredTopListsSection } from "@/lib/dashboard-section-cache";
import { FULL_TOP_LIST_LIMIT, getSpotifyTopListsFromHistory } from "@/lib/spotify-toplists";
import { TopListAlbum, TopListArtist, TopListRange, TopListTrack } from "@/lib/types";

type TopListsPageProps = {
  searchParams: Promise<{ range?: string; tab?: string; page?: string; from?: string; to?: string }>;
};

type TopListTab = "artists" | "tracks" | "albums";

const tabs: Array<{ key: TopListTab; label: string }> = [
  { key: "artists", label: "Artists" },
  { key: "tracks", label: "Songs" },
  { key: "albums", label: "Albums" },
];

const ranges: Array<{ key: TopListRange; label: string }> = [
  { key: "week", label: "1 Week" },
  { key: "month", label: "1 Month" },
  { key: "year", label: "1 Year" },
  { key: "all", label: "All Time" },
  { key: "custom", label: "Custom" },
];

function normalizeRange(value?: string): TopListRange {
  if (value === "week" || value === "month" || value === "year" || value === "all" || value === "custom") {
    return value;
  }

  return "month";
}

function normalizeTab(value?: string): TopListTab {
  if (value === "artists" || value === "tracks" || value === "albums") {
    return value;
  }

  return "artists";
}

function normalizePage(value?: string): number {
  const page = Number(value);

  if (!Number.isFinite(page) || page < 1) {
    return 1;
  }

  return Math.floor(page);
}

function normalizeDate(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return undefined;
  }

  return value;
}

function formatListenCount(count?: number) {
  if (!count || count < 1) {
    return "Listen count unavailable";
  }

  return `${count} listen${count === 1 ? "" : "s"}`;
}

function getInitials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function Artwork({ src, alt }: { src?: string; alt: string }) {
  if (!src) {
    return (
      <div className="media-frame flex h-28 w-28 items-center justify-center p-2">
        <div className="flex h-full w-full items-center justify-center rounded-[20px] bg-[linear-gradient(135deg,rgba(255,214,243,0.95),rgba(255,94,201,0.95)_32%,rgba(110,130,255,0.95)_68%,rgba(122,247,255,0.95))] font-display text-2xl uppercase tracking-[0.14em] text-[#170718]">
          {getInitials(alt) || "SS"}
        </div>
      </div>
    );
  }

  return (
    <div className="media-frame relative h-28 w-28 p-1.5">
      <Image src={src} alt={alt} fill sizes="112px" className="rounded-[20px] object-cover" />
    </div>
  );
}

function ListensChip({ count, accent }: { count?: number; accent: "cyan" | "gold" | "mint" }) {
  const tone =
    accent === "gold"
      ? "border-gold/35 bg-gold/18 text-[#8a5a00]"
      : accent === "mint"
        ? "border-mint/35 bg-mint/18 text-[#167a63]"
        : "border-cyan/35 bg-cyan/18 text-[#0f6f88]";

  return (
    <span className={`rounded-full border px-3 py-1 text-xs uppercase tracking-[0.18em] ${tone}`}>
      {count && count > 0 ? formatListenCount(count) : "History count pending"}
    </span>
  );
}

function RankChip({ rank, accent }: { rank: number; accent: "cyan" | "gold" | "mint" }) {
  const tone =
    accent === "gold"
      ? "border-gold/35 bg-gold/18 text-[#8a5a00]"
      : accent === "mint"
        ? "border-mint/35 bg-mint/18 text-[#167a63]"
        : "border-cyan/35 bg-cyan/18 text-[#0f6f88]";

  return <span className={`rounded-full border px-3 py-1 text-xs uppercase tracking-[0.18em] ${tone}`}>#{rank}</span>;
}

function TopListCard({
  artworkAlt,
  artworkSrc,
  title,
  subtitle,
  description,
  rank,
  accent,
  listens,
}: {
  artworkAlt: string;
  artworkSrc?: string;
  title: string;
  subtitle: string;
  description: string;
  rank: number;
  accent: "cyan" | "gold" | "mint";
  listens?: number;
}) {
  return (
    <div className="desktop-card p-5">
      <div className="flex items-start gap-4">
        <Artwork src={artworkSrc} alt={artworkAlt} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="font-display text-3xl uppercase tracking-[0.08em] text-[var(--theme-title)]">{title}</p>
              <p className="mt-2 text-sm uppercase tracking-[0.18em] text-[var(--theme-body)]">{subtitle}</p>
            </div>
            <RankChip rank={rank} accent={accent} />
          </div>
          <p className="mt-4 text-sm leading-7 text-[var(--theme-body)]">{description}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <ListensChip count={listens} accent={accent} />
          </div>
        </div>
      </div>
    </div>
  );
}

function ArtistsList({ items }: { items: TopListArtist[] }) {
  return (
    <div className="space-y-4">
      {items.map((item) => (
        <TopListCard
          key={item.id}
          artworkAlt={item.name}
          artworkSrc={item.imageUrl}
          title={item.name}
          subtitle={item.genres.length > 0 ? item.genres.join(" / ") : "Genres unavailable"}
          description={item.listenCount ? `${formatListenCount(item.listenCount)} across your recent top-list history.` : "Artist image and genre data come from your cached Listening Lore history."}
          rank={item.rank}
          accent="cyan"
          listens={item.listenCount}
        />
      ))}
    </div>
  );
}

function TracksList({ items }: { items: TopListTrack[] }) {
  return (
    <div className="space-y-4">
      {items.map((item) => (
        <TopListCard
          key={item.id}
          artworkAlt={item.title}
          artworkSrc={item.imageUrl}
          title={item.title}
          subtitle={`${item.artist} / ${item.album}`}
          description={item.listenCount ? `${formatListenCount(item.listenCount)} in the selected window.` : `Spotify popularity score: ${item.popularity}.`}
          rank={item.rank}
          accent="gold"
          listens={item.listenCount}
        />
      ))}
    </div>
  );
}

function AlbumsList({ items }: { items: TopListAlbum[] }) {
  return (
    <div className="space-y-4">
      {items.map((item) => (
        <TopListCard
          key={item.id}
          artworkAlt={item.name}
          artworkSrc={item.imageUrl}
          title={item.name}
          subtitle={item.artist}
          description={item.listenCount ? `${formatListenCount(item.listenCount)} from ${item.trackCount} ranked track${item.trackCount === 1 ? "" : "s"} on this album.` : `${item.trackCount} ranked track${item.trackCount === 1 ? "" : "s"} contributed to this album rank.`}
          rank={item.rank}
          accent="mint"
          listens={item.listenCount}
        />
      ))}
    </div>
  );
}

export default async function TopListsPage({ searchParams }: TopListsPageProps) {
  const session = await requireSpotifySession("/dashboard/top-lists");

  const { range, tab, page, from, to } = await searchParams;
  const selectedRange = normalizeRange(range);
  const selectedTab = normalizeTab(tab);
  const selectedPage = normalizePage(page);
  const selectedFrom = normalizeDate(from);
  const selectedTo = normalizeDate(to);
  const pageSize = FULL_TOP_LIST_LIMIT;
  let data;
  let rankingsNotice: string | null = null;
  const loadStartedAt = Date.now();

  try {
    data = await getStoredTopListsSection(session.spotifyUserId, selectedRange, selectedFrom, selectedTo)
      ?? await getSpotifyTopListsFromHistory(session.spotifyUserId, selectedRange, FULL_TOP_LIST_LIMIT, selectedFrom, selectedTo);
    console.log(`[dashboard-page] user=${session.spotifyUserId} page=top-lists step=load elapsedMs=${Date.now() - loadStartedAt}`);
  } catch (error) {
    if (isSessionRefreshFailure(error)) {
      redirect("/login?error=session_refresh_failed");
    }

    const message = error instanceof Error ? error.message : String(error);
    data = {
      range: selectedRange,
      artists: [],
      tracks: [],
      albums: [],
      sourceLabel: "No cached Listening Lore rankings yet",
      from: selectedFrom,
      to: selectedTo,
    };
    rankingsNotice = `Cached rankings could not be loaded yet. Use Refresh snapshot to update stored rankings. (${message})`;
  }

  if (!rankingsNotice) {
    rankingsNotice = "This page is using stored Listening Lore rankings so it can load without waiting on live Spotify requests.";
  }

  if (!data) {
    data = {
      range: selectedRange,
      artists: [],
      tracks: [],
      albums: [],
      sourceLabel: "No cached Listening Lore rankings yet",
      from: selectedFrom,
      to: selectedTo,
    };
  }

  const artists = data.artists;
  const tracks = data.tracks;
  const albums = data.albums;
  const selectedItems = selectedTab === "artists" ? artists : selectedTab === "tracks" ? tracks : albums;
  const totalPages = Math.max(1, Math.ceil(selectedItems.length / pageSize));
  const currentPage = Math.min(selectedPage, totalPages);
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;

  const pageArtists = artists.slice(startIndex, endIndex);
  const pageTracks = tracks.slice(startIndex, endIndex);
  const pageAlbums = albums.slice(startIndex, endIndex);
  const customQuery = selectedRange === "custom" && selectedFrom && selectedTo ? `&from=${selectedFrom}&to=${selectedTo}` : "";

  return (
    <main className="relative overflow-hidden px-6 py-10 md:px-10">
      <div className="mx-auto max-w-7xl space-y-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-3xl space-y-3">
            <p className="text-sm uppercase tracking-[0.3em] text-gold/75">Top Lists</p>
            <h1 className="font-display text-5xl text-[var(--theme-title)] md:text-6xl">Your full ranking shelves.</h1>
            <p className="text-base leading-7 text-[var(--theme-body)]">Browse your rankings over 1 week, 1 month, 1 year, all time, or a custom window.</p>
          </div>
          <Link href={`/dashboard?topRange=${selectedRange}${customQuery ? `&topFrom=${selectedFrom}&topTo=${selectedTo}` : ""}`} className="rounded-full border border-[rgba(57,18,98,0.16)] bg-white/[0.18] px-4 py-2 text-sm text-[var(--theme-text)] transition hover:border-gold/25 hover:text-gold">
            Back to dashboard
          </Link>
        </div>

        <div className="flex flex-wrap gap-3">
          {ranges.map((option) => {
            const active = option.key === selectedRange;
            const href = `/dashboard/top-lists?range=${option.key}&tab=${selectedTab}&page=1${option.key === "custom" ? customQuery : ""}`;

            return (
              <Link key={option.key} href={href} className={`rounded-full px-4 py-2 text-sm transition ${active ? "bg-gold text-[#24160f]" : "border border-[rgba(57,18,98,0.16)] bg-white/[0.18] text-[var(--theme-text)]"}`}>
                {option.label}
              </Link>
            );
          })}
        </div>

        {selectedRange === "custom" ? (
          <form action="/dashboard/top-lists" method="get" className="glass-panel flex flex-wrap items-end gap-3 rounded-[30px] p-4">
            <input type="hidden" name="tab" value={selectedTab} />
            <input type="hidden" name="page" value="1" />
            <input type="hidden" name="range" value="custom" />
            <label className="space-y-2 text-sm text-[var(--theme-body)]">
              <span className="block uppercase tracking-[0.18em]">From</span>
              <input name="from" type="date" defaultValue={selectedFrom} className="rounded-2xl border border-ink/15 bg-white/10 px-3 py-2 text-ink" />
            </label>
            <label className="space-y-2 text-sm text-[var(--theme-body)]">
              <span className="block uppercase tracking-[0.18em]">To</span>
              <input name="to" type="date" defaultValue={selectedTo} className="rounded-2xl border border-ink/15 bg-white/10 px-3 py-2 text-ink" />
            </label>
            <button type="submit" className="rounded-full border border-gold/25 bg-gold/15 px-4 py-2 text-sm text-gold transition hover:border-gold/40 hover:bg-gold/20">Apply custom window</button>
          </form>
        ) : null}

        <div className="flex flex-wrap gap-3">
          {tabs.map((option) => {
            const active = option.key === selectedTab;
            return (
              <Link key={option.key} href={`/dashboard/top-lists?range=${selectedRange}&tab=${option.key}&page=1${customQuery}`} className={`rounded-full px-4 py-2 text-sm transition ${active ? "bg-cyan text-[#1c1511]" : "border border-[rgba(57,18,98,0.16)] bg-white/[0.18] text-[var(--theme-text)]"}`}>
                {option.label}
              </Link>
            );
          })}
        </div>

        {rankingsNotice ? (
          <div className="rounded-[28px] border border-gold/25 bg-gold/10 px-5 py-4 text-sm text-ink/90">{rankingsNotice}</div>
        ) : null}

        <div className="glass-panel rounded-[34px] p-6 md:p-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm uppercase tracking-[0.24em] text-gold/70">{tabs.find((item) => item.key === selectedTab)?.label}</p>
              <h2 className="mt-2 font-display text-3xl text-[var(--theme-title)]">{data.sourceLabel}</h2>
            </div>
            <p className="text-sm text-[var(--theme-muted)]">Showing {selectedItems.length === 0 ? 0 : startIndex + 1}-{Math.min(startIndex + pageSize, selectedItems.length)} of {selectedItems.length}</p>
          </div>

          <div className="mt-8">
            {selectedTab === "artists" ? <ArtistsList items={pageArtists} /> : null}
            {selectedTab === "tracks" ? <TracksList items={pageTracks} /> : null}
            {selectedTab === "albums" ? <AlbumsList items={pageAlbums} /> : null}
          </div>

          {totalPages > 1 ? (
            <div className="mt-8 flex flex-wrap items-center justify-between gap-4">
              <Link href={`/dashboard/top-lists?range=${selectedRange}&tab=${selectedTab}&page=${Math.max(1, currentPage - 1)}${customQuery}`} className={`rounded-full border border-ink/15 bg-white/5 px-4 py-2 text-sm ${currentPage === 1 ? "pointer-events-none opacity-40" : "text-ink hover:text-gold"}`}>
                Previous
              </Link>
              <p className="text-sm text-[var(--theme-muted)]">Page {currentPage} of {totalPages}</p>
              <Link href={`/dashboard/top-lists?range=${selectedRange}&tab=${selectedTab}&page=${Math.min(totalPages, currentPage + 1)}${customQuery}`} className={`rounded-full border border-ink/15 bg-white/5 px-4 py-2 text-sm ${currentPage === totalPages ? "pointer-events-none opacity-40" : "text-ink hover:text-gold"}`}>
                Next
              </Link>
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}





