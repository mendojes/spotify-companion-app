import {
  DashboardInsights,
  DashboardRange,
  FavoriteTrack,
  GenrePulse,
  MoodPoint,
  PlaylistInsight,
  SpotifyArtist,
  SpotifyAudioFeature,
  SpotifyAudioFeaturesResponse,
  SpotifyDashboardSnapshot,
  SpotifyRecentlyPlayedItem,
  SpotifyRecentlyPlayedResponse,
  SpotifySavedTrackItem,
  SpotifySavedTracksResponse,
  SpotifyTopArtistsResponse,
  SpotifyTopTracksResponse,
  StatCard,
  TrendPoint,
} from "@/lib/types";
import { spotifyFetch, spotifyFetchOptional } from "@/lib/spotify";
import { playlistInsights as mockPlaylistInsights } from "@/lib/mock-data";
import { getPlaylistInsights } from "@/lib/spotify-playlists";
import { getDatabase, hasMongoConfig } from "@/lib/mongodb";

const genreColors = ["#31E7FF", "#53F8B7", "#FFD166", "#FF6B6B", "#2B59FF"];
const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SNAPSHOT_REFRESH_TTL_MS = 1000 * 60 * 15;
const SNAPSHOT_HISTORY_COLLECTION = "spotify_snapshots_history";

function formatDuration(hours: number) {
  return `${hours.toFixed(1)}h`;
}

function hoursFromMs(durationMs: number) {
  return durationMs / 1000 / 60 / 60;
}

function daysSince(isoDate: string) {
  const diff = Date.now() - new Date(isoDate).getTime();
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
}

function titleKey(title: string, artist: string) {
  return `${title}::${artist}`.toLowerCase();
}

function isFresh(isoDate?: string, ttlMs = SNAPSHOT_REFRESH_TTL_MS) {
  if (!isoDate) {
    return false;
  }

  return Date.now() - new Date(isoDate).getTime() < ttlMs;
}

function getRangeWindow(range: DashboardRange) {
  const now = Date.now();

  if (range === "week") {
    return new Date(now - 1000 * 60 * 60 * 24 * 7);
  }

  if (range === "month") {
    return new Date(now - 1000 * 60 * 60 * 24 * 30);
  }

  return null;
}

