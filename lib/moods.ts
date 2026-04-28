import { MoodHeatmapCell, MoodPoint } from "@/lib/types";

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

const heatmapPeriods = ["Morning", "Afternoon", "Evening", "Late Night"] as const;

export function deriveMoodDataFromGenreNames(genreNames: string[]): MoodPoint[] {
  const buckets = [
    { mood: "Adrenaline Rush", energy: 88, matchers: ["dance", "house", "edm", "electro", "hyperpop", "drum and bass", "punk", "hardcore"] },
    { mood: "Neon Drift", energy: 58, matchers: ["synthwave", "night", "alternative r&b", "trip-hop", "downtempo", "neo-soul"] },
    { mood: "Dreamwash", energy: 34, matchers: ["ambient", "chill", "dream", "lo-fi", "shoegaze", "bedroom pop"] },
    { mood: "Melancholy Glow", energy: 42, matchers: ["sad", "emo", "singer-songwriter", "grunge", "melanch", "slowcore"] },
    { mood: "Bright Pulse", energy: 72, matchers: ["pop", "funk", "disco", "soul", "groove", "nu-disco"] },
    { mood: "Flow State", energy: 50, matchers: ["classical", "instrumental", "study", "jazz", "soundtrack", "post-rock"] },
    { mood: "Cathartic", energy: 68, matchers: ["metalcore", "post-hardcore", "alt rock", "indie rock", "arena rock", "gospel"] },
    { mood: "Swagger", energy: 66, matchers: ["hip hop", "rap", "trap", "phonk", "afrobeats", "dancehall"] },
  ] as const;

  const scores = new Map<string, number>(buckets.map((bucket) => [bucket.mood, 1]));

  genreNames.forEach((genre) => {
    const normalized = genre.toLowerCase();
    let matched = false;

    for (const bucket of buckets) {
      if (bucket.matchers.some((matcher) => normalized.includes(matcher))) {
        scores.set(bucket.mood, (scores.get(bucket.mood) ?? 0) + 1.4);
        matched = true;
      }
    }

    if (!matched) {
      scores.set("Bright Pulse", (scores.get("Bright Pulse") ?? 0) + 0.5);
    }
  });

  const total = [...scores.values()].reduce((sum, value) => sum + value, 0) || 1;
  return moodOrder.map((mood) => ({
    mood,
    share: Math.round(((scores.get(mood) ?? 0) / total) * 100),
    energy: buckets.find((bucket) => bucket.mood === mood)?.energy ?? 50,
  }));
}

export function normalizeMoodShares(points: MoodPoint[]): MoodPoint[] {
  const base = moodOrder.map((mood) => points.find((point) => point.mood === mood) ?? { mood, share: 0, energy: 50 });
  const total = base.reduce((sum, point) => sum + point.share, 0);

  if (total <= 0) {
    return base.map((point) => ({
      ...point,
      share: point.mood === "Bright Pulse" ? 100 : 0,
    }));
  }

  let remainder = 100;
  return base.map((point, index) => {
    if (index === base.length - 1) {
      return {
        ...point,
        share: remainder,
      };
    }

    const share = Math.round((point.share / total) * 100);
    remainder -= share;
    return {
      ...point,
      share,
    };
  });
}

export function deriveMoodHeatmapFallback(moodData: MoodPoint[]): MoodHeatmapCell[] {
  const emphasis: Record<(typeof heatmapPeriods)[number], Partial<Record<(typeof moodOrder)[number], number>>> = {
    Morning: { "Flow State": 1.1, Dreamwash: 0.9, "Bright Pulse": 0.6, "Adrenaline Rush": 0.35 },
    Afternoon: { "Bright Pulse": 1, "Adrenaline Rush": 1.05, Cathartic: 0.75, Swagger: 0.8 },
    Evening: { "Neon Drift": 1, Cathartic: 0.95, Swagger: 0.85, "Melancholy Glow": 0.8 },
    "Late Night": { Dreamwash: 1.1, "Neon Drift": 1.05, "Melancholy Glow": 1, "Flow State": 0.7 },
  };

  return heatmapPeriods.flatMap((period) =>
    moodOrder.map((mood) => {
      const point = moodData.find((entry) => entry.mood === mood);
      const intensity = Math.round((point?.share ?? 10) * (emphasis[period][mood] ?? 0.5));
      const minutes = Number(((point?.share ?? 0) * (emphasis[period][mood] ?? 0.5)).toFixed(1));
      return { period, mood, intensity, minutes };
    }),
  );
}

export function deriveGenreBasedMoodInsights(genreNames: string[]) {
  const moodData = normalizeMoodShares(deriveMoodDataFromGenreNames(genreNames));

  return {
    moodData,
    moodHeatmap: deriveMoodHeatmapFallback(moodData),
    moodSource: "Genre-based fallback mood model",
  };
}
