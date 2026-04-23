export const moodOrder = [
  "Adrenaline Rush",
  "Neon Drift",
  "Dreamwash",
  "Melancholy Glow",
  "Bright Pulse",
  "Flow State",
  "Cathartic",
  "Swagger",
] as const;

export const moodColors = ["#7AF7FF", "#6E82FF", "#FF5EC9", "#FFD37B", "#8EFFD1", "#FF8AAE", "#C9A3FF", "#4AD7B2"];

const moodDescriptions: Record<(typeof moodOrder)[number], string> = {
  "Adrenaline Rush": "Fast, high-energy tracks built around lift, impact, and forward motion.",
  "Neon Drift": "Sleek, reflective grooves that feel like movement after dark.",
  Dreamwash: "Soft, hazy listening with gentle textures and a calm emotional center.",
  "Melancholy Glow": "Wistful or heavy songs that still carry warmth and emotional color.",
  "Bright Pulse": "Upbeat, melodic records with bounce, shine, and a feel-good core.",
  "Flow State": "Steady, immersive music that supports concentration and staying locked in.",
  Cathartic: "Emotionally intense songs that feel releasing, cleansing, or overwhelming in a good way.",
  Swagger: "Confident, rhythmic tracks with attitude, sharp edges, and self-assured cool.",
};

export function getMoodDescription(mood: string) {
  return moodDescriptions[mood as keyof typeof moodDescriptions] ?? "A listening mood inferred from your track features and genre patterns.";
}
