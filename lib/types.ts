export type DashboardRange = "week" | "month" | "all";
export type TopListRange = "week" | "month" | "year" | "all" | "custom";
export type SpotifyTimeRange = "short_term" | "medium_term" | "long_term";
export type PlaylistSortOption = "created_desc" | "created_asc" | "last_listened_desc" | "last_listened_asc";
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

export type MoodHeatmapCell = {
  period: string;
  mood: string;
  intensity: number;
  minutes: number;
};

export type FavoriteTrack = {
  title: string;
  artist: string;
  album: string;
  lastPlayed: string;
  affinity: number;
  imageUrl?: string;
  savedAt?: string;
  reason?: string;
};

export type GenrePulse = {
  genre: string;
  hours: number;
  color: string;
};

export type PlaylistInsight = {
  id?: string;
  name: string;
  mood: string;
  diversity: string;
  overlap: string;
  imageUrl?: string;
  trackCount?: number;
  createdAt?: string;
  lastListenedAt?: string;
};

export type PlaylistGenreSummary = {
  genre: string;
  count: number;
};

export type PlaylistArtistSummary = {
  artist: string;
  count: number;
};

export type PlaylistTrackSummary = {
  id: string;
  title: string;
  artist: string;
  album: string;
  imageUrl?: string;
};

export type PlaylistDetail = {
  id: string;
  name: string;
  imageUrl?: string;
  ownerName?: string;
  trackCount: number;
  uniqueArtistCount: number;
  uniqueAlbumCount: number;
  mood: string;
  diversity: string;
  overlap: string;
  createdAt?: string;
  lastListenedAt?: string;
  topGenres: PlaylistGenreSummary[];
  topArtists: PlaylistArtistSummary[];
  repeatedTracks: PlaylistTrackSummary[];
  sampleTracks: PlaylistTrackSummary[];
};

export type DashboardInsights = {
  statCards: StatCard[];
  trendData: TrendPoint[];
  trendHeading: string;
  trendBadge: string;
  genrePulse: GenrePulse[];
  moodData: MoodPoint[];
  moodHeatmap: MoodHeatmapCell[];
  forgottenFavorites: FavoriteTrack[];
  quietSavedTracks: FavoriteTrack[];
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
  range: TopListRange;
  artists: TopListArtist[];
  tracks: TopListTrack[];
  albums: TopListAlbum[];
  sourceLabel: string;
  generatedAt?: string;
  from?: string;
  to?: string;
};

export type DashboardAnalysisEntry = {
  trackId: string;
  title: string;
  artist: string;
  album: string;
  imageUrl?: string;
  playedAt: string;
  durationMs: number;
  mood?: string;
  period?: string;
};

export type DashboardAnalysisDetail = {
  section: "trend" | "heatmap";
  title: string;
  subtitle: string;
  range: DashboardRange;
  entries: DashboardAnalysisEntry[];
};
export type RecentTrackSummary = {
  trackId: string;
  title: string;
  artist: string;
  album: string;
  imageUrl?: string;
  playedAt: string;
};

export type NowPlayingState = {
  isPlaying: boolean;
  progressMs?: number;
  track?: {
    id: string;
    title: string;
    artist: string;
    album: string;
    imageUrl?: string;
    durationMs: number;
  };
  playingFrom?: {
    type: string;
    label: string;
    playlistId?: string;
    imageUrl?: string;
  };
  recentTracks?: RecentTrackSummary[];
  syncedRecentCount?: number;
  syncedAt?: string;
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
    id?: string;
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

export type SpotifyPlaybackContext = {
  type?: string;
  uri?: string;
  href?: string | null;
};

export type SpotifyCurrentlyPlayingResponse = {
  is_playing: boolean;
  progress_ms?: number;
  item?: SpotifyTrack | null;
  context?: SpotifyPlaybackContext | null;
};

export type SpotifyRecentlyPlayedItem = {
  track: SpotifyTrack;
  played_at: string;
  context?: SpotifyPlaybackContext | null;
};

export type SpotifyRecentlyPlayedResponse = {
  items: SpotifyRecentlyPlayedItem[];
};

export type StoredRecentPlay = {
  spotifyUserId: string;
  trackId: string;
  playedAt: string;
  trackName: string;
  artistName: string;
  albumName: string;
  imageUrl?: string;
  playlistId?: string;
  playlistName?: string;
  sourceType?: string;
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

export type SpotifyPlaylist = {
  id: string;
  name: string;
  images?: SpotifyImage[];
  tracks: {
    total: number;
    href?: string;
  };
  owner?: {
    display_name?: string;
  };
};

export type SpotifyPlaylistsResponse = {
  items: SpotifyPlaylist[];
  next: string | null;
  total: number;
  limit: number;
  offset: number;
};

export type SpotifyPlaylistTrackItem = {
  added_at?: string;
  track: SpotifyTrack | null;
};

export type SpotifyPlaylistTracksResponse = {
  items: SpotifyPlaylistTrackItem[];
  next: string | null;
  total: number;
  limit: number;
  offset: number;
};

export type SpotifyDashboardSnapshot = {
  spotifyUserId: string;
  topArtists: SpotifyTopArtistsResponse["items"];
  topTracks: SpotifyTopTracksResponse["items"];
  mediumTermTopArtists?: SpotifyTopArtistsResponse["items"];
  mediumTermTopTracks?: SpotifyTopTracksResponse["items"];
  longTermTopArtists?: SpotifyTopArtistsResponse["items"];
  longTermTopTracks?: SpotifyTopTracksResponse["items"];
  savedTracks?: SpotifySavedTrackItem[];
  recent: SpotifyRecentlyPlayedItem[];
  fetchedAt: string;
};