function dedupeRecent(items: SpotifyRecentlyPlayedItem[]) {
  const seen = new Set<string>();
  const result: SpotifyRecentlyPlayedItem[] = [];

  for (const item of items) {
    const key = `${item.track.id}:${item.played_at}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }

  return result.sort((a, b) => new Date(b.played_at).getTime() - new Date(a.played_at).getTime());
}

function aggregateArtists(snapshots: SpotifyDashboardSnapshot[]) {
  const artistMap = new Map<string, SpotifyArtist & { score: number }>();

  snapshots.forEach((snapshot) => {
    snapshot.topArtists.forEach((artist, index) => {
      const existing = artistMap.get(artist.id) ?? { ...artist, score: 0 };
      existing.score += Math.max(1, 10 - index);
      existing.genres = [...new Set([...(existing.genres ?? []), ...artist.genres])];
      existing.popularity = Math.max(existing.popularity, artist.popularity);
      artistMap.set(artist.id, existing);
    });
  });

  return [...artistMap.values()].sort((a, b) => b.score - a.score);
}

function aggregateTracks(snapshots: SpotifyDashboardSnapshot[]) {
  const trackMap = new Map<string, { track: SpotifyDashboardSnapshot["topTracks"][number]; score: number }>();

  snapshots.forEach((snapshot) => {
    snapshot.topTracks.forEach((track, index) => {
      const existing = trackMap.get(track.id) ?? { track, score: 0 };
      existing.score += Math.max(1, 10 - index);
      trackMap.set(track.id, existing);
    });
  });

  return [...trackMap.values()].sort((a, b) => b.score - a.score).map((entry) => entry.track);
}

function deriveGenrePulse(topArtists: SpotifyArtist[]): GenrePulse[] {
  const scores = new Map<string, number>();

  topArtists.forEach((artist, index) => {
    const weight = Math.max(1, 10 - index);
    artist.genres.forEach((genre) => {
      scores.set(genre, (scores.get(genre) ?? 0) + weight);
    });
  });

  const total = [...scores.values()].reduce((sum, value) => sum + value, 0) || 1;

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([genre, score], index) => ({
      genre,
      hours: Number(((score / total) * 24).toFixed(1)),
      color: genreColors[index % genreColors.length],
    }));
}

function deriveMoodDataFromGenres(topArtists: SpotifyArtist[]) {
  const buckets = [
    { mood: "Energetic", energy: 84, matchers: ["dance", "house", "edm", "electro", "hyperpop", "punk"] },
    { mood: "Chill", energy: 38, matchers: ["ambient", "chill", "dream", "lo-fi", "indie pop"] },
    { mood: "Moody", energy: 47, matchers: ["sad", "emo", "singer-songwriter", "grunge", "melanch"] },
    { mood: "Joyful", energy: 69, matchers: ["pop", "funk", "disco", "soul", "groove"] },
    { mood: "Focus", energy: 56, matchers: ["classical", "instrumental", "study", "jazz", "soundtrack"] },
  ];

  const scores = new Map<string, number>(buckets.map((bucket) => [bucket.mood, 1]));

  topArtists.forEach((artist, index) => {
    const weight = Math.max(1, 10 - index);
    const joinedGenres = artist.genres.join(" ").toLowerCase();

    let matched = false;
    for (const bucket of buckets) {
      if (bucket.matchers.some((matcher) => joinedGenres.includes(matcher))) {
        scores.set(bucket.mood, (scores.get(bucket.mood) ?? 0) + weight);
        matched = true;
      }
    }

    if (!matched) {
      scores.set("Joyful", (scores.get("Joyful") ?? 0) + 1);
    }
  });

  const total = [...scores.values()].reduce((sum, value) => sum + value, 0) || 1;

  return {
    moodData: buckets.map((bucket) => ({
      mood: bucket.mood,
      share: Math.round(((scores.get(bucket.mood) ?? 0) / total) * 100),
      energy: bucket.energy,
    })),
    moodSource: "Genre-based fallback mood model",
  };
}

function deriveMoodDataFromAudioFeatures(audioFeatures: SpotifyAudioFeature[]) {
  if (audioFeatures.length === 0) {
    return null;
  }

  const total = audioFeatures.length;
  const energetic = audioFeatures.filter((track) => track.energy >= 0.72 || track.tempo >= 124).length;
  const chill = audioFeatures.filter((track) => track.energy < 0.45 && track.acousticness >= 0.35).length;
  const moody = audioFeatures.filter((track) => track.valence < 0.4 && track.energy < 0.65).length;
  const joyful = audioFeatures.filter((track) => track.valence >= 0.62 && track.danceability >= 0.55).length;
  const focus = audioFeatures.filter((track) => track.instrumentalness >= 0.35 || track.speechiness < 0.05).length;

  const averageEnergy = Math.round(audioFeatures.reduce((sum, track) => sum + track.energy, 0) / total * 100);
  const averageCalm = Math.round(audioFeatures.reduce((sum, track) => sum + (1 - track.energy), 0) / total * 100);
  const averageMoody = Math.round(audioFeatures.reduce((sum, track) => sum + ((1 - track.valence) * 0.7 + (1 - track.energy) * 0.3), 0) / total * 100);
  const averageJoy = Math.round(audioFeatures.reduce((sum, track) => sum + ((track.valence * 0.6) + (track.danceability * 0.4)), 0) / total * 100);
  const averageFocus = Math.round(audioFeatures.reduce((sum, track) => sum + ((track.instrumentalness * 0.65) + ((1 - track.speechiness) * 0.35)), 0) / total * 100);

  const moodData: MoodPoint[] = [
    { mood: "Energetic", share: Math.round((energetic / total) * 100), energy: averageEnergy },
    { mood: "Chill", share: Math.round((chill / total) * 100), energy: averageCalm },
    { mood: "Moody", share: Math.round((moody / total) * 100), energy: averageMoody },
    { mood: "Joyful", share: Math.round((joyful / total) * 100), energy: averageJoy },
    { mood: "Focus", share: Math.round((focus / total) * 100), energy: averageFocus },
  ];

  return {
    moodData,
    moodSource: "Spotify audio-features mood model",
  };
}

function deriveTrendData(recent: SpotifyRecentlyPlayedItem[]): TrendPoint[] {
  const grouped = new Map<number, { plays: number; uniqueArtists: Set<string> }>();

  recent.forEach((item) => {
    const day = new Date(item.played_at).getDay();
    const entry = grouped.get(day) ?? { plays: 0, uniqueArtists: new Set<string>() };
    entry.plays += 1;
    item.track.artists.forEach((artist) => entry.uniqueArtists.add(artist.name));
    grouped.set(day, entry);
  });

  return weekdayLabels.map((label, day) => ({
    label,
    minutes: grouped.get(day)?.plays ?? 0,
    rediscovered: grouped.get(day)?.uniqueArtists.size ?? 0,
  }));
}

function deriveForgottenFavorites(
  topTracks: SpotifyTopTracksResponse["items"],
  recent: SpotifyRecentlyPlayedItem[],
  longTermTopTracks: SpotifyTopTracksResponse["items"] = [],
  savedTracks: SpotifySavedTrackItem[] = [],
): FavoriteTrack[] {
  const recentMap = new Map<string, string>();
  recent.forEach((item) => {
    const key = titleKey(item.track.name, item.track.artists[0]?.name ?? "Unknown Artist");
    recentMap.set(key, item.played_at);
  });

  const candidateMap = new Map<string, {
    title: string;
    artist: string;
    album: string;
    popularity: number;
    sourceBoost: number;
    savedAt?: string;
    imageUrl?: string;
  }>();

  topTracks.forEach((track, index) => {
    const artist = track.artists[0]?.name ?? "Unknown Artist";
    candidateMap.set(track.id, {
      title: track.name,
      artist,
      album: track.album.name,
      popularity: track.popularity,
      sourceBoost: 18 + Math.max(0, 8 - index),
      imageUrl: track.album.images?.[0]?.url,
    });
  });

  longTermTopTracks.forEach((track, index) => {
    const artist = track.artists[0]?.name ?? "Unknown Artist";
    const existing = candidateMap.get(track.id);
    candidateMap.set(track.id, {
      title: track.name,
      artist,
      album: track.album.name,
      popularity: Math.max(existing?.popularity ?? 0, track.popularity),
      sourceBoost: Math.max(existing?.sourceBoost ?? 0, 24 + Math.max(0, 8 - index)),
      savedAt: existing?.savedAt,
      imageUrl: existing?.imageUrl ?? track.album.images?.[0]?.url,
    });
  });

  savedTracks.forEach((item, index) => {
    const track = item.track;
    const artist = track.artists[0]?.name ?? "Unknown Artist";
    const existing = candidateMap.get(track.id);
    candidateMap.set(track.id, {
      title: track.name,
      artist,
      album: track.album.name,
      popularity: Math.max(existing?.popularity ?? 0, track.popularity),
      sourceBoost: Math.max(existing?.sourceBoost ?? 0, 20 + Math.max(0, 12 - index)),
      savedAt: item.added_at,
      imageUrl: existing?.imageUrl ?? track.album.images?.[0]?.url,
    });
  });

  return [...candidateMap.entries()]
    .map(([, candidate]) => {
      const key = titleKey(candidate.title, candidate.artist);
      const recentPlay = recentMap.get(key);
      const recencyBoost = recentPlay ? Math.min(18, daysSince(recentPlay)) : 22;
      const libraryBoost = candidate.savedAt ? Math.min(12, Math.floor(daysSince(candidate.savedAt) / 30) + 4) : 0;
      const lastPlayed = recentPlay ? `${daysSince(recentPlay)} days ago` : "Not in recent listens";
      const affinity = Math.min(
        99,
        Math.max(70, Math.round(candidate.popularity * 0.58 + candidate.sourceBoost + recencyBoost + libraryBoost)),
      );

      return {
        title: candidate.title,
        artist: candidate.artist,
        album: candidate.album,
        lastPlayed,
        affinity,
        imageUrl: candidate.imageUrl,
        recentPlay,
      };
    })
    .sort((a, b) => Number(Boolean(a.recentPlay)) - Number(Boolean(b.recentPlay)) || b.affinity - a.affinity)
    .slice(0, 4)
    .map<FavoriteTrack>(({ recentPlay: _recentPlay, ...track }) => track);
}

function deriveStatCards(
  topArtists: SpotifyArtist[],
  topTracks: SpotifyTopTracksResponse["items"],
  recent: SpotifyRecentlyPlayedItem[],
  snapshotCount: number,
  range: DashboardRange,
): StatCard[] {
  const recentArtists = new Set(recent.flatMap((item) => item.track.artists.map((artist) => artist.name)));
  const totalHours = hoursFromMs(recent.reduce((sum, item) => sum + item.track.duration_ms, 0));
  const topArtist = topArtists[0];
  const topTrack = topTracks[0];
  const rangeLabel = range === "week" ? "7 days" : range === "month" ? "30 days" : "full history";

  return [
    {
      label: "Recent listening",
      value: formatDuration(totalHours),
      delta: `${recent.length} deduped plays in ${rangeLabel}`,
    },
    {
      label: "Top artist",
      value: topArtist?.name ?? "Unavailable",
      delta: topArtist?.genres[0] ?? "Aggregated from Spotify snapshots",
    },
    {
      label: "Top track",
      value: topTrack?.name ?? "Unavailable",
      delta: topTrack ? topTrack.artists.map((artist) => artist.name).join(", ") : "Waiting on Spotify data",
    },
    {
      label: "Snapshots stored",
      value: String(snapshotCount),
      delta: "Historical cache points available",
    },
  ];
}

async function deriveInsights(
  snapshots: SpotifyDashboardSnapshot[],
  range: DashboardRange,
  accessToken?: string,
  spotifyUserId?: string,
): Promise<DashboardInsights> {
  const sortedSnapshots = [...snapshots].sort(
    (a, b) => new Date(b.fetchedAt).getTime() - new Date(a.fetchedAt).getTime(),
  );
  const recent = dedupeRecent(sortedSnapshots.flatMap((snapshot) => snapshot.recent));
  const topArtists = aggregateArtists(sortedSnapshots);
  const topTracks = aggregateTracks(sortedSnapshots);
  const longTermTopTracks = sortedSnapshots.flatMap((snapshot) => snapshot.longTermTopTracks ?? []);
  const savedTracks = sortedSnapshots.flatMap((snapshot) => snapshot.savedTracks ?? []);
  const latestFetchedAt = sortedSnapshots[0]?.fetchedAt;

  let moodResult = deriveMoodDataFromGenres(topArtists);
  let playlistInsights = mockPlaylistInsights as PlaylistInsight[];

  if (accessToken) {
    const audioFeatureTrackIds = [...new Set([...topTracks, ...longTermTopTracks].map((track) => track.id))].slice(0, 50);

    const [audioFeatureResponse, livePlaylistInsights] = await Promise.all([
      audioFeatureTrackIds.length > 0
        ? spotifyFetchOptional<SpotifyAudioFeaturesResponse>(
            `/audio-features?ids=${audioFeatureTrackIds.join(",")}`,
            accessToken,
          )
        : Promise.resolve(null),
      spotifyUserId ? getPlaylistInsights(accessToken, spotifyUserId).catch(() => null) : Promise.resolve(null),
    ]);

    const features = audioFeatureResponse?.audio_features.filter((feature): feature is SpotifyAudioFeature => Boolean(feature)) ?? [];
    const fromAudio = deriveMoodDataFromAudioFeatures(features);
    if (fromAudio) {
      moodResult = fromAudio;
    }

    if (livePlaylistInsights && livePlaylistInsights.length > 0) {
      playlistInsights = livePlaylistInsights;
    }
  }

  return {
    statCards: deriveStatCards(topArtists, topTracks, recent, sortedSnapshots.length, range),
    trendData: deriveTrendData(recent),
    trendHeading: "Recent plays vs unique artists",
    trendBadge: `${sortedSnapshots.length} cached snapshot${sortedSnapshots.length === 1 ? "" : "s"}`,
    genrePulse: deriveGenrePulse(topArtists),
    moodData: moodResult.moodData,
    moodSource: moodResult.moodSource,
    forgottenFavorites: deriveForgottenFavorites(topTracks, recent, longTermTopTracks, savedTracks),
    playlistInsights,
    sourceLabel: hasMongoConfig()
      ? sortedSnapshots.length > 1
        ? "Historical Spotify cache with library depth"
        : "Live Spotify data with Mongo cache"
      : "Live Spotify data",
    cachedAt: latestFetchedAt,
    snapshotCount: sortedSnapshots.length,
    range,
  };
}

async function ensureIndexes() {
  if (!hasMongoConfig()) {
    return;
  }

  const db = await getDatabase();
  if (!db) {
    return;
  }

  await db.collection(SNAPSHOT_HISTORY_COLLECTION).createIndex({ spotifyUserId: 1, fetchedAt: -1 });
}

async function getHistoricalSnapshots(spotifyUserId: string, range: DashboardRange) {
  if (!hasMongoConfig()) {
    return [] as SpotifyDashboardSnapshot[];
  }

  const db = await getDatabase();
  if (!db) {
    return [] as SpotifyDashboardSnapshot[];
  }

  const windowStart = getRangeWindow(range);
  const query = windowStart
    ? { spotifyUserId, fetchedAt: { $gte: windowStart.toISOString() } }
    : { spotifyUserId };

  return db
    .collection<SpotifyDashboardSnapshot>(SNAPSHOT_HISTORY_COLLECTION)
    .find(query)
    .sort({ fetchedAt: -1 })
    .limit(range === "all" ? 180 : 60)
    .toArray();
}

async function getLatestSnapshot(spotifyUserId: string) {
  if (!hasMongoConfig()) {
    return null;
  }

  const db = await getDatabase();
  if (!db) {
    return null;
  }

  return db
    .collection<SpotifyDashboardSnapshot>(SNAPSHOT_HISTORY_COLLECTION)
    .find({ spotifyUserId })
    .sort({ fetchedAt: -1 })
    .limit(1)
    .next();
}

async function writeSnapshot(snapshot: SpotifyDashboardSnapshot) {
  if (!hasMongoConfig()) {
    return;
  }

  const db = await getDatabase();
  if (!db) {
    return;
  }

  await db.collection<SpotifyDashboardSnapshot>(SNAPSHOT_HISTORY_COLLECTION).insertOne(snapshot);
}

async function fetchSavedTracks(accessToken: string, limit = 50) {
  const items: SpotifySavedTrackItem[] = [];
  let offset = 0;

  while (items.length < limit) {
    const page = await spotifyFetch<SpotifySavedTracksResponse>(
      `/me/tracks?limit=50&offset=${offset}`,
      accessToken,
    );

    items.push(...page.items);

    if (!page.next || page.items.length === 0) {
      break;
    }

    offset += page.items.length;
    if (offset >= limit) {
      break;
    }
  }

  return items.slice(0, limit);
}

async function fetchSnapshot(accessToken: string, spotifyUserId: string): Promise<SpotifyDashboardSnapshot> {
  const [topArtists, topTracks, longTermTopTracks, recent, savedTracks] = await Promise.all([
    spotifyFetch<SpotifyTopArtistsResponse>("/me/top/artists?time_range=short_term&limit=10", accessToken),
    spotifyFetch<SpotifyTopTracksResponse>("/me/top/tracks?time_range=short_term&limit=10", accessToken),
    spotifyFetch<SpotifyTopTracksResponse>("/me/top/tracks?time_range=long_term&limit=20", accessToken),
    spotifyFetch<SpotifyRecentlyPlayedResponse>("/me/player/recently-played?limit=20", accessToken),
    fetchSavedTracks(accessToken, 100),
  ]);

  return {
    spotifyUserId,
    topArtists: topArtists.items,
    topTracks: topTracks.items,
    longTermTopTracks: longTermTopTracks.items,
    savedTracks,
    recent: recent.items,
    fetchedAt: new Date().toISOString(),
  };
}

export async function refreshDashboardSnapshot(accessToken: string, spotifyUserId: string) {
  await ensureIndexes();
  const snapshot = await fetchSnapshot(accessToken, spotifyUserId);
  await writeSnapshot(snapshot);
  return snapshot;
}

export async function getDashboardInsights(
  accessToken: string,
  spotifyUserId: string,
  range: DashboardRange,
): Promise<DashboardInsights> {
  await ensureIndexes();

  const latestSnapshot = await getLatestSnapshot(spotifyUserId);

  if (!latestSnapshot || !isFresh(latestSnapshot.fetchedAt)) {
    await refreshDashboardSnapshot(accessToken, spotifyUserId);
  }

  let snapshots = await getHistoricalSnapshots(spotifyUserId, range);

  if (snapshots.length === 0) {
    const fallbackLatest = await getLatestSnapshot(spotifyUserId);
    if (fallbackLatest) {
      snapshots = [fallbackLatest];
    }
  }

  if (snapshots.length === 0) {
    const snapshot = await refreshDashboardSnapshot(accessToken, spotifyUserId);
    snapshots = [snapshot];
  }

  return deriveInsights(snapshots, range, accessToken, spotifyUserId);
}
