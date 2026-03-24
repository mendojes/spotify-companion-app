import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { getAllPlaylistInsights } from "@/lib/spotify-playlists";
import { PlaylistInsight, PlaylistSortOption } from "@/lib/types";

type PlaylistsPageProps = {
  searchParams: Promise<{ sort?: string }>;
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
  if (!value) {
    return "Unavailable";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown playlist error";
}

export default async function PlaylistsPage({ searchParams }: PlaylistsPageProps) {
  const session = await requireSession();

  if (!session) {
    redirect("/login");
  }

  const { sort } = await searchParams;
  const selectedSort = normalizeSort(sort);

  let playlists: PlaylistInsight[] = [];
  let error: string | null = null;

  try {
    playlists = await getAllPlaylistInsights(session.accessToken, session.spotifyUserId, selectedSort);
  } catch (caughtError) {
    error = `Playlist analysis could not be fully refreshed right now. Showing stored playlist data when available. (${getErrorMessage(caughtError)})`;
  }

  return (
    <main className="relative min-h-screen overflow-hidden px-6 py-10 md:px-10">
      <div className="mx-auto max-w-7xl space-y-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm uppercase tracking-[0.32em] text-cyan/70">Playlist Lab</p>
            <h1 className="mt-3 font-display text-4xl text-white md:text-5xl">All playlist breakdowns</h1>
            <p className="mt-3 max-w-2xl text-base leading-7 text-ink/80">
              Browse every playlist we can access, sort them by timeline signals, and open any one for deeper mood, genre, and overlap analysis.
            </p>
            <p className="mt-3 text-sm text-ink/60">
              Created is estimated from the oldest track add date we can see, and last listened only updates when Spotify gives us exact playlist playback context.
            </p>
          </div>
          <div className="flex gap-3">
            <Link href="/dashboard" className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white">
              Back to dashboard
            </Link>
            <a href="/api/auth/logout" className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm text-white">
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
                  active ? "bg-white text-slate-950" : "border border-white/10 bg-white/5 text-ink/80"
                }`}
              >
                {option.label}
              </Link>
            );
          })}
        </div>

        {error ? (
          <div className="rounded-[24px] border border-gold/30 bg-gold/10 px-5 py-4 text-sm text-ink/85">{error}</div>
        ) : null}

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
                className="glass-panel rounded-[30px] p-6 transition hover:border-cyan/40 hover:bg-white/[0.05]"
              >
                <div className="flex items-start gap-5">
                  {playlist.imageUrl ? (
                    <div className="relative h-28 w-28 shrink-0 overflow-hidden rounded-[24px] border border-white/10 bg-white/5">
                      <Image src={playlist.imageUrl} alt={playlist.name} fill sizes="112px" className="object-contain bg-white/[0.2]" />
                    </div>
                  ) : (
                    <div className="flex h-28 w-28 shrink-0 items-center justify-center rounded-[24px] border border-dashed border-white/15 bg-white/[0.04] text-xs uppercase tracking-[0.2em] text-ink/50">
                      Mix
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <h2 className="font-display text-2xl text-white">{playlist.name}</h2>
                    {playlist.trackCount ? <p className="mt-2 text-sm text-cyan">{playlist.trackCount} tracks analyzed</p> : null}
                    <div className="mt-4 space-y-1 text-xs text-ink/60">
                      <p>Created: {formatDateLabel(playlist.createdAt)}</p>
                      <p>Last listened: {formatDateLabel(playlist.lastListenedAt)}</p>
                    </div>
                  </div>
                </div>
                <div className="mt-6 space-y-4">
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <p className="text-sm text-ink/60">Mood consistency</p>
                    <p className="mt-2 text-white">{playlist.mood}</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <p className="text-sm text-ink/60">Genre diversity</p>
                    <p className="mt-2 text-white">{playlist.diversity}</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <p className="text-sm text-ink/60">Redundancy</p>
                    <p className="mt-2 text-white">{playlist.overlap}</p>
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
