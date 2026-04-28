"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Heart } from "lucide-react";
import { getVibeSummary } from "@/lib/insights";
import { getMoodDescription, moodColors } from "@/lib/moods";
import { MoodPoint } from "@/lib/types";

export function PublicMoodOverview({
  moodData,
  moodSource,
}: {
  moodData: MoodPoint[];
  moodSource: string;
}) {
  return (
    <div className="glass-panel rounded-[34px] p-4 sm:p-6 md:p-7 text-[var(--theme-text)]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="section-kicker">Mood analysis</p>
          <h3 className="mt-2 font-display text-3xl uppercase tracking-[0.08em] text-[var(--theme-title)]">Public vibe radar</h3>
        </div>
        <div className="icon-bubble h-11 w-11 text-[var(--theme-highlight)]">
          <Heart className="h-5 w-5" />
        </div>
      </div>
      <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--theme-body)]">
        {getVibeSummary(moodData)} This pie chart blends all tracks visible across your public playlists into the same mood categories used elsewhere in SoundScope.
      </p>
      <p className="mt-2 text-xs uppercase tracking-[0.16em] text-[var(--theme-muted)]">{moodSource}</p>
      <div className="mt-6 grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="h-[260px] rounded-[24px] border-2 border-[rgba(57,18,98,0.18)] bg-white/[0.45] p-2 sm:h-[300px] sm:p-3">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={moodData} dataKey="share" nameKey="mood" innerRadius={62} outerRadius={110} paddingAngle={4}>
                {moodData.map((entry, index) => (
                  <Cell key={entry.mood} fill={moodColors[index % moodColors.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  background: "var(--chart-tooltip-bg)",
                  borderRadius: 18,
                  border: "1px solid var(--chart-tooltip-border)",
                  color: "var(--theme-title)",
                  boxShadow: "0 12px 32px rgba(57, 18, 98, 0.18)",
                }}
                labelStyle={{ color: "var(--theme-title)", fontWeight: 600 }}
                itemStyle={{ color: "var(--theme-title)" }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="grid gap-3">
          {[...moodData]
            .sort((a, b) => b.share - a.share)
            .slice(0, 4)
            .map((entry) => (
              <div key={entry.mood} className="desktop-card px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-display text-lg uppercase tracking-[0.08em] text-[var(--theme-title)]">{entry.mood}</p>
                  <p className="font-mono text-lg uppercase text-[var(--theme-highlight)]">{entry.share}%</p>
                </div>
                <p className="mt-2 text-sm leading-6 text-[var(--theme-body)]">{getMoodDescription(entry.mood)}</p>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
