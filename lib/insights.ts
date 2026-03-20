import { FavoriteTrack, MoodPoint } from "@/lib/types";

export function getVibeSummary(moods: MoodPoint[]) {
  const dominant = [...moods].sort((a, b) => b.share - a.share)[0];

  if (!dominant) {
    return "Your listening profile is still warming up.";
  }

  if (dominant.mood === "Energetic") {
    return "Your week feels momentum-heavy: fast tempos, rising intensity, and upbeat late-night sessions.";
  }

  if (dominant.mood === "Chill") {
    return "You have been leaning into soft-focus listening with calm textures and lower-energy loops.";
  }

  return `Your week is anchored by ${dominant.mood.toLowerCase()} listening with a ${dominant.energy}% average energy score.`;
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
