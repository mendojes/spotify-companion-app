import {
  FavoriteTrack,
  GenrePulse,
  MoodHeatmapCell,
  MoodPoint,
  PlaylistInsight,
  StatCard,
  TopListsData,
  TrendPoint,
} from "@/lib/types";

export const heroStats: StatCard[] = [
  { label: "Top genre", value: "Alt-pop", delta: "+18% vs last month" },
  { label: "Rediscovered tracks", value: "27", delta: "8 played this week" },
  { label: "Mood swing", value: "Dreamwash -> Adrenaline Rush", delta: "Friday spikes after 8 PM" },
];

export const dashboardStats: StatCard[] = [
  { label: "Listening time", value: "31.4h", delta: "+5.2h this week" },
  { label: "Unique artists", value: "86", delta: "12 new this month" },
  { label: "Saved songs revisited", value: "41%", delta: "+9% retention" },
  { label: "Most active session", value: "Late-night focus", delta: "Tue/Thu 10 PM" },
];

export const trendData: TrendPoint[] = [
  { label: "Mon", minutes: 124, rediscovered: 2 },
  { label: "Tue", minutes: 198, rediscovered: 3 },
  { label: "Wed", minutes: 141, rediscovered: 1 },
  { label: "Thu", minutes: 218, rediscovered: 4 },
  { label: "Fri", minutes: 264, rediscovered: 5 },
  { label: "Sat", minutes: 186, rediscovered: 3 },
  { label: "Sun", minutes: 152, rediscovered: 2 },
];

export const moodData: MoodPoint[] = [
  { mood: "Adrenaline Rush", share: 22, energy: 86 },
  { mood: "Neon Drift", share: 15, energy: 59 },
  { mood: "Dreamwash", share: 16, energy: 34 },
  { mood: "Melancholy Glow", share: 11, energy: 43 },
  { mood: "Bright Pulse", share: 14, energy: 72 },
  { mood: "Flow State", share: 8, energy: 50 },
  { mood: "Cathartic", share: 8, energy: 69 },
  { mood: "Swagger", share: 6, energy: 66 },
];
export const moodHeatmap: MoodHeatmapCell[] = [
  { period: "Morning", mood: "Flow State", intensity: 88, minutes: 72 },
  { period: "Morning", mood: "Dreamwash", intensity: 66, minutes: 54 },
  { period: "Morning", mood: "Bright Pulse", intensity: 44, minutes: 32 },
  { period: "Morning", mood: "Adrenaline Rush", intensity: 28, minutes: 18 },
  { period: "Morning", mood: "Melancholy Glow", intensity: 24, minutes: 16 },
  { period: "Morning", mood: "Cathartic", intensity: 20, minutes: 14 },
  { period: "Morning", mood: "Swagger", intensity: 26, minutes: 17 },
  { period: "Morning", mood: "Neon Drift", intensity: 18, minutes: 12 },
  { period: "Afternoon", mood: "Bright Pulse", intensity: 74, minutes: 63 },
  { period: "Afternoon", mood: "Adrenaline Rush", intensity: 81, minutes: 71 },
  { period: "Afternoon", mood: "Flow State", intensity: 47, minutes: 38 },
  { period: "Afternoon", mood: "Dreamwash", intensity: 36, minutes: 28 },
  { period: "Afternoon", mood: "Melancholy Glow", intensity: 20, minutes: 14 },
  { period: "Afternoon", mood: "Cathartic", intensity: 52, minutes: 41 },
  { period: "Afternoon", mood: "Swagger", intensity: 58, minutes: 46 },
  { period: "Afternoon", mood: "Neon Drift", intensity: 25, minutes: 18 },
  { period: "Evening", mood: "Adrenaline Rush", intensity: 70, minutes: 58 },
  { period: "Evening", mood: "Bright Pulse", intensity: 62, minutes: 51 },
  { period: "Evening", mood: "Melancholy Glow", intensity: 55, minutes: 43 },
  { period: "Evening", mood: "Dreamwash", intensity: 40, minutes: 31 },
  { period: "Evening", mood: "Flow State", intensity: 22, minutes: 15 },
  { period: "Evening", mood: "Cathartic", intensity: 69, minutes: 56 },
  { period: "Evening", mood: "Swagger", intensity: 60, minutes: 48 },
  { period: "Evening", mood: "Neon Drift", intensity: 72, minutes: 59 },
  { period: "Late Night", mood: "Melancholy Glow", intensity: 79, minutes: 68 },
  { period: "Late Night", mood: "Dreamwash", intensity: 86, minutes: 75 },
  { period: "Late Night", mood: "Flow State", intensity: 58, minutes: 44 },
  { period: "Late Night", mood: "Bright Pulse", intensity: 26, minutes: 18 },
  { period: "Late Night", mood: "Adrenaline Rush", intensity: 18, minutes: 12 },
  { period: "Late Night", mood: "Cathartic", intensity: 48, minutes: 36 },
  { period: "Late Night", mood: "Swagger", intensity: 53, minutes: 39 },
  { period: "Late Night", mood: "Neon Drift", intensity: 84, minutes: 73 },
];
export const forgottenFavorites: FavoriteTrack[] = [
  {
    title: "Ribs",
    artist: "Lorde",
    album: "Pure Heroine",
    lastPlayed: "143 days ago",
    affinity: 97,
    imageUrl:
      "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=800&q=80",
  },
  {
    title: "Motion Sickness",
    artist: "Phoebe Bridgers",
    album: "Stranger in the Alps",
    lastPlayed: "102 days ago",
    affinity: 94,
    imageUrl:
      "https://images.unsplash.com/photo-1501386761578-eac5c94b800a?auto=format&fit=crop&w=800&q=80",
  },
  {
    title: "Electric Feel",
    artist: "MGMT",
    album: "Oracular Spectacular",
    lastPlayed: "87 days ago",
    affinity: 90,
    imageUrl:
      "https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?auto=format&fit=crop&w=800&q=80",
  },
  {
    title: "Nights",
    artist: "Frank Ocean",
    album: "Blonde",
    lastPlayed: "76 days ago",
    affinity: 88,
    imageUrl:
      "https://images.unsplash.com/photo-1511379938547-c1f69419868d?auto=format&fit=crop&w=800&q=80",
  },
];

