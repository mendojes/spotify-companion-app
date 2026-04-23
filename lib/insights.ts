import { FavoriteTrack, MoodPoint } from "@/lib/types";
import { getMoodDescription } from "@/lib/moods";

export function getVibeSummary(moods: MoodPoint[]) {
  const ranked = [...moods].sort((a, b) => b.share - a.share);
  const dominant = ranked[0];
  const secondary = ranked[1];

  if (!dominant) {
    return "Your listening profile is still warming up.";
  }

  const pair = secondary ? `, with ${secondary.mood.toLowerCase()} not far behind` : "";

  if (dominant.mood === "Adrenaline Rush") {
    return `Your listening has been push-the-gas heavy: high tempo, high lift, and songs built to surge forward${pair}.`;
  }

  if (dominant.mood === "Neon Drift") {
    return `You are sitting in that late-city glow lately: sleek grooves, steady motion, and reflective after-hours momentum${pair}.`;
  }

  if (dominant.mood === "Dreamwash") {
    return `This window leans soft and hazy, with gentle textures and low-pressure songs that keep the room calm${pair}.`;
  }

  if (dominant.mood === "Melancholy Glow") {
    return `Your listening is carrying a wistful edge right now: introspective songs with a little weight and emotional color${pair}.`;
  }

  if (dominant.mood === "Bright Pulse") {
    return `You have been orbiting bright, feel-good records with bounce, lift, and a strong sing-along center${pair}.`;
  }

  if (dominant.mood === "Flow State") {
    return `This stretch looks dialed-in and intentional, with tracks that support concentration more than spectacle${pair}.`;
  }

  if (dominant.mood === "Cathartic") {
    return `Your recent plays read like an emotional release valve: intensity with feeling, rather than just raw speed${pair}.`;
  }

  if (dominant.mood === "Swagger") {
    return `Confidence is leading the mix right now: rhythmic, self-assured tracks with a cooler, sharper edge${pair}.`;
  }

  return `${getMoodDescription(dominant.mood)} ${secondary ? `You also show a strong pull toward ${secondary.mood.toLowerCase()}.` : `Average energy lands around ${dominant.energy}%.`}`;
}

export function buildRediscoveryPlaylist(tracks: FavoriteTrack[]) {
  return tracks
    .filter((track) => track.affinity >= 88)
    .sort((a, b) => b.affinity - a.affinity)
    .map((track, index) => ({
      slot: index + 1,
      label: `${track.title} - ${track.artist}`,
      reason: `${track.lastPlayed} | ${track.affinity}% affinity`,
    }));
}
