import Image from "next/image";
import Link from "next/link";
import { hasSpotifyConnection, requireSession, requireSpotifySession } from "@/lib/auth";
import { getStoredPlaylistsSection } from "@/lib/dashboard-section-cache";
import { getPublicSpotifyProfileInsights } from "@/lib/spotify-public";
import { getPlaylistPageDataFromHistory } from "@/lib/spotify-playlists";
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
  const { sort, refreshed, refresh_error: refreshError } = await searchParams;
  const session = await requireSession();
  const spotifyConnected = hasSpotifyConnection(session);
  const selectedSort = normalizeSort(sort);

  if (!spotifyConnected) {
    const publicInsights = session.spotifyUserId
      ? await getPublicSpotifyProfileInsights(session.spotifyUserId, session.spotifyProfileUrl).catch(() => null)
      : null;
    const publicPlaylists = publicInsights?.playlistInsights ?? [];

    return (
      <main className="relative min-h-screen overflow-hidden px-6 py-10 md:px-10">
        <div className="mx-auto max-w-7xl space-y-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm uppercase tracking-[0.32em] text-cyan/70">Public Playlist Lab</p>
              <h1 className="mt-3 font-display text-4xl text-[var(--theme-title)] md:text-5xl">Visible playlists from your public Spotify profile</h1>
              <p className="mt-3 max-w-2xl text-base leading-7 text-[var(--theme-body)]">
                This page analyzes public playlists only. It can show structure, genres, mood, and track makeup, but not private listening-history signals.
              </p>
            </div>
            <div className="flex gap-3">
              <Link href="/dashboard" prefetch={false} className="rounded-full border border-[rgba(57,18,98,0.16)] bg-white/[0.18] px-4 py-2 text-sm text-[var(--theme-text)]">
                Back to dashboard
              </Link>
            </div>
          </div>

          <div className="rounded-[24px] border border-cyan/20 bg-cyan/10 px-5 py-4 text-sm text-[var(--theme-body)]">
            Public playlist analysis uses only playlist contents that Spotify exposes publicly from your profile.
          </div>

          {publicPlaylists.length === 0 ? (
            <div className="glass-panel rounded-[30px] p-8 text-sm leading-7 text-[var(--theme-body)]">
              No public playlists were available from this Spotify profile.
            </div>
          ) : (
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {publicPlaylists.map((playlist) => (
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
                href={`/dashboard/playlists?sort=${option.key}`}
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
        ) : (
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {playlists.map((playlist) => (
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
        )}
      </div>
    </main>
  );
}