export const quietSavedTracks: FavoriteTrack[] = [
  {
    title: "Pink Moon",
    artist: "Nick Drake",
    album: "Pink Moon",
    lastPlayed: "Not in recent listens",
    affinity: 78,
    savedAt: "2023-09-14T00:00:00.000Z",
    reason: "Saved ages ago and still sitting quietly in your library.",
    imageUrl:
      "https://images.unsplash.com/photo-1458560871784-56d23406c091?auto=format&fit=crop&w=800&q=80",
  },
  {
    title: "Heaven or Las Vegas",
    artist: "Cocteau Twins",
    album: "Heaven or Las Vegas",
    lastPlayed: "214 days ago",
    affinity: 74,
    savedAt: "2022-11-03T00:00:00.000Z",
    reason: "An older save that has been out of rotation for a long stretch.",
    imageUrl:
      "https://images.unsplash.com/photo-1516280440614-37939bbacd81?auto=format&fit=crop&w=800&q=80",
  },
  {
    title: "Holocene",
    artist: "Bon Iver",
    album: "Bon Iver, Bon Iver",
    lastPlayed: "156 days ago",
    affinity: 72,
    savedAt: "2021-05-22T00:00:00.000Z",
    reason: "Saved long ago, but it has barely shown up in your recent listening window.",
    imageUrl:
      "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=800&q=80",
  },
  {
    title: "Cherry-coloured Funk",
    artist: "Cocteau Twins",
    album: "Heaven or Las Vegas",
    lastPlayed: "Not in recent listens",
    affinity: 69,
    savedAt: "2022-11-03T00:00:00.000Z",
    reason: "A library deep cut that still fits your taste, even without favorite-level history.",
    imageUrl:
      "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=800&q=80",
  },
];

export const genrePulse: GenrePulse[] = [
  { genre: "Alt-pop", hours: 10.2, color: "#31E7FF" },
  { genre: "Indie rock", hours: 8.6, color: "#53F8B7" },
  { genre: "Neo-soul", hours: 4.9, color: "#FFD166" },
  { genre: "House", hours: 3.8, color: "#FF6B6B" },
  { genre: "Ambient", hours: 3.2, color: "#2B59FF" },
];

export const playlistInsights: PlaylistInsight[] = [
  {
    name: "Late Night Transit",
    mood: "Dreamy / reflective",
    diversity: "High genre spread",
    overlap: "12% repeated artists",
    topGenresSummary: "dream pop, synthwave, and ambient pop",
    listeningCadence: "6 tracked plays across 4 days, 2 this week",
    imageUrl:
      "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=80",
  },
  {
    name: "Gym Reset",
    mood: "Explosive / confident",
    diversity: "Focused energy pocket",
    overlap: "Low redundancy",
    topGenresSummary: "edm, house, and pop rap",
    listeningCadence: "11 tracked plays across 6 days, 4 this week",
    imageUrl:
      "https://images.unsplash.com/photo-1516280440614-37939bbacd81?auto=format&fit=crop&w=1200&q=80",
  },
  {
    name: "Rainy Window",
    mood: "Melancholic / cinematic",
    diversity: "Moderate consistency",
    overlap: "3 tracks overplayed recently",
    topGenresSummary: "indie folk, chamber pop, and piano rock",
    listeningCadence: "3 tracked plays across 3 days in recent history",
    imageUrl:
      "https://images.unsplash.com/photo-1496293455970-f8581aae0e3b?auto=format&fit=crop&w=1200&q=80",
  },
];

