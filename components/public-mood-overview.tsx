"use client";

import { Fragment } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Heart, Waves } from "lucide-react";
import { getVibeSummary } from "@/lib/insights";
import { getMoodDescription, moodColors, moodOrder } from "@/lib/moods";
import { MoodHeatmapCell, MoodPoint } from "@/lib/types";

export function PublicMoodOverview({
  moodData,
  moodHeatmap,
  moodSource,
}: {
  moodData: MoodPoint[];
  moodHeatmap: MoodHeatmapCell[];
  moodSource: string;
}) {
  const moodHeatmapPeriods = [...new Set(moodHeatmap.map((cell) => cell.period))];
  const heatmapCellByKey = new Map(moodHeatmap.map((cell) => [`${cell.mood}::${cell.period}`, cell]));

  return (
    <div className="grid gap-6 2xl:grid-cols-[0.88fr_1.12fr]">
      <div className="glass-panel rounded-[34px] p-4 sm:p-6 md:p-7 text-[var(--theme-text)]">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="section-kicker">Mood analysis</p>
            <h3 className="mt-2 font-display text-3xl uppercase tracking-[0.08em] text-[var(--theme-title)]">Vibe radar</h3>
          </div>
          <div className="icon-bubble h-11 w-11 text-[var(--theme-highlight)]">
            <Heart className="h-5 w-5" />
          </div>
        </div>
        <p className="mt-3 max-w-md text-sm leading-7 text-[var(--theme-body)]">{getVibeSummary(moodData)}</p>
        <p className="mt-2 text-xs uppercase tracking-[0.16em] text-[var(--theme-muted)]">{moodSource}</p>
        <div className="mt-6 h-[250px] rounded-[24px] border-2 border-[rgba(57,18,98,0.18)] bg-white/[0.45] p-2 sm:h-[270px] sm:p-3">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={moodData} dataKey="share" nameKey="mood" innerRadius={62} outerRadius={98} paddingAngle={4}>
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
        <div className="mt-5 grid gap-3">
          {[...moodData]
            .sort((a, b) => b.share - a.share)
            .slice(0, 3)
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

      <div className="window-panel p-4 pt-16 sm:p-6 sm:pt-16 md:p-7 md:pt-16 text-[var(--theme-text)]">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div>
            <p className="section-kicker">Mood heatmap</p>
            <h3 className="mt-2 font-display text-3xl uppercase tracking-[0.08em] text-[var(--theme-title)]">Time of day x mood</h3>
          </div>
          <div className="icon-bubble h-10 w-10 text-[var(--theme-accent)]">
            <Waves className="h-4 w-4" />
          </div>
        </div>
        <div className="desktop-card p-4">
          <p className="font-mono text-sm uppercase tracking-[0.16em] text-[var(--theme-muted)]">public mood map</p>
          <p className="mt-1 text-sm text-[var(--theme-body)]">These mood clusters are inferred from the genres visible across your public playlists, using the same mood categories as the connected dashboard.</p>
        </div>
        <div className="mt-5 overflow-x-auto rounded-[24px] border-2 border-[rgba(57,18,98,0.18)] bg-white/[0.45]">
          <div className="grid min-w-[44rem]" style={{ gridTemplateColumns: `minmax(140px, 1.2fr) repeat(${moodHeatmapPeriods.length}, minmax(110px, 1fr))` }}>
            <div className="border-b border-[rgba(57,18,98,0.12)] bg-white/[0.38] p-4 font-mono text-xs uppercase tracking-[0.18em] text-[var(--theme-muted)]">Mood</div>
            {moodHeatmapPeriods.map((period) => (
              <div key={period} className="border-b border-l border-[rgba(57,18,98,0.12)] bg-white/[0.38] p-4 text-center font-mono text-xs uppercase tracking-[0.18em] text-[var(--theme-muted)]">
                {period}
              </div>
            ))}
            {moodOrder.map((mood, rowIndex) => (
              <Fragment key={mood}>
                <div className="border-b border-[rgba(57,18,98,0.12)] bg-white/[0.32] p-4 font-display text-lg uppercase tracking-[0.08em] text-[var(--theme-title)]">
                  {mood}
                </div>
                {moodHeatmapPeriods.map((period) => {
                  const cell = heatmapCellByKey.get(`${mood}::${period}`);
                  const intensity = cell?.intensity ?? 0;
                  const alpha = Math.max(18, Math.round((intensity / 100) * 85)).toString(16).padStart(2, "0");

                  return (
                    <div
                      key={`${mood}-${period}`}
                      className="border-b border-l border-[rgba(57,18,98,0.12)] p-4 text-center"
                      style={{
                        background: `linear-gradient(135deg, rgba(255,255,255,0.16), ${moodColors[rowIndex % moodColors.length]}${alpha})`,
                      }}
                    >
                      <p className="font-mono text-lg uppercase text-[var(--theme-title)]">{intensity}%</p>
                      <p className="mt-1 text-xs uppercase tracking-[0.14em] text-[var(--theme-muted)]">{Math.round(cell?.minutes ?? 0)} min</p>
                    </div>
                  );
                })}
              </Fragment>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
