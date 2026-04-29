import Image from "next/image";
import Link from "next/link";
import { PublicProfileBackgroundSync } from "@/components/public-profile-background-sync";
import { hasSpotifyConnection, requireSession, requireSpotifySession } from "@/lib/auth";
import { getStoredPlaylistsSection } from "@/lib/dashboard-section-cache";
import { getPublicSpotifyProfileInsights } from "@/lib/spotify-public";
import { getPlaylistPageDataFromHistory } from "@/lib/spotify-playlists";
import { PlaylistInsight, PlaylistSortOption } from "@/lib/types";
import { formatPstDateTime } from "@/lib/time";

type PlaylistsPageProps = {
  searchParams: Promise<{ sort?: string; q?: string; page?: string; refreshed?: string; refresh_error?: string }>;
};

const sortOptions: Array<{ key: PlaylistSortOption; label: string }> = [
  { key: "created_desc", label: "Created newest" },
  { key: "created_asc", label: "Created oldest" },
  { key: "last_listened_desc", label: "Last listened newest" },
  { key: "last_listened_asc", label: "Last listened oldest" },
];

const PLAYLISTS_PER_PAGE = 12;


function normalizeSort(sort?: string): PlaylistSortOption {
  if (
    sort === "created_asc" ||
    sort === "last_listened_desc" ||
    sort === "last_listened_asc"
  ) {
    return sort;
  }

  return "last_listened_desc";
}

function normalizeQuery(value?: string) {
  return value?.trim() ?? "";
}

function normalizePage(value?: string): number {
  const page = Number(value);

  if (!Number.isFinite(page) || page < 1) {
    return 1;
  }

  return Math.floor(page);
}

function formatDateLabel(value?: string) {
  return formatPstDateTime(value);
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown playlist error";
}

function getAdaptivePlaylistTitleClass(value: string) {
  const base = "w-full whitespace-normal break-normal hyphens-none [overflow-wrap:normal] [word-break:keep-all] [text-wrap:balance]";

  if (value.length > 44) {
    return `${base} text-lg leading-[1.1] tracking-[0.02em]`;
  }

  if (value.length > 28) {
    return `${base} text-xl leading-[1.08] tracking-[0.03em]`;
  }

  if (value.length > 18) {
    return `${base} text-[1.65rem] leading-[1.05] tracking-[0.04em]`;
  }

  return `${base} text-3xl leading-[1] tracking-[0.08em]`;
}

function buildPlaylistsHref({
  sort,
  query,
  page,
}: {
  sort: PlaylistSortOption;
  query: string;
  page: number;
}) {
  const params = new URLSearchParams();
  params.set("sort", sort);

  if (query) {
    params.set("q", query);
  }

  params.set("page", String(page));

  return `/dashboard/playlists?${params.toString()}`;
}

function matchesPlaylistQuery(playlist: PlaylistInsight, query: string) {
  if (!query) {
    return true;
  }

  const normalizedQuery = query.toLocaleLowerCase();
  const haystack = [
    playlist.name,
    playlist.mood,
    playlist.topGenresSummary,
    playlist.diversity,
    playlist.listeningCadence,
    playlist.overlap,
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase();

  return haystack.includes(normalizedQuery);
}

function SearchBar({ query, sort }: { query: string; sort?: PlaylistSortOption }) {
  return (
    <form action="/dashboard/playlists" method="get" className="glass-panel flex flex-wrap items-end gap-3 rounded-[30px] p-4">
      {sort ? <input type="hidden" name="sort" value={sort} /> : null}
      <input type="hidden" name="page" value="1" />
      <label className="min-w-[16rem] flex-1 space-y-2 text-sm text-[var(--theme-body)]">
        <span className="block uppercase tracking-[0.18em]">Search playlists</span>
        <input
          name="q"
          type="search"
          defaultValue={query}
          placeholder="Search by name, mood, genre, or cadence"
          className="w-full rounded-2xl border border-ink/15 bg-white/10 px-4 py-3 text-ink placeholder:text-[var(--theme-muted)]"
        />
      </label>
      <button type="submit" className="rounded-full border border-cyan/25 bg-cyan/12 px-4 py-2 text-sm text-cyan transition hover:border-cyan/40 hover:bg-cyan/18">
        Search
      </button>
    </form>
  );
}

function Pager({
  currentPage,
  totalPages,
  sort,
  query,
}: {
  currentPage: number;
  totalPages: number;
  sort: PlaylistSortOption;
  query: string;
}) {
  if (totalPages <= 1) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <Link
        href={buildPlaylistsHref({ sort, query, page: Math.max(1, currentPage - 1) })}
        prefetch={false}
        className={`rounded-full border border-ink/15 bg-white/5 px-4 py-2 text-sm ${currentPage === 1 ? "pointer-events-none opacity-40" : "text-ink hover:text-cyan"}`}
      >
        Previous
      </Link>
      <p className="text-sm text-[var(--theme-muted)]">Page {currentPage} of {totalPages}</p>
      <Link
        href={buildPlaylistsHref({ sort, query, page: Math.min(totalPages, currentPage + 1) })}
        prefetch={false}
        className={`rounded-full border border-ink/15 bg-white/5 px-4 py-2 text-sm ${currentPage === totalPages ? "pointer-events-none opacity-40" : "text-ink hover:text-cyan"}`}
      >
        Next
      </Link>
    </div>
  );
}

