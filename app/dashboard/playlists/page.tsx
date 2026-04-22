import Image from "next/image";
import Link from "next/link";
import { requireSpotifySession } from "@/lib/auth";
import { getAllPlaylistInsightsFromHistory, getPlaylistLibraryStatus } from "@/lib/spotify-playlists";
import { PlaylistInsight, PlaylistSortOption } from "@/lib/types";
import { formatPstDateTime } from "@/lib/time";

type PlaylistsPageProps = {
  searchParams: Promise<{ sort?: string; refreshed?: string; refresh_error?: string }>;
};

const sortOptions: Array<{ key: PlaylistSortOption; label: string }> = [
  { key: "created_desc", label: "Created newest" },
  { key: "created_asc", label: "Created oldest" },
  { key: "last_listened_desc", label: "Last listened newest" },
  { key: "last_listened_asc", label: "Last listened oldest" },
];

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

export default async function PlaylistsPage({ searchParams }: PlaylistsPageProps) {
  const session = await requireSpotifySession("/dashboard/playlists");

  const { sort, refreshed, refresh_error: refreshError } = await searchParams;
  const selectedSort = normalizeSort(sort);

  let playlists: PlaylistInsight[] = [];
  let error: string | null = null;
  const libraryStatus = await getPlaylistLibraryStatus(session.spotifyUserId);

  try {
    playlists = await getAllPlaylistInsightsFromHistory(session.spotifyUserId, selectedSort);
  } catch (caughtError) {
    error = `Stored playlist analysis could not be loaded right now. Use Refresh snapshot to update playlist data. (${getErrorMessage(caughtError)})`;
  }

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
              <p>Stored playlists: {libraryStatus.playlistCount}</p>
              <p>Last playlist sync: {formatDateLabel(libraryStatus.lastSyncedAt)}</p>
            </div>
          </div>
          <div className="flex gap-3">
            <Link href="/dashboard" className="rounded-full border border-[rgba(57,18,98,0.16)] bg-white/[0.18] px-4 py-2 text-sm text-[var(--theme-text)]">
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
                href={`/dashboard/playlists?sort=${option.key}`}
                className={`rounded-full px-4 py-2 text-sm transition ${
                  active ? "bg-white text-slate-950" : "border border-[rgba(57,18,98,0.16)] bg-white/[0.18] text-[var(--theme-text)]"
                }`}
              >
                {option.label}
              </Link>
            );
          })}
        </div>

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
            No cached playlists are available yet. Open Spotify from one of your playlists and refresh the dashboard once so SoundScope can store your library and analysis locally.
          </div>
        ) : (
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {playlists.map((playlist) => (
              <Link
                key={`${playlist.id ?? playlist.name}`}
                href={playlist.id ? `/dashboard/playlists/${playlist.id}` : "/dashboard"}
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
        )}
      </div>
    </main>
  );
}


