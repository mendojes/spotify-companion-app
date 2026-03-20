export type DashboardRange = "week" | "month" | "all";
export type SpotifyTimeRange = "short_term" | "medium_term" | "long_term";
export type Timeframe = "This Week" | "This Month" | "All Time";

export type StatCard = {
  label: string;
  value: string;
  delta: string;
};

export type TrendPoint = {
  label: string;
  minutes: number;
  rediscovered: number;
};

export type MoodPoint = {
  mood: string;
  share: number;
  energy: number;
};

export type FavoriteTrack = {
  title: string;
  artist: string;
  album: string;
  lastPlayed: string;
  affinity: number;
  imageUrl?: string;
};

export type GenrePulse = {
  genre: string;
  hours: number;
  color: string;
};

export type PlaylistInsight = {
  name: string;
  mood: string;
  diversity: string;
  overlap: string;
};

export type DashboardInsights = {
  statCards: StatCard[];
  trendData: TrendPoint[];
  trendHeading: string;
  trendBadge: string;
  genrePulse: GenrePulse[];
  moodData: MoodPoint[];
  forgottenFavorites: FavoriteTrack[];
  playlistInsights: PlaylistInsight[];
  sourceLabel: string;
  moodSource: string;
  cachedAt?: string;
  snapshotCount?: number;
  range: DashboardRange;
};

export type TopListArtist = {
  id: string;
  rank: number;
  name: string;
  genres: string[];
  imageUrl?: string;
};

export type TopListTrack = {
  id: string;
  rank: number;
  title: string;
  artist: string;
  album: string;
  popularity: number;
  imageUrl?: string;
};

export type TopListAlbum = {
  id: string;
  rank: number;
  name: string;
  artist: string;
  trackCount: number;
  score: number;
  imageUrl?: string;
};

export type TopListsData = {
  range: SpotifyTimeRange;
  artists: TopListArtist[];
  tracks: TopListTrack[];
  albums: TopListAlbum[];
  sourceLabel: string;
  generatedAt?: string;
};

type SpotifyImage = {
  url: string;
};

export type SpotifyArtist = {
  id: string;
  name: string;
  genres: string[];
  popularity: number;
  images?: SpotifyImage[];
};

export type SpotifyTrack = {
  id: string;
  name: string;
  popularity: number;
  duration_ms: number;
  album: {
    name: string;
    images?: SpotifyImage[];
  };
  artists: Array<{
    id?: string;
    name: string;
  }>;
};

export type SpotifyAudioFeature = {
  id: string;
  acousticness: number;
  danceability: number;
  energy: number;
  instrumentalness: number;
  speechiness: number;
  tempo: number;
  valence: number;
};

export type SpotifyAudioFeaturesResponse = {
  audio_features: Array<SpotifyAudioFeature | null>;
};

export type SpotifyTopArtistsResponse = {
  items: SpotifyArtist[];
};

export type SpotifyTopTracksResponse = {
  items: SpotifyTrack[];
};

export type SpotifyRecentlyPlayedItem = {
  track: SpotifyTrack;
  played_at: string;
};

export type SpotifyRecentlyPlayedResponse = {
  items: SpotifyRecentlyPlayedItem[];
};

export type SpotifySavedTrackItem = {
  added_at: string;
  track: SpotifyTrack;
};

export type SpotifySavedTracksResponse = {
  items: SpotifySavedTrackItem[];
  next: string | null;
  total: number;
  limit: number;
  offset: number;
};

export type SpotifyDashboardSnapshot = {
  spotifyUserId: string;
  topArtists: SpotifyTopArtistsResponse["items"];
  topTracks: SpotifyTopTracksResponse["items"];
  longTermTopTracks?: SpotifyTopTracksResponse["items"];
  savedTracks?: SpotifySavedTrackItem[];
  recent: SpotifyRecentlyPlayedItem[];
  fetchedAt: string;
};