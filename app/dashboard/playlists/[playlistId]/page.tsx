import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAuthorizedSession, requireSession } from "@/lib/auth";
import { getPlaylistDetail } from "@/lib/spotify-playlists";

type PlaylistDetailPageProps = {
  params: Promise<{ playlistId: string }>;
};

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

export default async function PlaylistDetailPage({ params }: PlaylistDetailPageProps) {
  const session = await requireSession();

  if (!session) {
    redirect("/login");
  }

  const authorizedSession = await getAuthorizedSession(session);

  const { playlistId } = await params;
  const detail = await getPlaylistDetail(authorizedSession.accessToken, authorizedSession.spotifyUserId, playlistId);

  if (!detail) {
    notFound();
  }

  return (
    <main className="relative min-h-screen overflow-hidden px-6 py-10 md:px-10">
      <div className="mx-auto max-w-7xl space-y-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            {detail.imageUrl ? (
              <div className="relative h-36 w-36 overflow-hidden rounded-[32px] border border-white/10 bg-white/5">
                <Image src={detail.imageUrl} alt={detail.name} fill sizes="144px" className="object-contain bg-white/[0.2]" />
              </div>
            ) : null}
            <div>
              <p className="text-sm uppercase tracking-[0.32em] text-cyan/70">Playlist Lab</p>
              <h1 className="mt-3 font-display text-4xl text-white md:text-5xl">{detail.name}</h1>
              <p className="mt-3 max-w-2xl text-base leading-7 text-ink/80">
                {detail.ownerName ? `Curated by ${detail.ownerName}. ` : ""}
                This view breaks down the playlist&apos;s mood center, diversity, repetition patterns, and timeline signals.
              </p>
              <div className="mt-4 space-y-1 text-sm text-ink/65">
                <p>Created estimate: {formatDateLabel(detail.createdAt)}</p>
                <p>Last listened estimate: {formatDateLabel(detail.lastListenedAt)}</p>
              </div>
            </div>
          </div>
          <div className="flex gap-3">
            <Link href="/dashboard/playlists" className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white">
              All playlists
            </Link>
            <Link href="/dashboard" className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white">
              Dashboard
            </Link>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="glass-panel rounded-[28px] p-5">
            <p className="text-sm text-ink/60">Tracks analyzed</p>
            <p className="mt-4 font-display text-3xl text-white">{detail.trackCount}</p>
          </div>
          <div className="glass-panel rounded-[28px] p-5">
            <p className="text-sm text-ink/60">Unique artists</p>
            <p className="mt-4 font-display text-3xl text-white">{detail.uniqueArtistCount}</p>
          </div>
          <div className="glass-panel rounded-[28px] p-5">
            <p className="text-sm text-ink/60">Unique albums</p>
            <p className="mt-4 font-display text-3xl text-white">{detail.uniqueAlbumCount}</p>
          </div>
          <div className="glass-panel rounded-[28px] p-5">
            <p className="text-sm text-ink/60">Mood center</p>
            <p className="mt-4 font-display text-2xl text-white">{detail.mood}</p>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-3">
          <div className="glass-panel rounded-[30px] p-6">
            <p className="text-sm uppercase tracking-[0.24em] text-cyan/70">Genre diversity</p>
            <p className="mt-3 text-white">{detail.diversity}</p>
            <div className="mt-6 space-y-3">
              {detail.topGenres.map((genre) => (
                <div key={genre.genre} className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                  <p className="text-white">{genre.genre}</p>
                  <p className="text-sm text-cyan">{genre.count}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="glass-panel rounded-[30px] p-6">
            <p className="text-sm uppercase tracking-[0.24em] text-cyan/70">Artist concentration</p>
            <p className="mt-3 text-white">{detail.overlap}</p>
            <div className="mt-6 space-y-3">
              {detail.topArtists.map((artist) => (
                <div key={artist.artist} className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                  <p className="text-white">{artist.artist}</p>
                  <p className="text-sm text-cyan">{artist.count}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="glass-panel rounded-[30px] p-6">
            <p className="text-sm uppercase tracking-[0.24em] text-cyan/70">Repeated tracks</p>
            <p className="mt-3 text-white">
              {detail.repeatedTracks.length > 0 ? "Tracks that appear more than once in this playlist." : "No duplicate tracks detected in the analyzed slice."}
            </p>
            <div className="mt-6 space-y-3">
              {(detail.repeatedTracks.length > 0 ? detail.repeatedTracks : detail.sampleTracks.slice(0, 3)).map((track) => (
                <div key={track.id} className="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                  {track.imageUrl ? (
                    <div className="relative h-16 w-16 overflow-hidden rounded-2xl border border-white/10 bg-white/5">
                      <Image src={track.imageUrl} alt={track.title} fill sizes="64px" className="object-contain bg-white/[0.2]" />
                    </div>
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-white">{track.title}</p>
                    <p className="truncate text-sm text-ink/65">{track.artist}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="glass-panel rounded-[32px] p-6">
          <p className="text-sm uppercase tracking-[0.24em] text-cyan/70">Sample tracks</p>
          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {detail.sampleTracks.map((track) => (
              <div key={track.id} className="flex items-center gap-4 rounded-[24px] border border-white/10 bg-white/[0.03] p-4">
                {track.imageUrl ? (
                  <div className="relative h-20 w-20 overflow-hidden rounded-[24px] border border-white/10 bg-white/5">
                    <Image src={track.imageUrl} alt={track.title} fill sizes="80px" className="object-contain bg-white/[0.2]" />
                  </div>
                ) : null}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-white">{track.title}</p>
                  <p className="truncate text-sm text-ink/65">{track.artist}</p>
                  <p className="truncate text-xs uppercase tracking-[0.18em] text-ink/50">{track.album}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}



