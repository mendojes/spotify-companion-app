"use client";

import Image from "next/image";
import { Area, AreaChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { getVibeSummary } from "@/lib/insights";
import { deriveGenreBasedMoodInsightsFromSummaries, getMoodDescription, moodColors } from "@/lib/moods";
import { PlaylistDetail } from "@/lib/types";

const genreColors = ["#7AF7FF", "#FF8AD8", "#FFD37B", "#8EFFD1", "#8FA2FF"];
const chartTooltipContentStyle = {
  background: "var(--chart-tooltip-bg)",
  borderRadius: 18,
  border: "1px solid var(--chart-tooltip-border)",
  color: "var(--theme-title)",
  boxShadow: "0 12px 32px rgba(57, 18, 98, 0.18)",
};
const chartTooltipLabelStyle = { color: "var(--theme-title)", fontWeight: 600 };
const chartTooltipItemStyle = { color: "var(--theme-title)" };

type InsightCard = {
  label: string;
  value: string;
  detail: string;
};

function getGenreChartData(detail: PlaylistDetail) {
  const total = detail.topGenres.reduce((sum, genre) => sum + genre.count, 0);

  return detail.topGenres.map((genre) => ({
    ...genre,
    share: total > 0 ? Number(((genre.count / total) * 100).toFixed(1)) : 0,
  }));
}

function getMomentumSummary(detail: PlaylistDetail) {
  const recentWindow = detail.listenTimeline.slice(-7);
  const previousWindow = detail.listenTimeline.slice(0, Math.max(0, detail.listenTimeline.length - 7));
  const recentCount = recentWindow.reduce((sum, point) => sum + point.listens, 0);
  const previousCount = previousWindow.reduce((sum, point) => sum + point.listens, 0);

  if (recentCount === 0 && previousCount === 0) {
    return {
      value: "No recent plays",
      detail: "Spotify has not logged enough playlist-specific listens yet to read momentum.",
    };
  }

  if (recentCount > previousCount + 1) {
    return {
      value: "Ramping up",
      detail: `${recentCount} listens in the latest 7 tracked days versus ${previousCount} in the earlier window.`,
    };
  }

  if (previousCount > recentCount + 1) {
    return {
      value: "Cooling off",
      detail: `${recentCount} listens in the latest 7 tracked days after ${previousCount} in the earlier window.`,
    };
  }

  return {
    value: "Holding steady",
    detail: `${recentCount} listens in the latest 7 tracked days with a similar earlier pace.`,
  };
}

function getPlaylistArchetype(detail: PlaylistDetail, topGenreLabel?: string) {
  const artistSpread = detail.trackCount > 0 ? detail.uniqueArtistCount / detail.trackCount : 0;
  const albumSpread = detail.trackCount > 0 ? detail.uniqueAlbumCount / detail.trackCount : 0;

  if (artistSpread >= 0.7 && albumSpread >= 0.55) {
    return {
      value: "Explorer set",
      detail: `Wide artist and album spread${topGenreLabel ? `, anchored by ${topGenreLabel}` : ""}.`,
    };
  }

  if (artistSpread <= 0.35 || detail.repeatedTracks.length > 0) {
    return {
      value: "Comfort rotation",
      detail: `More repeat pressure and tighter artist concentration${topGenreLabel ? ` around ${topGenreLabel}` : ""}.`,
    };
  }

  return {
    value: "Balanced lane",
    detail: `A middle ground between discovery and repeat listening${topGenreLabel ? ` with ${topGenreLabel} leading` : ""}.`,
  };
}

function getLibraryShape(detail: PlaylistDetail) {
  const artistCoverage = detail.trackCount > 0 ? Math.round((detail.uniqueArtistCount / detail.trackCount) * 100) : 0;
  const albumCoverage = detail.trackCount > 0 ? Math.round((detail.uniqueAlbumCount / detail.trackCount) * 100) : 0;

  return {
    value: `${artistCoverage}% artist spread`,
    detail: `${detail.uniqueArtistCount} unique artists and ${detail.uniqueAlbumCount} unique albums across ${detail.trackCount} tracks. Album spread sits at ${albumCoverage}%.`,
  };
}

function getExtraInsightCards(detail: PlaylistDetail, topGenreLabel?: string): InsightCard[] {
  const momentum = getMomentumSummary(detail);
  const archetype = getPlaylistArchetype(detail, topGenreLabel);
  const libraryShape = getLibraryShape(detail);

  return [
    {
      label: "Momentum read",
      value: momentum.value,
      detail: momentum.detail,
    },
    {
      label: "Playlist archetype",
      value: archetype.value,
      detail: archetype.detail,
    },
    {
      label: "Library shape",
      value: libraryShape.value,
      detail: libraryShape.detail,
    },
  ];
}

export function PlaylistDetailView({ detail, mode = "authenticated" }: { detail: PlaylistDetail; mode?: "authenticated" | "public" }) {
  const genreData = getGenreChartData(detail);
  const hasTimeline = mode === "authenticated" && detail.listenTimeline.length > 0;
  const hasGenres = genreData.length > 0;
  const topGenreLabel = genreData[0]?.genre;
  const extraInsights = mode === "public" ? [] : getExtraInsightCards(detail, topGenreLabel);
  const publicMoodInsights = mode === "public" ? deriveGenreBasedMoodInsightsFromSummaries(detail.topGenres) : null;

  return (
    <div className="space-y-6">
      {extraInsights.length > 0 ? (
        <div className="grid gap-4 xl:grid-cols-3">
          {extraInsights.map((insight) => (
            <div key={insight.label} className="glass-panel rounded-[30px] p-6 text-[var(--theme-text)]">
              <p className="text-sm uppercase tracking-[0.24em] text-[#2b7f97]">{insight.label}</p>
              <p className="mt-4 font-display text-3xl leading-tight text-[var(--theme-title)]">{insight.value}</p>
              <p className="mt-3 text-sm leading-7 text-[var(--theme-body)]">{insight.detail}</p>
            </div>
          ))}
        </div>
      ) : null}

      <div className={`grid gap-6 ${mode === "public" ? "" : "xl:grid-cols-[1.05fr_0.95fr]"}`}>
        <div className="glass-panel rounded-[32px] p-6 text-[var(--theme-text)]">
          <p className="text-sm uppercase tracking-[0.24em] text-[#2b7f97]">Genre composition</p>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--theme-body)]">
            {hasGenres
              ? mode === "public"
                ? "A genre-share view inferred from the artists visible on this public playlist page."
                : "A genre-share view of the artists driving this playlist right now."
              : "Spotify did not return enough artist genre metadata to build a genre share chart yet."}
          </p>
          <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(16rem,0.9fr)]">
            <div className="h-[320px] rounded-[26px] border border-white/10 bg-white/[0.04] p-3">
              {hasGenres ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={genreData} dataKey="share" nameKey="genre" innerRadius={72} outerRadius={112} paddingAngle={3}>
                      {genreData.map((entry, index) => (
                        <Cell key={entry.genre} fill={genreColors[index % genreColors.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value: number, _name: string, item: { payload?: { genre?: string; mood?: string } }) => [`${value}%`, item?.payload?.genre ?? item?.payload?.mood ?? "Share"]}
                      contentStyle={chartTooltipContentStyle}
                      labelStyle={chartTooltipLabelStyle}
                      itemStyle={chartTooltipItemStyle}
                    />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-center text-sm text-[var(--theme-muted)]">
                  Genre share becomes available once Spotify returns genre-tagged artists for this playlist.
                </div>
              )}
            </div>
            <div className="space-y-3">
              {genreData.map((genre, index) => (
                <div key={genre.genre} className="rounded-[22px] border border-white/10 bg-white/[0.03] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="h-3 w-3 rounded-full" style={{ backgroundColor: genreColors[index % genreColors.length] }} />
                      <p className="text-[var(--theme-text)]">{genre.genre}</p>
                    </div>
                    <p className="text-sm text-cyan">{genre.share}%</p>
                  </div>
                  <p className="mt-2 text-sm text-[var(--theme-muted)]">{genre.count} genre-tagged artist{genre.count === 1 ? "" : "s"} in the analyzed slice</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {mode === "authenticated" ? (
          <div className="glass-panel rounded-[32px] p-6 text-[var(--theme-text)]">
            <p className="text-sm uppercase tracking-[0.24em] text-[#2b7f97]">Listening timeline</p>
            <p className="mt-3 text-sm leading-7 text-[var(--theme-body)]">{detail.listeningCadence}</p>
            <div className="mt-6 h-[320px] rounded-[26px] border border-white/10 bg-white/[0.04] p-3">
              {hasTimeline ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={detail.listenTimeline} margin={{ left: -16, right: 12, top: 14, bottom: 0 }}>
                    <defs>
                      <linearGradient id="playlistTimelineFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#2b9fc3" stopOpacity={0.5} />
                        <stop offset="100%" stopColor="#2b9fc3" stopOpacity={0.12} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "#5d3383", fontSize: 12 }} />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: "#5d3383", fontSize: 12 }} width={28} />
                    <Tooltip
                      formatter={(value: number) => [`${value}`, value === 1 ? "Listen" : "Listens"]}
                      labelFormatter={(label) => `Day: ${label}`}
                      contentStyle={chartTooltipContentStyle}
                      labelStyle={chartTooltipLabelStyle}
                      itemStyle={chartTooltipItemStyle}
                    />
                    <Area type="monotone" dataKey="listens" stroke="#2b9fc3" strokeWidth={3} fill="url(#playlistTimelineFill)" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-center text-sm text-[var(--theme-muted)]">
                  No tracked playlist listens yet. Once Spotify playback history includes this playlist, the timeline will appear here.
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>

      {mode === "public" && publicMoodInsights ? (
        <div className="grid gap-6 2xl:grid-cols-[0.88fr_1.12fr]">
          <div className="glass-panel rounded-[32px] p-6 text-[var(--theme-text)]">
            <p className="text-sm uppercase tracking-[0.24em] text-[#2b7f97]">Mood analysis</p>
            <h3 className="mt-3 font-display text-3xl uppercase tracking-[0.08em] text-[var(--theme-title)]">Playlist vibe radar</h3>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--theme-body)]">
              {getVibeSummary(publicMoodInsights.moodData)} This uses the same mood categories and genre-based fallback model as the connected dashboard.
            </p>
            <div className="mt-6 h-[280px] rounded-[24px] border border-white/10 bg-white/[0.04] p-3">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={publicMoodInsights.moodData} dataKey="share" nameKey="mood" innerRadius={70} outerRadius={112} paddingAngle={4}>
                    {publicMoodInsights.moodData.map((entry, index) => (
                      <Cell key={entry.mood} fill={moodColors[index % moodColors.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number, _name: string, item: { payload?: { genre?: string; mood?: string } }) => [`${value}%`, item?.payload?.genre ?? item?.payload?.mood ?? "Share"]}
                    contentStyle={chartTooltipContentStyle}
                    labelStyle={chartTooltipLabelStyle}
                    itemStyle={chartTooltipItemStyle}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="glass-panel rounded-[32px] p-6 text-[var(--theme-text)]">
            <p className="text-sm uppercase tracking-[0.24em] text-[#2b7f97]">Top mood lanes</p>
            <p className="mt-3 text-sm leading-7 text-[var(--theme-body)]">
              These percentages come from the public playlist&apos;s genre mix rather than tracked playback sessions.
            </p>
            <div className="mt-6 grid gap-3">
              {[...publicMoodInsights.moodData]
                .sort((a, b) => b.share - a.share)
                .slice(0, 4)
                .map((entry) => (
                  <div key={entry.mood} className="rounded-[22px] border border-white/10 bg-white/[0.03] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-display text-xl uppercase tracking-[0.08em] text-[var(--theme-title)]">{entry.mood}</p>
                      <p className="font-mono text-sm uppercase tracking-[0.16em] text-[#2b7f97]">{entry.share}%</p>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-[var(--theme-body)]">{getMoodDescription(entry.mood)}</p>
                  </div>
                ))}
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="glass-panel rounded-[30px] p-6">
          <p className="text-sm uppercase tracking-[0.24em] text-[#2b7f97]">Genre diversity</p>
          <p className="mt-3 text-[var(--theme-text)]">{detail.diversity}</p>
          <div className="mt-6 space-y-3">
            {detail.topGenres.map((genre) => (
              <div key={genre.genre} className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                <p className="text-[var(--theme-text)]">{genre.genre}</p>
                <p className="text-sm text-[#2b7f97]">{genre.count}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="glass-panel rounded-[30px] p-6">
          <p className="text-sm uppercase tracking-[0.24em] text-[#2b7f97]">Artist concentration</p>
          <p className="mt-3 text-[var(--theme-text)]">{detail.overlap}</p>
          <div className="mt-6 space-y-3">
            {detail.topArtists.map((artist) => (
              <div key={artist.artist} className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                <p className="text-[var(--theme-text)]">{artist.artist}</p>
                <p className="text-sm text-[#2b7f97]">{artist.count}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="glass-panel rounded-[30px] p-6">
          <p className="text-sm uppercase tracking-[0.24em] text-[#2b7f97]">Repeated tracks</p>
          <p className="mt-3 text-[var(--theme-text)]">
            {detail.repeatedTracks.length > 0 ? "Tracks that appear more than once in this playlist." : "No duplicate tracks detected in the analyzed slice."}
          </p>
          <div className="mt-6 space-y-3">
            {(detail.repeatedTracks.length > 0 ? detail.repeatedTracks : detail.sampleTracks.slice(0, 3)).map((track) => (
              <div key={track.id} className="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                {track.imageUrl ? (
                  <div className="relative h-16 w-16 overflow-hidden rounded-2xl border border-white/10 bg-white/5">
                    <Image src={track.imageUrl} alt={track.title} fill sizes="64px" className="object-contain bg-white/[0.2]" />
                  </div>
                ) : null}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[var(--theme-text)]">{track.title}</p>
                  <p className="truncate text-sm text-[var(--theme-muted)]">{track.artist}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="glass-panel rounded-[32px] p-6">
        <p className="text-sm uppercase tracking-[0.24em] text-[#2b7f97]">Top songs</p>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--theme-body)]">
          {mode === "public"
            ? "Tracks sampled from the public playlist page. These rankings come from the public snapshot only."
            : "Tracks from this playlist that rank highest against your all-time listening history, with Spotify popularity used only as a fallback when a song is absent from that history."}
        </p>
        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {(detail.topTracks.length > 0 ? detail.topTracks : detail.sampleTracks).map((track, index) => (
            <div key={track.id} className="rounded-[24px] border border-white/10 bg-white/[0.03] p-4 text-[var(--theme-text)]">
              <div className="flex items-start gap-4">
                {track.imageUrl ? (
                  <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-[20px] border border-white/10 bg-white/5">
                    <Image src={track.imageUrl} alt={track.title} fill sizes="80px" className="object-contain bg-white/[0.2]" />
                  </div>
                ) : null}
                <div className="min-w-0 flex-1">
                  <p className="text-xs uppercase tracking-[0.18em] text-[#2b7f97]">#{index + 1}</p>
                  <p className="mt-2 break-words font-display text-xl leading-tight text-[var(--theme-title)]">{track.title}</p>
                  <p className="mt-2 break-words text-sm text-[var(--theme-muted)]">{track.artist}</p>
                  {mode === "authenticated" ? <p className="mt-2 break-words text-xs uppercase tracking-[0.16em] text-[var(--theme-muted)]">{track.album}</p> : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
