import { DashboardInsights, TopListsData } from "@/lib/types";

export type SocialComparison = {
  sharedArtists: Array<{ name: string; yourRank?: number; theirRank?: number }>;
  sharedTracks: Array<{ title: string; artist: string; yourRank?: number; theirRank?: number }>;
  compatibilityScore: number;
  summary: string;
};

export function compareTopLists(yours: TopListsData | null, theirs: TopListsData | null): SocialComparison | null {
  if (!yours || !theirs) {
    return null;
  }

  const yourArtistMap = new Map(yours.artists.map((artist) => [artist.name.toLowerCase(), artist]));
  const yourTrackMap = new Map(yours.tracks.map((track) => [`${track.title}::${track.artist}`.toLowerCase(), track]));

  const sharedArtists = theirs.artists
    .filter((artist) => yourArtistMap.has(artist.name.toLowerCase()))
    .map((artist) => {
      const match = yourArtistMap.get(artist.name.toLowerCase());
      return {
        name: artist.name,
        yourRank: match?.rank,
        theirRank: artist.rank,
      };
    })
    .sort((a, b) => (a.yourRank ?? 99) + (a.theirRank ?? 99) - ((b.yourRank ?? 99) + (b.theirRank ?? 99)))
    .slice(0, 8);

  const sharedTracks = theirs.tracks
    .filter((track) => yourTrackMap.has(`${track.title}::${track.artist}`.toLowerCase()))
    .map((track) => {
      const match = yourTrackMap.get(`${track.title}::${track.artist}`.toLowerCase());
      return {
        title: track.title,
        artist: track.artist,
        yourRank: match?.rank,
        theirRank: track.rank,
      };
    })
    .sort((a, b) => (a.yourRank ?? 99) + (a.theirRank ?? 99) - ((b.yourRank ?? 99) + (b.theirRank ?? 99)))
    .slice(0, 8);

  const artistCoverage = Math.min(1, sharedArtists.length / Math.max(1, Math.min(yours.artists.length, theirs.artists.length)));
  const trackCoverage = Math.min(1, sharedTracks.length / Math.max(1, Math.min(yours.tracks.length, theirs.tracks.length)));
  const compatibilityScore = Math.round((artistCoverage * 0.6 + trackCoverage * 0.4) * 100);

  let summary = "Your listening overlap is still taking shape.";
  if (compatibilityScore >= 70) {
    summary = "You two are moving through a very similar pocket of music right now.";
  } else if (compatibilityScore >= 40) {
    summary = "There is solid overlap here, with a few clear shared anchors.";
  } else if (sharedArtists.length > 0 || sharedTracks.length > 0) {
    summary = "You have a few common favorites, but your rotations still feel pretty distinct.";
  }

  return {
    sharedArtists,
    sharedTracks,
    compatibilityScore,
    summary,
  };
}

export function getListeningSnapshotSummary(insights: DashboardInsights | null) {
  if (!insights) {
    return null;
  }

  const recentListening = insights.statCards.find((card) => card.label === "Recent listening");
  const topArtist = insights.statCards.find((card) => card.label === "Top artist");
  const topTrack = insights.statCards.find((card) => card.label === "Top track");

  return {
    recentListening: recentListening?.value,
    recentListeningDetail: recentListening?.delta,
    topArtist: topArtist?.value,
    topTrack: topTrack?.value,
    moodLeaders: [...insights.moodData].sort((a, b) => b.share - a.share).slice(0, 2),
    genrePulse: insights.genrePulse.slice(0, 3),
    snapshotCount: insights.snapshotCount,
    cachedAt: insights.cachedAt,
  };
}
