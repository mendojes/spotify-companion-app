import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { getPlaylistDetailFromHistory } from "@/lib/spotify-playlists";
import { PlaylistDetailView } from "./playlist-detail-view";
import { formatPstDateTime } from "@/lib/time";

type PlaylistDetailPageProps = {
  params: Promise<{ playlistId: string }>;
};

function formatDateLabel(value?: string) {
  return formatPstDateTime(value);
}

export default async function PlaylistDetailPage({ params }: PlaylistDetailPageProps) {
  const session = await requireSession();

  if (!session) {
    redirect("/login");
  }

  const { playlistId } = await params;
  const detail = await getPlaylistDetailFromHistory(session.spotifyUserId, playlistId);

  if (!detail) {
    notFound();
  }

  const isAnalysisPending =
    detail.uniqueArtistCount === 0 ||
    detail.uniqueAlbumCount === 0 ||
    detail.mood.toLowerCase().includes("analysis pending");

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
                This view breaks down the playlist&apos;s mood center, genre composition, repeat patterns, top tracks, and listening timeline.
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

        {isAnalysisPending ? (
          <div className="rounded-[24px] border border-cyan/20 bg-cyan/10 px-5 py-4 text-sm text-ink/85">
            This playlist page is loading from stored cache only. Deeper analysis has not been computed yet, so some sections may stay minimal until you refresh SoundScope&apos;s stored playlist data.
          </div>
        ) : (
          <div className="rounded-[24px] border border-cyan/20 bg-cyan/10 px-5 py-4 text-sm text-ink/85">
            This playlist page is using stored playlist analysis so it can load without waiting on live Spotify requests.
          </div>
        )}

        <PlaylistDetailView detail={detail} />
      </div>
    </main>
  );
}
