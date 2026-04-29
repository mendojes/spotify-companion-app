import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { hasSpotifyConnection, requireSession, requireSpotifySession } from "@/lib/auth";
import { getPublicSpotifyProfileInsights } from "@/lib/spotify-public";
import { getPlaylistDetailFromHistory, getStoredPlaylistLibrary } from "@/lib/spotify-playlists";
import { PlaylistDetail } from "@/lib/types";
import { PlaylistDetailView } from "./playlist-detail-view";
import { PlaylistDetailSync } from "./playlist-detail-sync";
import { PublicPlaylistDetailRefresh } from "./public-playlist-detail-refresh";
import { formatPstDateTime } from "@/lib/time";

type PlaylistDetailPageProps = {
  params: Promise<{ playlistId: string }>;
};

function formatDateLabel(value?: string) {
  return formatPstDateTime(value);
}

function buildPendingPublicDetail(args: {
  playlistId: string;
  name: string;
  imageUrl?: string;
  ownerName?: string;
  trackCount: number;
}): PlaylistDetail {
  return {
    id: args.playlistId,
    name: args.name,
    imageUrl: args.imageUrl,
    ownerName: args.ownerName,
    trackCount: args.trackCount,
    uniqueArtistCount: 0,
    uniqueAlbumCount: 0,
    mood: "Analysis pending",
    diversity: "Preparing genre analysis",
    overlap: "Preparing overlap analysis",
    listeningCadence: "Preparing cadence analysis",
    createdAt: undefined,
    lastListenedAt: undefined,
    topGenres: [],
    topArtists: [],
    repeatedTracks: [],
    sampleTracks: [],
    topTracks: [],
    listenTimeline: [],
  };
}

export default async function PlaylistDetailPage({ params }: PlaylistDetailPageProps) {
  const { playlistId } = await params;
  const session = await requireSession();

  if (!hasSpotifyConnection(session)) {
    const [storedPlaylists, storedDetail] = await Promise.all([
      session.spotifyUserId
        ? getStoredPlaylistLibrary(session.spotifyUserId).catch(
            () => [] as Awaited<ReturnType<typeof getStoredPlaylistLibrary>>,
          )
        : Promise.resolve([] as Awaited<ReturnType<typeof getStoredPlaylistLibrary>>),
      session.spotifyUserId
        ? getPlaylistDetailFromHistory(session.spotifyUserId, playlistId).catch(() => null)
        : Promise.resolve(null),
    ]);

    const publicInsights = session.spotifyUserId
      ? await getPublicSpotifyProfileInsights(
          session.spotifyUserId,
          session.spotifyProfileUrl,
        ).catch(() => null)
      : null;

    const libraryPlaylist =
      publicInsights?.publicPlaylists.find((playlist) => playlist.id === playlistId) ??
      storedPlaylists.find((playlist) => playlist.id === playlistId);

    const visiblePlaylistIds = new Set([
      ...(publicInsights?.publicPlaylists ?? []).map((playlist) => playlist.id),
      ...storedPlaylists.map((playlist) => playlist.id),
    ]);

    if (visiblePlaylistIds.size > 0 && !visiblePlaylistIds.has(playlistId)) {
      notFound();
    }

    const detail =
      storedDetail ??
      (libraryPlaylist
        ? buildPendingPublicDetail({
            playlistId: libraryPlaylist.id,
            name: libraryPlaylist.name,
            imageUrl: libraryPlaylist.images?.[0]?.url,
            ownerName: libraryPlaylist.owner?.display_name ?? libraryPlaylist.owner?.id,
            trackCount: libraryPlaylist.tracks?.total ?? 0,
          })
        : null);

    if (!detail) {
      notFound();
    }

    const shouldRefreshDetail =
      !storedDetail ||
      detail.mood.toLowerCase().includes("pending") ||
      detail.topGenres.length === 0;

    return (
      <main className="relative min-h-screen overflow-hidden px-6 py-10 md:px-10">
        <PublicPlaylistDetailRefresh
          playlistId={playlistId}
          shouldRefresh={Boolean(session.spotifyUserId && shouldRefreshDetail)}
        />

        <div className="mx-auto max-w-7xl space-y-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-6">
              {detail.imageUrl ? (
                <div className="relative h-36 w-36 overflow-hidden rounded-[32px] border border-white/10 bg-white/5">
                  <Image
                    src={detail.imageUrl}
                    alt={detail.name}
                    fill
                    sizes="144px"
                    className="object-contain bg-white/[0.2]"
                  />
                </div>
              ) : null}
              <div>
                <p className="text-sm uppercase tracking-[0.32em] text-cyan/70">
                  Public Playlist Lab
                </p>
                <h1 className="mt-3 font-display text-4xl text-[var(--theme-title)] md:text-5xl">
                  {detail.name}
                </h1>
                <p className="mt-3 max-w-2xl text-base leading-7 text-[var(--theme-body)]">
                  {detail.ownerName ? `Curated by ${detail.ownerName}. ` : ""}
                  {storedDetail
                    ? "This playlist is being shown from Listening Lore's cached public playlist analysis."
                    : "This playlist is being staged for cached analysis now. Once the track, artist, and insight stages finish, this page will refresh automatically."}
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <Link
                href="/dashboard/playlists"
                className="rounded-full border border-[rgba(57,18,98,0.16)] bg-white/[0.18] px-4 py-2 text-sm text-[var(--theme-text)]"
              >
                All playlists
              </Link>
              <Link
                href="/dashboard"
                className="rounded-full border border-[rgba(57,18,98,0.16)] bg-white/[0.18] px-4 py-2 text-sm text-[var(--theme-text)]"
              >
                Dashboard
              </Link>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="glass-panel rounded-[28px] p-5">
              <p className="text-sm text-[var(--theme-muted)]">Tracks analyzed</p>
              <p className="mt-4 font-display text-3xl text-[var(--theme-title)]">
                {detail.trackCount}
              </p>
            </div>
            <div className="glass-panel rounded-[28px] p-5">
              <p className="text-sm text-[var(--theme-muted)]">Unique artists</p>
              <p className="mt-4 font-display text-3xl text-[var(--theme-title)]">
                {detail.uniqueArtistCount}
              </p>
            </div>
            <div className="glass-panel rounded-[28px] p-5">
              <p className="text-sm text-[var(--theme-muted)]">Mood center</p>
              <p className="mt-4 font-display text-2xl text-[var(--theme-title)]">
                {detail.mood}
              </p>
            </div>
          </div>

          {!storedDetail ? (
            <div className="rounded-[24px] border border-cyan/20 bg-cyan/10 px-5 py-4 text-sm text-[var(--theme-body)]">
              Public playlist detail analysis is running in stages: playlist tracks are cached first, then artist metadata is resolved from Mongo and Spotify only when missing, and only then is the final analysis computed and stored.
            </div>
          ) : null}

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
