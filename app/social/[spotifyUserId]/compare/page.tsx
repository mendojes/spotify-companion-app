import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { getCommunityUserProfile } from "@/lib/connected-users";
import { getDashboardInsights, getDashboardInsightsFromHistory } from "@/lib/spotify-dashboard";
import { getSpotifyTopLists, getSpotifyTopListsFromHistory } from "@/lib/spotify-toplists";
import { DashboardRange } from "@/lib/types";

type ComparePageProps = {
  params: Promise<{ spotifyUserId: string }>;
  searchParams: Promise<{ range?: string }>;
};

function normalizeRange(value?: string): DashboardRange {
  if (value === "month" || value === "all") return value;
  return "week";
}

export default async function SocialComparePage({ params, searchParams }: ComparePageProps) {
  const session = await requireSession();
  if (!session) redirect("/login");

  const { spotifyUserId } = await params;
  const { range } = await searchParams;
  const selectedRange = normalizeRange(range);

  const [profile, myInsights, theirInsights, myTopLists, theirTopLists] = await Promise.all([
    getCommunityUserProfile(spotifyUserId),
    getDashboardInsights(session.accessToken, session.spotifyUserId, selectedRange),
    getDashboardInsightsFromHistory(spotifyUserId, selectedRange),
    getSpotifyTopLists(session.accessToken, session.spotifyUserId, selectedRange === "month" ? "month" : selectedRange === "all" ? "all" : "week"),
    getSpotifyTopListsFromHistory(spotifyUserId, selectedRange === "month" ? "month" : selectedRange === "all" ? "all" : "week"),
  ]);

  if (!profile || !theirInsights || !theirTopLists) notFound();

  const myArtistNames = new Set(myTopLists.artists.map((artist) => artist.name.toLowerCase()));
  const sharedArtists = theirTopLists.artists.filter((artist) => myArtistNames.has(artist.name.toLowerCase())).slice(0, 5);
  const myGenres = new Set(myInsights.genrePulse.map((genre) => genre.genre.toLowerCase()));
  const sharedGenres = theirInsights.genrePulse.filter((genre) => myGenres.has(genre.genre.toLowerCase())).slice(0, 5);
  const myMood = [...myInsights.moodData].sort((a, b) => b.share - a.share)[0];
  const theirMood = [...theirInsights.moodData].sort((a, b) => b.share - a.share)[0];

  return (
    <main className="relative overflow-hidden px-6 py-10 md:px-10">
      <div className="mx-auto max-w-7xl space-y-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-3xl space-y-3">
            <p className="text-sm uppercase tracking-[0.3em] text-gold/75">Comparison</p>
            <h1 className="font-display text-5xl text-[var(--theme-title)] md:text-6xl">You vs {profile.displayName}</h1>
            <p className="text-base leading-7 text-ink/80">Compare your listening fingerprints across the current SoundScope range.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href={`/social/${spotifyUserId}`} className="rounded-full border border-ink/15 bg-white/5 px-4 py-2 text-sm text-ink transition hover:border-gold/25 hover:text-gold">Open their dashboard</Link>
            <Link href="/social" className="rounded-full border border-ink/15 bg-white/5 px-4 py-2 text-sm text-ink transition hover:border-gold/25 hover:text-gold">Back to community</Link>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="glass-panel rounded-[34px] p-6 text-[var(--theme-text)]">
            <p className="section-kicker">Shared taste</p>
            <h2 className="mt-2 font-display text-3xl text-[var(--theme-title)]">Overlap snapshot</h2>
            <div className="mt-6 grid gap-4 md:grid-cols-3">
              <div className="desktop-card p-4"><p className="font-mono text-sm uppercase tracking-[0.16em] text-[var(--theme-muted)]">Shared artists</p><p className="mt-2 font-display text-3xl text-[var(--theme-title)]">{sharedArtists.length}</p></div>
              <div className="desktop-card p-4"><p className="font-mono text-sm uppercase tracking-[0.16em] text-[var(--theme-muted)]">Shared genres</p><p className="mt-2 font-display text-3xl text-[var(--theme-title)]">{sharedGenres.length}</p></div>
              <div className="desktop-card p-4"><p className="font-mono text-sm uppercase tracking-[0.16em] text-[var(--theme-muted)]">Mood match</p><p className="mt-2 font-display text-3xl text-[var(--theme-title)]">{myMood?.mood === theirMood?.mood ? "High" : "Mixed"}</p></div>
            </div>
          </div>

          <div className="glass-panel rounded-[34px] p-6 text-[var(--theme-text)]">
            <p className="section-kicker">Current vibe</p>
            <h2 className="mt-2 font-display text-3xl text-[var(--theme-title)]">Mood comparison</h2>
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <div className="desktop-card p-4">
                <p className="font-mono text-sm uppercase tracking-[0.16em] text-[var(--theme-muted)]">You</p>
                <p className="mt-2 font-display text-3xl text-[var(--theme-title)]">{myMood?.mood ?? "Unknown"}</p>
                <p className="mt-2 text-sm text-[var(--theme-body)]">{myMood?.share ?? 0}% share</p>
              </div>
              <div className="desktop-card p-4">
                <p className="font-mono text-sm uppercase tracking-[0.16em] text-[var(--theme-muted)]">{profile.displayName}</p>
                <p className="mt-2 font-display text-3xl text-[var(--theme-title)]">{theirMood?.mood ?? "Unknown"}</p>
                <p className="mt-2 text-sm text-[var(--theme-body)]">{theirMood?.share ?? 0}% share</p>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="glass-panel rounded-[34px] p-6 text-[var(--theme-text)]">
            <p className="section-kicker">Shared artists</p>
            <div className="mt-6 space-y-4">
              {sharedArtists.length === 0 ? <div className="desktop-card p-4 text-[var(--theme-body)]">No shared top artists in this range yet.</div> : sharedArtists.map((artist) => (
                <div key={artist.id} className="desktop-card flex items-center gap-4 p-4">
                  {artist.imageUrl ? <div className="relative h-20 w-20 overflow-hidden rounded-[20px] border border-white/10 bg-white/5"><Image src={artist.imageUrl} alt={artist.name} fill sizes="80px" className="object-cover" /></div> : null}
                  <div><p className="font-display text-2xl text-[var(--theme-title)]">{artist.name}</p><p className="mt-1 text-sm text-[var(--theme-body)]">{artist.genres.slice(0, 2).join(" / ")}</p></div>
                </div>
              ))}
            </div>
          </div>

          <div className="glass-panel rounded-[34px] p-6 text-[var(--theme-text)]">
            <p className="section-kicker">Shared genres</p>
            <div className="mt-6 space-y-4">
              {sharedGenres.length === 0 ? <div className="desktop-card p-4 text-[var(--theme-body)]">No shared leading genres in this range yet.</div> : sharedGenres.map((genre) => (
                <div key={genre.genre} className="desktop-card flex items-center justify-between gap-4 p-4">
                  <p className="font-display text-2xl text-[var(--theme-title)]">{genre.genre}</p>
                  <p className="font-mono text-xl text-[var(--theme-highlight)]">{genre.hours}h</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