export const previewTopLists: TopListsData = {
  range: "month",
  sourceLabel: "Preview top items",
  generatedAt: "2026-03-01T12:00:00.000Z",
  artists: [
    {
      id: "artist-1",
      rank: 1,
      name: "Lorde",
      genres: ["alt-pop", "art pop"],
      imageUrl:
        "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=800&q=80",
    },
    {
      id: "artist-2",
      rank: 2,
      name: "Frank Ocean",
      genres: ["neo-soul", "alternative r&b"],
      imageUrl:
        "https://images.unsplash.com/photo-1511379938547-c1f69419868d?auto=format&fit=crop&w=800&q=80",
    },
    {
      id: "artist-3",
      rank: 3,
      name: "Phoebe Bridgers",
      genres: ["indie rock", "singer-songwriter"],
      imageUrl:
        "https://images.unsplash.com/photo-1501386761578-eac5c94b800a?auto=format&fit=crop&w=800&q=80",
    },
    {
      id: "artist-4",
      rank: 4,
      name: "Fred again..",
      genres: ["house", "uk dance"],
      imageUrl:
        "https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?auto=format&fit=crop&w=800&q=80",
    },
    {
      id: "artist-5",
      rank: 5,
      name: "SZA",
      genres: ["r&b", "pop"],
      imageUrl:
        "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=800&q=80",
    },
  ],
  tracks: [
    {
      id: "track-1",
      rank: 1,
      title: "Ribs",
      artist: "Lorde",
      album: "Pure Heroine",
      popularity: 82,
      imageUrl:
        "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=800&q=80",
    },
    {
      id: "track-2",
      rank: 2,
      title: "Nights",
      artist: "Frank Ocean",
      album: "Blonde",
      popularity: 84,
      imageUrl:
        "https://images.unsplash.com/photo-1511379938547-c1f69419868d?auto=format&fit=crop&w=800&q=80",
    },
    {
      id: "track-3",
      rank: 3,
      title: "Kyoto",
      artist: "Phoebe Bridgers",
      album: "Punisher",
      popularity: 76,
      imageUrl:
        "https://images.unsplash.com/photo-1501386761578-eac5c94b800a?auto=format&fit=crop&w=800&q=80",
    },
    {
      id: "track-4",
      rank: 4,
      title: "Delilah (pull me out of this)",
      artist: "Fred again..",
      album: "Actual Life 3",
      popularity: 74,
      imageUrl:
        "https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?auto=format&fit=crop&w=800&q=80",
    },
    {
      id: "track-5",
      rank: 5,
      title: "Snooze",
      artist: "SZA",
      album: "SOS",
      popularity: 88,
      imageUrl:
        "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=800&q=80",
    },
  ],
  albums: [
    {
      id: "album-1",
      rank: 1,
      name: "Pure Heroine",
      artist: "Lorde",
      trackCount: 1,
      score: 24,
      imageUrl:
        "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=800&q=80",
    },
    {
      id: "album-2",
      rank: 2,
      name: "Blonde",
      artist: "Frank Ocean",
      trackCount: 1,
      score: 23,
      imageUrl:
        "https://images.unsplash.com/photo-1511379938547-c1f69419868d?auto=format&fit=crop&w=800&q=80",
    },
    {
      id: "album-3",
      rank: 3,
      name: "Punisher",
      artist: "Phoebe Bridgers",
      trackCount: 1,
      score: 21,
      imageUrl:
        "https://images.unsplash.com/photo-1501386761578-eac5c94b800a?auto=format&fit=crop&w=800&q=80",
    },
    {
      id: "album-4",
      rank: 4,
      name: "Actual Life 3",
      artist: "Fred again..",
      trackCount: 1,
      score: 20,
      imageUrl:
        "https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?auto=format&fit=crop&w=800&q=80",
    },
    {
      id: "album-5",
      rank: 5,
      name: "SOS",
      artist: "SZA",
      trackCount: 1,
      score: 19,
      imageUrl:
        "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=800&q=80",
    },
  ],
};