export default async function PlaylistsPage({ searchParams }: PlaylistsPageProps) {
  const { sort, q, page, refreshed, refresh_error: refreshError } = await searchParams;
  const session = await requireSession();
  const spotifyConnected = hasSpotifyConnection(session);
  const selectedSort = normalizeSort(sort);
  const searchQuery = normalizeQuery(q);
  const requestedPage = normalizePage(page);

  if (!spotifyConnected) {
    const publicPageData = session.spotifyUserId
      ? await getStoredPlaylistsSection(session.spotifyUserId, selectedSort).catch(() => null)
        ?? await getPlaylistPageDataFromHistory(session.spotifyUserId, selectedSort).catch(() => null)
      : null;
    const publicInsights = session.spotifyUserId && !publicPageData?.playlists.length
      ? await getPublicSpotifyProfileInsights(
        session.spotifyUserId,
        session.spotifyProfileUrl,
      ).catch(() => null)
      : null;
    const publicPlaylists = publicPageData?.playlists.length
      ? publicPageData.playlists
      : publicInsights?.playlistInsights ?? [];
    const publicPlaylistCount = Math.max(publicPageData?.playlistCount ?? 0, publicInsights?.publicPlaylistCount ?? 0, publicPlaylists.length);
    const publicLastSyncedAt = publicPageData?.lastSyncedAt;
    const filteredPublicPlaylists = publicPlaylists.filter((playlist) => matchesPlaylistQuery(playlist, searchQuery));
    const totalPages = Math.max(1, Math.ceil(filteredPublicPlaylists.length / PLAYLISTS_PER_PAGE));
    const currentPage = Math.min(requestedPage, totalPages);
    const startIndex = (currentPage - 1) * PLAYLISTS_PER_PAGE;
    const pagePlaylists = filteredPublicPlaylists.slice(startIndex, startIndex + PLAYLISTS_PER_PAGE);

    return (
      <main className="relative min-h-screen overflow-hidden px-6 py-10 md:px-10">
        {session.spotifyUserId ? <PublicProfileBackgroundSync spotifyUserId={session.spotifyUserId} /> : null}
        <div className="mx-auto max-w-7xl space-y-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm uppercase tracking-[0.32em] text-cyan/70">Public Playlist Lab</p>
              <h1 className="mt-3 font-display text-4xl text-[var(--theme-title)] md:text-5xl">Visible playlists from your public Spotify profile</h1>
              <p className="mt-3 max-w-2xl text-base leading-7 text-[var(--theme-body)]">
                This page analyzes public playlists only. It can show structure, genres, mood, and track makeup, but not private listening-history signals.
              </p>
              <div className="mt-4 space-y-1 text-sm text-[var(--theme-muted)]">
                <p>Stored public playlists: {publicPlaylistCount}</p>
                <p>Last public playlist sync: {formatDateLabel(publicLastSyncedAt)}</p>
              </div>
            </div>
            <div className="flex gap-3">
              <Link href="/dashboard" prefetch={false} className="rounded-full border border-[rgba(57,18,98,0.16)] bg-white/[0.18] px-4 py-2 text-sm text-[var(--theme-text)]">
                Back to dashboard
              </Link>
            </div>
          </div>

          <div className="rounded-[24px] border border-cyan/20 bg-cyan/10 px-5 py-4 text-sm text-[var(--theme-body)]">
            Public playlist analysis uses only playlist contents that Spotify exposes publicly from your profile. Listening Lore also keeps a stored public playlist cache so this tab can reopen after you sign in again.
          </div>

          <div className="flex flex-wrap gap-3">
            {sortOptions.map((option) => {
              const active = option.key === selectedSort;

              return (
                <Link
                  key={option.key}
                  href={buildPlaylistsHref({ sort: option.key, query: searchQuery, page: 1 })}
                  prefetch={false}
                  className={`rounded-full px-4 py-2 text-sm transition ${
                    active ? "bg-white text-slate-950" : "border border-[rgba(57,18,98,0.16)] bg-white/[0.18] text-[var(--theme-text)]"
                  }`}
                >
                  {option.label}
                </Link>
              );
            })}
          </div>

          <SearchBar query={searchQuery} sort={selectedSort} />

          {filteredPublicPlaylists.length === 0 ? (
            <div className="glass-panel rounded-[30px] p-8 text-sm leading-7 text-[var(--theme-body)]">
              {searchQuery ? <>No public playlists matched &quot;{searchQuery}&quot;.</> : "No public playlists were available from this Spotify profile or its stored cache yet."}
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-4 text-sm text-[var(--theme-muted)]">
                <p>
                  Showing {startIndex + 1}-{Math.min(startIndex + PLAYLISTS_PER_PAGE, filteredPublicPlaylists.length)} of {filteredPublicPlaylists.length}
                  {searchQuery ? ` matching "${searchQuery}"` : " public playlists"}
                </p>
                <p>Page {currentPage} of {totalPages}</p>
              </div>

              <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                {pagePlaylists.map((playlist) => (
                  <Link
                    key={`${playlist.id ?? playlist.name}`}
                    href={playlist.id ? `/dashboard/playlists/${playlist.id}` : "/dashboard"}
                    prefetch={false}
                    className="glass-panel rounded-[30px] p-6 transition hover:border-cyan/40 hover:bg-white/[0.05]"
                  >
                    <div className="flex items-start gap-5">
                      {playlist.imageUrl ? (
                        <div className="relative h-28 w-28 shrink-0 overflow-hidden rounded-[24px] border border-white/10 bg-white/5">
                          <Image src={playlist.imageUrl} alt={playlist.name} fill sizes="112px" className="object-contain bg-white/[0.2]" />
                        </div>
                      ) : (
                        <div className="flex h-28 w-28 shrink-0 items-center justify-center rounded-[24px] border border-dashed border-white/15 bg-white/[0.04] text-xs uppercase tracking-[0.2em] text-[var(--theme-muted)]">
                          Mix
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <h2 className="font-display text-2xl text-[var(--theme-title)]">{playlist.name}</h2>
                        {playlist.trackCount ? <p className="mt-2 text-sm text-cyan">{playlist.trackCount} tracks analyzed</p> : null}
                      </div>
                    </div>
                    <div className="mt-6 space-y-4">
                      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                        <p className="text-sm text-[var(--theme-muted)]">Mood</p>
                        <p className="mt-2 text-[var(--theme-title)]">{playlist.mood}</p>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                        <p className="text-sm text-[var(--theme-muted)]">Top genres</p>
                        <p className="mt-2 text-[var(--theme-title)]">{playlist.topGenresSummary ?? playlist.diversity}</p>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                        <p className="text-sm text-[var(--theme-muted)]">Pattern</p>
                        <p className="mt-2 text-[var(--theme-title)]">{playlist.listeningCadence ?? playlist.overlap}</p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>

              <Pager currentPage={currentPage} totalPages={totalPages} sort={selectedSort} query={searchQuery} />
            </>
          )}
        </div>
      </main>
    );
  }

  const spotifySession = await requireSpotifySession("/dashboard/playlists");
  let playlists: PlaylistInsight[] = [];
  let error: string | null = null;
  let playlistCount = 0;
  let lastSyncedAt: string | undefined;
  const loadStartedAt = Date.now();

  try {
    const pageData = await getStoredPlaylistsSection(spotifySession.spotifyUserId, selectedSort)
      ?? await getPlaylistPageDataFromHistory(spotifySession.spotifyUserId, selectedSort);
    playlists = pageData.playlists;
    playlistCount = pageData.playlistCount;
    lastSyncedAt = pageData.lastSyncedAt;
    console.log(`[dashboard-page] user=${spotifySession.spotifyUserId} page=playlists step=load elapsedMs=${Date.now() - loadStartedAt}`);
  } catch (caughtError) {
    error = `Stored playlist analysis could not be loaded right now. Use Refresh snapshot to update playlist data. (${getErrorMessage(caughtError)})`;
  }

  const filteredPlaylists = playlists.filter((playlist) => matchesPlaylistQuery(playlist, searchQuery));
  const totalPages = Math.max(1, Math.ceil(filteredPlaylists.length / PLAYLISTS_PER_PAGE));
  const currentPage = Math.min(requestedPage, totalPages);
  const startIndex = (currentPage - 1) * PLAYLISTS_PER_PAGE;
  const pagePlaylists = filteredPlaylists.slice(startIndex, startIndex + PLAYLISTS_PER_PAGE);

  return (
    <main className="relative min-h-screen overflow-hidden px-6 py-10 md:px-10">
      <div className="mx-auto max-w-7xl space-y-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm uppercase tracking-[0.32em] text-cyan/70">Playlist Lab</p>
            <h1 className="mt-3 font-display text-4xl text-[var(--theme-title)] md:text-5xl">All playlist breakdowns</h1>
            <p className="mt-3 max-w-2xl text-base leading-7 text-[var(--theme-body)]">
              Browse every playlist we can access, sort them by timeline signals, and open any one for deeper mood, top-genre, and listening-cadence analysis.
            </p>
            <p className="mt-3 text-sm text-[var(--theme-muted)]">
              Created is estimated from the oldest track add date we can see, and last listened only updates when Spotify gives us exact playlist playback context.
            </p>
            <div className="mt-4 space-y-1 text-sm text-[var(--theme-muted)]">
              <p>Stored playlists: {playlistCount}</p>
              <p>Last playlist sync: {formatDateLabel(lastSyncedAt)}</p>
            </div>
          </div>
          <div className="flex gap-3">
            <Link href="/dashboard" prefetch={false} className="rounded-full border border-[rgba(57,18,98,0.16)] bg-white/[0.18] px-4 py-2 text-sm text-[var(--theme-text)]">
              Back to dashboard
            </Link>
            <a href="/api/dashboard/playlists/refresh" className="rounded-full border border-cyan/20 bg-cyan/10 px-4 py-2 text-sm text-cyan">
              Refresh playlists
            </a>
            <a href="/api/auth/logout" className="rounded-full border border-[rgba(57,18,98,0.16)] bg-white/[0.18] px-4 py-2 text-sm text-[var(--theme-text)]">
              Log out
            </a>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          {sortOptions.map((option) => {
            const active = option.key === selectedSort;
            return (
              <Link
                key={option.key}
                href={buildPlaylistsHref({ sort: option.key, query: searchQuery, page: 1 })}
                prefetch={false}
                className={`rounded-full px-4 py-2 text-sm transition ${
                  active ? "bg-white text-slate-950" : "border border-[rgba(57,18,98,0.16)] bg-white/[0.18] text-[var(--theme-text)]"
                }`}
              >
                {option.label}
              </Link>
            );
          })}
        </div>

        <SearchBar query={searchQuery} sort={selectedSort} />

        {refreshed ? (
          <div className="rounded-[24px] border border-cyan/30 bg-cyan/10 px-5 py-4 text-sm text-ink/85">
            Playlist library refreshed successfully.
          </div>
        ) : null}

        {refreshError ? (
          <div className="rounded-[24px] border border-gold/30 bg-gold/10 px-5 py-4 text-sm text-ink/85">
            Playlist library refresh failed. {refreshError}
          </div>
        ) : null}

        {error ? (
          <div className="rounded-[24px] border border-gold/30 bg-gold/10 px-5 py-4 text-sm text-ink/85">{error}</div>
        ) : (
          <div className="rounded-[24px] border border-cyan/20 bg-cyan/10 px-5 py-4 text-sm text-ink/85">
            This page is using stored playlist insights and cached playlist analysis so it doesn&apos;t wait on live Spotify requests.
          </div>
        )}

        {playlists.length === 0 ? (
          <div className="glass-panel rounded-[30px] p-8 text-sm text-ink/75">
            No cached playlists are available yet. Open Spotify from one of your playlists and refresh the dashboard once so Listening Lore can store your library and analysis locally.
          </div>
        ) : filteredPlaylists.length === 0 ? (
          <div className="glass-panel rounded-[30px] p-8 text-sm text-ink/75">
            No playlists matched &quot;{searchQuery}&quot;.
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-4 text-sm text-[var(--theme-muted)]">
              <p>
                Showing {startIndex + 1}-{Math.min(startIndex + PLAYLISTS_PER_PAGE, filteredPlaylists.length)} of {filteredPlaylists.length}
                {searchQuery ? ` matching "${searchQuery}"` : " playlists"}
              </p>
              <p>Page {currentPage} of {totalPages}</p>
            </div>

            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {pagePlaylists.map((playlist) => (
                <Link
                  key={`${playlist.id ?? playlist.name}`}
                  href={playlist.id ? `/dashboard/playlists/${playlist.id}` : "/dashboard"}
                  prefetch={false}
                  className="glass-panel rounded-[32px] p-6 text-[var(--theme-text)] transition hover:border-cyan/40 hover:bg-white/[0.05]"
                >
                  <div className="space-y-4">
                    <div className="space-y-4">
                      {playlist.imageUrl ? (
                        <div className="media-frame relative aspect-square p-2">
                          <Image src={playlist.imageUrl} alt={playlist.name} fill sizes="(max-width: 1280px) 100vw, 420px" className="rounded-[22px] object-cover" />
                          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(72,24,110,0.12)_42%,rgba(72,24,110,0.3))]" />
                        </div>
                      ) : (
                        <div className="media-frame flex aspect-square items-center justify-center p-3 font-mono text-xl uppercase tracking-[0.16em] text-[var(--theme-muted)]">
                          Mix
                        </div>
                      )}
                      <div className="desktop-card min-h-[9rem] p-4 md:min-h-[10rem]">
                        <p className="section-kicker">Playlist insight</p>
                        <h2 className={`mt-3 font-display uppercase text-[var(--theme-title)] ${getAdaptivePlaylistTitleClass(playlist.name)}`}>
                          {playlist.name}
                        </h2>
                      </div>
                      <div className="desktop-card p-4">
                        {playlist.trackCount ? <p className="text-sm text-cyan">{playlist.trackCount} tracks analyzed</p> : null}
                        <div className={`space-y-1 text-xs text-[var(--theme-muted)] ${playlist.trackCount ? "mt-3" : ""}`}>
                          <p>Created: {formatDateLabel(playlist.createdAt)}</p>
                          <p>Last listened: {formatDateLabel(playlist.lastListenedAt)}</p>
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-4">
                      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                        <p className="text-sm text-[var(--theme-muted)]">Mood</p>
                        <p className="mt-2 text-[var(--theme-text)]">{playlist.mood}</p>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                        <p className="text-sm text-[var(--theme-muted)]">Top genres</p>
                        <p className="mt-2 text-[var(--theme-text)]">{playlist.topGenresSummary ?? playlist.diversity}</p>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                        <p className="text-sm text-[var(--theme-muted)]">Listening cadence</p>
                        <p className="mt-2 text-[var(--theme-text)]">{playlist.listeningCadence ?? playlist.overlap}</p>
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>

            <Pager currentPage={currentPage} totalPages={totalPages} sort={selectedSort} query={searchQuery} />
          </>
        )}
      </div>
    </main>
  );
}
