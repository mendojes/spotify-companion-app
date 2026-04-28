import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { hasSpotifyConnection, requireSession, requireSpotifySession } from "@/lib/auth";
import { getPublicSpotifyPlaylistDetail, getPublicSpotifyProfileInsights } from "@/lib/spotify-public";
import { getPlaylistDetailFromHistory } from "@/lib/spotify-playlists";
import { PlaylistDetailView } from "./playlist-detail-view";
import { PlaylistDetailSync } from "./playlist-detail-sync";
import { formatPstDateTime } from "@/lib/time";

type PlaylistDetailPageProps = {
  params: Promise<{ playlistId: string }>;
};

function formatDateLabel(value?: string) {
  return formatPstDateTime(value);
}

export default async function PlaylistDetailPage({ params }: PlaylistDetailPageProps) {
  const { playlistId } = await params;
  const session = await requireSession();

  if (!hasSpotifyConnection(session)) {
    const publicInsights = session.spotifyUserId
      ? await getPublicSpotifyProfileInsights(session.spotifyUserId, session.spotifyProfileUrl).catch(() => null)
      : null;

    if (!publicInsights?.publicPlaylists.some((playlist) => playlist.id === playlistId)) {
      notFound();
    }

    const detail = await getPublicSpotifyPlaylistDetail(playlistId);

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
                <p className="text-sm uppercase tracking-[0.32em] text-cyan/70">Public Playlist Lab</p>
                <h1 className="mt-3 font-display text-4xl text-[var(--theme-title)] md:text-5xl">{detail.name}</h1>
                <p className="mt-3 max-w-2xl text-base leading-7 text-[var(--theme-body)]">
                  {detail.ownerName ? `Curated by ${detail.ownerName}. ` : ""}
                  This playlist is being analyzed from public Spotify playlist data only.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <Link href="/dashboard/playlists" className="rounded-full border border-[rgba(57,18,98,0.16)] bg-white/[0.18] px-4 py-2 text-sm text-[var(--theme-text)]">
                All playlists
              </Link>
              <Link href="/dashboard" className="rounded-full border border-[rgba(57,18,98,0.16)] bg-white/[0.18] px-4 py-2 text-sm text-[var(--theme-text)]">
                Dashboard
              </Link>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="glass-panel rounded-[28px] p-5">
              <p className="text-sm text-[var(--theme-muted)]">Tracks analyzed</p>
              <p className="mt-4 font-display text-3xl text-[var(--theme-title)]">{detail.trackCount}</p>
            </div>
            <div className="glass-panel rounded-[28px] p-5">
              <p className="text-sm text-[var(--theme-muted)]">Unique artists</p>
              <p className="mt-4 font-display text-3xl text-[var(--theme-title)]">{detail.uniqueArtistCount}</p>
            </div>
            <div className="glass-panel rounded-[28px] p-5">
              <p className="text-sm text-[var(--theme-muted)]">Mood center</p>
              <p className="mt-4 font-display text-2xl text-[var(--theme-title)]">{detail.mood}</p>
            </div>
          </div>

          <PlaylistDetailView detail={detail} mode="public" />
        </div>
      </main>
    );
  }

  const spotifySession = await requireSpotifySession("/dashboard/playlists");
  const detail = await getPlaylistDetailFromHistory(spotifySession.spotifyUserId, playlistId);

  if (!detail) {
    notFound();
  }

  const isAnalysisPending =
    detail.uniqueArtistCount === 0 ||
    detail.uniqueAlbumCount === 0 ||
    detail.mood.toLowerCase().includes("analysis pending");

  return (
    <main className="relative min-h-screen overflow-hidden px-6 py-10 md:px-10">
      <PlaylistDetailSync playlistId={playlistId} />
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
              <h1 className="mt-3 font-display text-4xl text-[var(--theme-title)] md:text-5xl">{detail.name}</h1>
              <p className="mt-3 max-w-2xl text-base leading-7 text-[var(--theme-body)]">
                {detail.ownerName ? `Curated by ${detail.ownerName}. ` : ""}
                This view breaks down the playlist&apos;s mood center, genre composition, repeat patterns, top tracks, and listening timeline.
              </p>
              <div className="mt-4 space-y-1 text-sm text-[var(--theme-muted)]">
                <p>Created estimate: {formatDateLabel(detail.createdAt)}</p>
                <p>Last listened estimate: {formatDateLabel(detail.lastListenedAt)}</p>
              </div>
            </div>
          </div>
          <div className="flex gap-3">
            <Link href="/dashboard/playlists" className="rounded-full border border-[rgba(57,18,98,0.16)] bg-white/[0.18] px-4 py-2 text-sm text-[var(--theme-text)]">
              All playlists
            </Link>
            <Link href="/dashboard" className="rounded-full border border-[rgba(57,18,98,0.16)] bg-white/[0.18] px-4 py-2 text-sm text-[var(--theme-text)]">
              Dashboard
            </Link>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="glass-panel rounded-[28px] p-5">
            <p className="text-sm text-[var(--theme-muted)]">Tracks analyzed</p>
            <p className="mt-4 font-display text-3xl text-[var(--theme-title)]">{detail.trackCount}</p>
          </div>
          <div className="glass-panel rounded-[28px] p-5">
            <p className="text-sm text-[var(--theme-muted)]">Unique artists</p>
            <p className="mt-4 font-display text-3xl text-[var(--theme-title)]">{detail.uniqueArtistCount}</p>
          </div>
          <div className="glass-panel rounded-[28px] p-5">
            <p className="text-sm text-[var(--theme-muted)]">Unique albums</p>
            <p className="mt-4 font-display text-3xl text-[var(--theme-title)]">{detail.uniqueAlbumCount}</p>
          </div>
          <div className="glass-panel rounded-[28px] p-5">
            <p className="text-sm text-[var(--theme-muted)]">Mood center</p>
            <p className="mt-4 font-display text-2xl text-[var(--theme-title)]">{detail.mood}</p>
          </div>
        </div>

        {isAnalysisPending ? (
          <div className="rounded-[24px] border border-cyan/20 bg-cyan/10 px-5 py-4 text-sm text-[var(--theme-body)]">
            Listening Lore tried to refresh this playlist from Spotify, but only partial stored analysis is available right now. Some sections may stay minimal until Spotify returns enough playlist metadata or you refresh the playlist snapshot again.
          </div>
        ) : (
          <div className="rounded-[24px] border border-cyan/20 bg-cyan/10 px-5 py-4 text-sm text-[var(--theme-body)]">
            This playlist page is using refreshed playlist analysis with stored fallback so it can stay populated even if Spotify is slow.
          </div>
        )}

        <PlaylistDetailView detail={detail} />
      </div>
    </main>
  );
}
