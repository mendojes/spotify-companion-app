import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { isSessionRefreshFailure, requireSpotifySession } from "@/lib/auth";
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

function Artwork({ src, alt }: { src?: string; alt: string }) {
  if (!src) {
    return (
      <div className="flex h-28 w-28 items-center justify-center rounded-[28px] border border-dashed border-ink/15 text-xs uppercase tracking-[0.18em] text-ink/50">
        Art
      </div>
    );
  }

  return (
    <div className="relative h-28 w-28 overflow-hidden rounded-[28px] border border-white/10 bg-white/5">
      <Image src={src} alt={alt} fill sizes="112px" className="object-contain bg-white/[0.2]" />
    </div>
  );
}

function ArtistsList({ items }: { items: TopListArtist[] }) {
  return (
    <div className="space-y-4">
      {items.map((item) => (
        <div key={item.id} className="flex items-start gap-5 rounded-[28px] border border-white/10 bg-white/[0.03] p-5">
          <Artwork src={item.imageUrl} alt={item.name} />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <p className="font-display text-3xl text-white">{item.name}</p>
              <p className="text-sm text-cyan">#{item.rank}</p>
            </div>
            <p className="mt-2 text-base text-ink/80">{item.genres.length > 0 ? item.genres.join(" - ") : "Genres unavailable"}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function TracksList({ items }: { items: TopListTrack[] }) {
  return (
    <div className="space-y-4">
      {items.map((item) => (
        <div key={item.id} className="flex items-start gap-5 rounded-[28px] border border-white/10 bg-white/[0.03] p-5">
          <Artwork src={item.imageUrl} alt={item.title} />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <p className="font-display text-3xl text-white">{item.title}</p>
              <p className="text-sm text-gold">#{item.rank}</p>
            </div>
            <p className="mt-2 text-base text-ink/80">{item.artist}</p>
            <p className="mt-2 text-sm uppercase tracking-[0.2em] text-ink/55">{item.album}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function AlbumsList({ items }: { items: TopListAlbum[] }) {
  return (
    <div className="space-y-4">
      {items.map((item) => (
        <div key={item.id} className="flex items-start gap-5 rounded-[28px] border border-white/10 bg-white/[0.03] p-5">
          <Artwork src={item.imageUrl} alt={item.name} />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <p className="font-display text-3xl text-white">{item.name}</p>
              <p className="text-sm text-mint">#{item.rank}</p>
            </div>
            <p className="mt-2 text-base text-ink/80">{item.artist}</p>
            <p className="mt-2 text-sm uppercase tracking-[0.2em] text-ink/55">{item.trackCount} ranked track{item.trackCount === 1 ? "" : "s"}</p>
          </div>
        </div>
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

  try {
    data = await getSpotifyTopListsFromHistory(session.spotifyUserId, selectedRange, FULL_TOP_LIST_LIMIT, selectedFrom, selectedTo);
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
      sourceLabel: "No cached SoundScope rankings yet",
      from: selectedFrom,
      to: selectedTo,
    };
    rankingsNotice = `Cached rankings could not be loaded yet. Use Refresh snapshot to update stored rankings. (${message})`;
  }

  if (!rankingsNotice) {
    rankingsNotice = "This page is using stored SoundScope rankings so it can load without waiting on live Spotify requests.";
  }

  if (!data) {
    data = {
      range: selectedRange,
      artists: [],
      tracks: [],
      albums: [],
      sourceLabel: "No cached SoundScope rankings yet",
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
            <h1 className="font-display text-5xl text-white md:text-6xl">Your full ranking shelves.</h1>
            <p className="text-base leading-7 text-ink/80">Browse your rankings over 1 week, 1 month, 1 year, all time, or a custom window.</p>
          </div>
          <Link href={`/dashboard?topRange=${selectedRange}${customQuery ? `&topFrom=${selectedFrom}&topTo=${selectedTo}` : ""}`} className="rounded-full border border-ink/15 bg-white/5 px-4 py-2 text-sm text-ink transition hover:border-gold/25 hover:text-gold">
            Back to dashboard
          </Link>
        </div>

        <div className="flex flex-wrap gap-3">
          {ranges.map((option) => {
            const active = option.key === selectedRange;
            const href = `/dashboard/top-lists?range=${option.key}&tab=${selectedTab}&page=1${option.key === "custom" ? customQuery : ""}`;

            return (
              <Link key={option.key} href={href} className={`rounded-full px-4 py-2 text-sm transition ${active ? "bg-gold text-[#24160f]" : "border border-ink/10 bg-white/5 text-ink/80"}`}>
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
            <label className="space-y-2 text-sm text-ink/80">
              <span className="block uppercase tracking-[0.18em]">From</span>
              <input name="from" type="date" defaultValue={selectedFrom} className="rounded-2xl border border-ink/15 bg-white/10 px-3 py-2 text-ink" />
            </label>
            <label className="space-y-2 text-sm text-ink/80">
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
              <Link key={option.key} href={`/dashboard/top-lists?range=${selectedRange}&tab=${option.key}&page=1${customQuery}`} className={`rounded-full px-4 py-2 text-sm transition ${active ? "bg-cyan text-[#1c1511]" : "border border-ink/10 bg-white/5 text-ink/80"}`}>
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
              <h2 className="mt-2 font-display text-3xl text-white">{data.sourceLabel}</h2>
            </div>
            <p className="text-sm text-ink/70">Showing {selectedItems.length === 0 ? 0 : startIndex + 1}-{Math.min(startIndex + pageSize, selectedItems.length)} of {selectedItems.length}</p>
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
              <p className="text-sm text-ink/70">Page {currentPage} of {totalPages}</p>
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





