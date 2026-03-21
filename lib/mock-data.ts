import {
  FavoriteTrack,
  GenrePulse,
  MoodPoint,
  PlaylistInsight,
  StatCard,
  TopListsData,
  TrendPoint,
} from "@/lib/types";

export const heroStats: StatCard[] = [
  { label: "Top genre", value: "Alt-pop", delta: "+18% vs last month" },
  { label: "Rediscovered tracks", value: "27", delta: "8 played this week" },
  { label: "Mood swing", value: "Chill -> Energetic", delta: "Friday spikes after 8 PM" },
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
  { mood: "Energetic", share: 34, energy: 81 },
  { mood: "Chill", share: 24, energy: 42 },
  { mood: "Moody", share: 18, energy: 49 },
  { mood: "Joyful", share: 14, energy: 67 },
  { mood: "Focus", share: 10, energy: 58 },
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
    imageUrl:
      "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=80",
  },
  {
    name: "Gym Reset",
    mood: "Explosive / confident",
    diversity: "Focused energy pocket",
    overlap: "Low redundancy",
    imageUrl:
      "https://images.unsplash.com/photo-1516280440614-37939bbacd81?auto=format&fit=crop&w=1200&q=80",
  },
  {
    name: "Rainy Window",
    mood: "Melancholic / cinematic",
    diversity: "Moderate consistency",
    overlap: "3 tracks overplayed recently",
    imageUrl:
      "https://images.unsplash.com/photo-1496293455970-f8581aae0e3b?auto=format&fit=crop&w=1200&q=80",
  },
];

export const previewTopLists: TopListsData = {
  range: "medium_term",
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
