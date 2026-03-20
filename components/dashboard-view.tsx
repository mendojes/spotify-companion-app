"use client";

import Image from "next/image";
import Link from "next/link";
import { Clock3, Disc3, Flame, LibraryBig, Music2, Radar, Sparkles } from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  dashboardStats,
  forgottenFavorites,
  genrePulse,
  moodData,
  playlistInsights,
  previewTopLists,
  trendData,
} from "@/lib/mock-data";
import { buildRediscoveryPlaylist, getVibeSummary } from "@/lib/insights";
import {
  DashboardInsights,
  DashboardRange,
  FavoriteTrack,
  GenrePulse,
  MoodPoint,
  PlaylistInsight,
  SpotifyTimeRange,
  StatCard,
  TopListAlbum,
  TopListArtist,
  TopListTrack,
  TopListsData,
  TrendPoint,
} from "@/lib/types";

const timeframeTabs: Array<{ key: DashboardRange; label: string }> = [
  { key: "week", label: "This Week" },
  { key: "month", label: "This Month" },
  { key: "all", label: "All Time" },
];

const topRangeTabs: Array<{ key: SpotifyTimeRange; label: string }> = [
  { key: "short_term", label: "Last 4 Weeks" },
  { key: "medium_term", label: "Last 6 Months" },
  { key: "long_term", label: "All Time" },
];

const roadmap = [
  {
    phase: "MVP foundation",
    detail: "Spotify OAuth, top tracks/artists, basic mood analysis, forgotten favorites, MongoDB cache layer.",
  },
  {
    phase: "Insight expansion",
    detail: "Playlist analysis, richer trend visualizations, session heuristics, and rediscovery tuning.",
  },
  {
    phase: "Portfolio polish",
    detail: "Animated transitions, AI-generated playlists, social sharing, and compare-with-friends mechanics.",
  },
];

type DashboardViewProps = {
  mode?: "preview" | "authenticated";
  insights?: DashboardInsights;
  selectedRange?: DashboardRange;
  topLists?: TopListsData;
  selectedTopRange?: SpotifyTimeRange;
};

type DashboardData = {
  statCards: StatCard[];
  trendData: TrendPoint[];
  trendHeading: string;
  trendBadge: string;
  genrePulse: GenrePulse[];
  moodData: MoodPoint[];
  forgottenFavorites: FavoriteTrack[];
  playlistInsights: PlaylistInsight[];
  sourceLabel: string;
  moodSource: string;
  cachedAt?: string;
  snapshotCount?: number;
  range: DashboardRange;
};

type ArtworkCardItem = TopListArtist | TopListTrack | TopListAlbum | FavoriteTrack;

function getData(mode: DashboardViewProps["mode"], insights?: DashboardInsights): DashboardData {
  if (mode === "authenticated" && insights) {
    return insights;
  }

  return {
    statCards: dashboardStats as StatCard[],
    trendData: trendData as TrendPoint[],
    trendHeading: "Minutes played vs rediscovered songs",
    trendBadge: "Session-aware insights",
    genrePulse: genrePulse as GenrePulse[],
    moodData: moodData as MoodPoint[],
    forgottenFavorites: forgottenFavorites as FavoriteTrack[],
    playlistInsights: playlistInsights as PlaylistInsight[],
    sourceLabel: "Preview dataset",
    moodSource: "Genre-based preview model",
    range: "week",
  };
}

function getTopListData(mode: DashboardViewProps["mode"], topLists?: TopListsData): TopListsData {
  if (mode === "authenticated" && topLists) {
    return topLists;
  }

  return previewTopLists;
}

function formatTimestamp(value?: string) {
  if (!value) {
    return null;
  }

  return `${new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value))} UTC`;
}

function Artwork({ item, label }: { item: ArtworkCardItem; label: string }) {
  if (item.imageUrl) {
    return (
      <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-[24px] border border-white/10 bg-white/5 shadow-[0_12px_30px_rgba(0,0,0,0.24)]">
        <Image src={item.imageUrl} alt={label} fill sizes="80px" className="object-cover" />
      </div>
    );
  }

  return (
    <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-[24px] border border-dashed border-white/15 bg-white/[0.04] text-xs font-medium uppercase tracking-[0.18em] text-ink/50">
      Art
    </div>
  );
}

export function DashboardView({
  mode = "preview",
  insights,
  selectedRange = "week",
  topLists,
  selectedTopRange = "medium_term",
}: DashboardViewProps) {
  const isPreview = mode === "preview";
  const data = getData(mode, insights);
  const topListData = getTopListData(mode, topLists);
  const playlist = buildRediscoveryPlaylist(data.forgottenFavorites);
  const cachedAtLabel = formatTimestamp(data.cachedAt);
  const generatedAtLabel = formatTimestamp(topListData.generatedAt);

  return (
    <>
      <section id="dashboard" className="px-6 py-20 md:px-10">
        <div className="mx-auto max-w-7xl space-y-10">
          <div className="max-w-2xl space-y-3">
            <p className="text-sm uppercase tracking-[0.32em] text-cyan/70">
              {isPreview ? "Dashboard Preview" : "Dashboard"}
            </p>
            <h2 className="font-display text-3xl font-semibold tracking-tight text-white md:text-4xl">
              A living snapshot of how your taste moves.
            </h2>
            <p className="text-base leading-7 text-ink/80">
              {isPreview
                ? "The MVP dashboard turns Spotify history into immediate signals: where your hours go, how your energy shifts, and which genres are quietly taking over your library."
                : "Your connected dashboard now shifts between real weekly, monthly, and all-time history derived from cached Spotify snapshots."}
            </p>
            <div className="space-y-1">
              <p className="text-sm text-mint">{data.sourceLabel}</p>
              <p className="text-xs text-ink/55">Mood model: {data.moodSource}</p>
              {cachedAtLabel ? <p className="text-xs text-ink/55">Last snapshot: {cachedAtLabel}</p> : null}
              {data.snapshotCount ? <p className="text-xs text-ink/55">Snapshots available: {data.snapshotCount}</p> : null}
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            {timeframeTabs.map((tab) => {
              const active = (isPreview ? "week" : selectedRange) === tab.key;
              const className = `rounded-full px-4 py-2 text-sm transition ${
                active ? "bg-white text-slate-950" : "border border-white/10 bg-white/5 text-ink/80"
              }`;

              if (isPreview) {
                return (
                  <button key={tab.key} className={className}>
                    {tab.label}
                  </button>
                );
              }

              return (
                <Link key={tab.key} href={`/dashboard?range=${tab.key}&topRange=${selectedTopRange}`} className={className}>
                  {tab.label}
                </Link>
              );
            })}
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {data.statCards.map((stat, index) => {
              const icons = [Clock3, LibraryBig, Flame, Radar];
              const Icon = icons[index % icons.length];

              return (
                <div key={stat.label} className="glass-panel rounded-[28px] p-5">
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-ink/60">{stat.label}</p>
                    <Icon className="h-5 w-5 text-cyan" />
                  </div>
                  <p className="mt-4 font-display text-3xl text-white">{stat.value}</p>
                  <p className="mt-2 text-sm text-mint">{stat.delta}</p>
                </div>
              );
            })}
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
            <div className="glass-panel rounded-[32px] p-6">
              <div className="mb-6 flex items-center justify-between">
                <div>
                  <p className="text-sm uppercase tracking-[0.28em] text-cyan/70">Listening trend</p>
                  <h3 className="mt-2 font-display text-2xl text-white">{data.trendHeading}</h3>
                </div>
                <p className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-ink/70">
                  {data.trendBadge}
                </p>
              </div>
              <div className="h-[320px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.trendData}>
                    <defs>
                      <linearGradient id="minutesFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#31E7FF" stopOpacity={0.42} />
                        <stop offset="100%" stopColor="#31E7FF" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.08)" />
                    <XAxis dataKey="label" stroke="#7F8CB5" tickLine={false} axisLine={false} />
                    <YAxis stroke="#7F8CB5" tickLine={false} axisLine={false} />
                    <Tooltip
                      contentStyle={{
                        background: "rgba(9,15,28,0.94)",
                        borderRadius: 14,
                        border: "1px solid rgba(255,255,255,0.12)",
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="minutes"
                      stroke="#31E7FF"
                      strokeWidth={3}
                      fill="url(#minutesFill)"
                    />
                    <Bar dataKey="rediscovered" fill="#FFD166" radius={[8, 8, 0, 0]} barSize={22} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="glass-panel rounded-[32px] p-6">
              <p className="text-sm uppercase tracking-[0.28em] text-cyan/70">Genre pulse</p>
              <h3 className="mt-2 font-display text-2xl text-white">Top genres this month</h3>
              <div className="mt-6 h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.genrePulse} layout="vertical" margin={{ left: 10 }}>
                    <CartesianGrid horizontal={false} stroke="rgba(255,255,255,0.06)" />
                    <XAxis type="number" hide />
                    <YAxis
                      type="category"
                      dataKey="genre"
                      stroke="#A2AED0"
                      tickLine={false}
                      axisLine={false}
                      width={92}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "rgba(9,15,28,0.94)",
                        borderRadius: 14,
                        border: "1px solid rgba(255,255,255,0.12)",
                      }}
                    />
                    <Bar dataKey="hours" radius={[0, 16, 16, 0]} barSize={18}>
                      {data.genrePulse.map((entry) => (
                        <Cell key={entry.genre} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="glass-panel rounded-[32px] p-6">
              <p className="text-sm uppercase tracking-[0.28em] text-cyan/70">Mood analysis</p>
              <h3 className="mt-2 font-display text-2xl text-white">Your vibe this week</h3>
              <p className="mt-3 max-w-md text-sm leading-7 text-ink/75">{getVibeSummary(data.moodData)}</p>
              <div className="mt-6 h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={data.moodData}
                      dataKey="share"
                      nameKey="mood"
                      innerRadius={64}
                      outerRadius={96}
                      paddingAngle={4}
                    >
                      {data.moodData.map((entry, index) => {
                        const colors = ["#31E7FF", "#53F8B7", "#FF6B6B", "#FFD166", "#2B59FF"];
                        return <Cell key={entry.mood} fill={colors[index % colors.length]} />;
                      })}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        background: "rgba(9,15,28,0.94)",
                        borderRadius: 14,
                        border: "1px solid rgba(255,255,255,0.12)",
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="glass-panel rounded-[32px] p-6">
              <div className="mb-6">
                <p className="text-sm uppercase tracking-[0.28em] text-cyan/70">Mood heatmap</p>
                <h3 className="mt-2 font-display text-2xl text-white">Energy vs share breakdown</h3>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                {data.moodData.map((mood) => (
                  <div key={mood.mood} className="rounded-[28px] border border-white/10 bg-white/[0.03] p-5">
                    <div className="flex items-center justify-between">
                      <p className="font-medium text-white">{mood.mood}</p>
                      <p className="text-sm text-cyan">{mood.share}%</p>
                    </div>
                    <div className="mt-4 h-3 rounded-full bg-white/10">
                      <div
                        className="h-3 rounded-full bg-gradient-to-r from-cyan via-cobalt to-coral"
                        style={{ width: `${mood.energy}%` }}
                      />
                    </div>
                    <p className="mt-3 text-sm text-ink/70">Energy score {mood.energy}/100</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="px-6 py-20 md:px-10">
        <div className="mx-auto max-w-7xl space-y-10">
          <div className="max-w-2xl space-y-3">
            <p className="text-sm uppercase tracking-[0.32em] text-cyan/70">Top Lists</p>
            <h2 className="font-display text-3xl font-semibold tracking-tight text-white md:text-4xl">
              Your standout artists, songs, and albums at every horizon.
            </h2>
            <p className="text-base leading-7 text-ink/80">
              Switch between Spotify&apos;s short, medium, and long-term windows to see how your staples change over time.
            </p>
            <div className="space-y-1">
              <p className="text-sm text-mint">{topListData.sourceLabel}</p>
              {generatedAtLabel ? <p className="text-xs text-ink/55">Generated: {generatedAtLabel}</p> : null}
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            {topRangeTabs.map((tab) => {
              const active = (isPreview ? "medium_term" : selectedTopRange) === tab.key;
              const className = `rounded-full px-4 py-2 text-sm transition ${
                active ? "bg-white text-slate-950" : "border border-white/10 bg-white/5 text-ink/80"
              }`;

              if (isPreview) {
                return (
                  <button key={tab.key} className={className}>
                    {tab.label}
                  </button>
                );
              }

              return (
                <Link key={tab.key} href={`/dashboard?range=${selectedRange}&topRange=${tab.key}`} className={className}>
                  {tab.label}
                </Link>
              );
            })}
          </div>

          <div className="grid gap-6 xl:grid-cols-3">
            <div className="glass-panel rounded-[32px] p-6">
              <div className="mb-6 flex items-center gap-3">
                <Music2 className="h-5 w-5 text-cyan" />
                <div>
                  <p className="text-sm uppercase tracking-[0.28em] text-cyan/70">Top artists</p>
                  <h3 className="mt-2 font-display text-2xl text-white">Who leads the rotation</h3>
                </div>
              </div>
              <div className="space-y-4">
                {topListData.artists.map((artist) => (
                  <div key={artist.id} className="rounded-[24px] border border-white/10 bg-white/[0.03] p-4">
                    <div className="flex items-start gap-4">
                      <Artwork item={artist} label={artist.name} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <p className="font-medium text-white">{artist.name}</p>
                          <p className="text-sm text-cyan">#{artist.rank}</p>
                        </div>
                        <p className="mt-1 text-sm text-ink/70">
                          {artist.genres.length > 0 ? artist.genres.slice(0, 2).join(" - ") : "Genres unavailable"}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="glass-panel rounded-[32px] p-6">
              <div className="mb-6 flex items-center gap-3">
                <Disc3 className="h-5 w-5 text-gold" />
                <div>
                  <p className="text-sm uppercase tracking-[0.28em] text-cyan/70">Top songs</p>
                  <h3 className="mt-2 font-display text-2xl text-white">Tracks on repeat</h3>
                </div>
              </div>
              <div className="space-y-4">
                {topListData.tracks.map((track) => (
                  <div key={track.id} className="rounded-[24px] border border-white/10 bg-white/[0.03] p-4">
                    <div className="flex items-start gap-4">
                      <Artwork item={track} label={track.title} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <p className="font-medium text-white">{track.title}</p>
                          <p className="text-sm text-gold">#{track.rank}</p>
                        </div>
                        <p className="mt-1 text-sm text-ink/70">{track.artist}</p>
                        <p className="mt-1 text-xs uppercase tracking-[0.2em] text-ink/55">{track.album}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="glass-panel rounded-[32px] p-6">
              <div className="mb-6 flex items-center gap-3">
                <LibraryBig className="h-5 w-5 text-mint" />
                <div>
                  <p className="text-sm uppercase tracking-[0.28em] text-cyan/70">Top albums</p>
                  <h3 className="mt-2 font-display text-2xl text-white">Full projects that stick</h3>
                </div>
              </div>
              <div className="space-y-4">
                {topListData.albums.map((album) => (
                  <div key={album.id} className="rounded-[24px] border border-white/10 bg-white/[0.03] p-4">
                    <div className="flex items-start gap-4">
                      <Artwork item={album} label={album.name} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <p className="font-medium text-white">{album.name}</p>
                          <p className="text-sm text-mint">#{album.rank}</p>
                        </div>
                        <p className="mt-1 text-sm text-ink/70">{album.artist}</p>
                        <p className="mt-1 text-xs uppercase tracking-[0.2em] text-ink/55">
                          {album.trackCount} ranked track{album.trackCount === 1 ? "" : "s"} in this window
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="px-6 py-20 md:px-10">
        <div className="mx-auto max-w-7xl space-y-10">
          <div className="max-w-2xl space-y-3">
            <p className="text-sm uppercase tracking-[0.32em] text-cyan/70">Rediscovery</p>
            <h2 className="font-display text-3xl font-semibold tracking-tight text-white md:text-4xl">
              Bring buried favorites back into rotation.
            </h2>
            <p className="text-base leading-7 text-ink/80">
              SoundScope&apos;s rediscovery engine looks for songs you clearly loved, then checks how
              long they have been absent from recent listening so they can surface with context instead
              of pure randomness.
            </p>
          </div>

          <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
            <div className="glass-panel rounded-[32px] p-6">
              <div className="mb-6 flex items-center justify-between">
                <div>
                  <p className="text-sm uppercase tracking-[0.28em] text-cyan/70">Forgotten favorites</p>
                  <h3 className="mt-2 font-display text-2xl text-white">Tracks worth replaying tonight</h3>
                </div>
                <div className="rounded-full border border-white/10 bg-white/5 p-3">
                  <Disc3 className="h-5 w-5 text-gold" />
                </div>
              </div>
              <div className="space-y-4">
                {data.forgottenFavorites.map((track) => (
                  <div key={track.title} className="rounded-[26px] border border-white/10 bg-white/[0.03] p-5">
                    <div className="flex items-start gap-4">
                      <Artwork item={track} label={track.title} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="font-display text-xl text-white">{track.title}</p>
                            <p className="mt-1 text-sm text-ink/70">
                              {track.artist} - {track.album}
                            </p>
                          </div>
                          <p className="rounded-full border border-mint/20 bg-mint/10 px-3 py-1 text-xs text-mint">
                            {track.affinity}% affinity
                          </p>
                        </div>
                        <p className="mt-4 text-sm text-ink/70">Last played {track.lastPlayed}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="glass-panel rounded-[32px] p-6">
              <div className="mb-6 flex items-center gap-3">
                <Sparkles className="h-5 w-5 text-cyan" />
                <div>
                  <p className="text-sm uppercase tracking-[0.28em] text-cyan/70">Auto playlist</p>
                  <h3 className="mt-2 font-display text-2xl text-white">Rediscovery queue logic</h3>
                </div>
              </div>
              <div className="space-y-4">
                {playlist.map((item) => (
                  <div
                    key={item.slot}
                    className="flex items-center justify-between rounded-[24px] border border-white/10 bg-white/[0.03] px-4 py-4"
                  >
                    <div className="flex items-center gap-4">
                      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-cobalt/20 font-display text-white">
                        {item.slot}
                      </div>
                      <div>
                        <p className="font-medium text-white">{item.label}</p>
                        <p className="mt-1 text-sm text-ink/70">{item.reason}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-6 rounded-[26px] border border-cyan/15 bg-cyan/10 p-5">
                <p className="text-sm uppercase tracking-[0.24em] text-cyan/80">Current logic</p>
                <p className="mt-3 text-sm leading-7 text-ink/80">
                  Rediscovery now blends your short-term favorites, long-term top tracks, saved library,
                  and recent-play gaps into one resurfacing score.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="px-6 py-20 md:px-10">
        <div className="mx-auto max-w-7xl space-y-10">
          <div className="max-w-2xl space-y-3">
            <p className="text-sm uppercase tracking-[0.32em] text-cyan/70">Playlist Lab</p>
            <h2 className="font-display text-3xl font-semibold tracking-tight text-white md:text-4xl">
              A preview of playlist intelligence beyond basic counts.
            </h2>
            <p className="text-base leading-7 text-ink/80">
              Playlist analysis now uses real Spotify playlist contents, and each card opens a deeper breakdown with genre, mood, and overlap details.
            </p>
          </div>

          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-ink/65">Open any playlist to inspect its structure in more detail.</p>
            {!isPreview ? (
              <Link href="/dashboard/playlists" className="rounded-full border border-cyan/20 bg-cyan/10 px-4 py-2 text-sm text-cyan">
                View all playlists
              </Link>
            ) : null}
          </div>

          <div className="grid gap-5 lg:grid-cols-3">
            {data.playlistInsights.map((playlistCard) => {
              const content = (
                <>
                  {playlistCard.imageUrl ? (
                    <div className="relative mb-5 h-40 overflow-hidden rounded-[28px] border border-white/10 bg-white/5">
                      <Image
                        src={playlistCard.imageUrl}
                        alt={playlistCard.name}
                        fill
                        sizes="(max-width: 1024px) 100vw, 420px"
                        className="object-cover"
                      />
                    </div>
                  ) : null}
                  <p className="text-sm uppercase tracking-[0.24em] text-cyan/70">Playlist insight</p>
                  <h3 className="mt-3 font-display text-2xl text-white">{playlistCard.name}</h3>
                  {playlistCard.trackCount ? <p className="mt-2 text-sm text-cyan">{playlistCard.trackCount} tracks analyzed</p> : null}
                  <div className="mt-6 space-y-4">
                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                      <p className="text-sm text-ink/60">Mood consistency</p>
                      <p className="mt-2 text-white">{playlistCard.mood}</p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                      <p className="text-sm text-ink/60">Genre diversity</p>
                      <p className="mt-2 text-white">{playlistCard.diversity}</p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                      <p className="text-sm text-ink/60">Redundancy</p>
                      <p className="mt-2 text-white">{playlistCard.overlap}</p>
                    </div>
                  </div>
                </>
              );

              if (!isPreview && playlistCard.id) {
                return (
                  <Link
                    key={playlistCard.id}
                    href={`/dashboard/playlists/${playlistCard.id}`}
                    className="glass-panel rounded-[30px] p-6 transition hover:border-cyan/40 hover:bg-white/[0.05]"
                  >
                    {content}
                  </Link>
                );
              }

              return (
                <div key={playlistCard.name} className="glass-panel rounded-[30px] p-6">
                  {content}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section id="roadmap" className="px-6 py-20 pb-28 md:px-10">
        <div className="mx-auto max-w-7xl overflow-hidden rounded-[36px] border border-white/10 bg-white/[0.03]">
          <div className="grid gap-0 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="border-b border-white/10 p-8 lg:border-b-0 lg:border-r lg:p-10">
              <p className="text-sm uppercase tracking-[0.32em] text-cyan/70">Build path</p>
              <h2 className="mt-4 max-w-md font-display text-4xl font-semibold tracking-tight text-white">
                A strong MVP now, real Spotify intelligence next.
              </h2>
              <p className="mt-5 max-w-lg text-base leading-7 text-ink/75">
                This foundation is intentionally shaped around the PRD so we can swap mock insight
                blocks with live Spotify and MongoDB data without redesigning the whole experience.
              </p>
            </div>
            <div className="p-8 lg:p-10">
              <div className="space-y-5">
                {roadmap.map((item, index) => (
                  <div key={item.phase} className="rounded-[28px] border border-white/10 bg-night/70 p-5">
                    <div className="flex items-center gap-4">
                      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-cyan/15 font-display text-white">
                        0{index + 1}
                      </div>
                      <div>
                        <p className="font-medium text-white">{item.phase}</p>
                        <p className="mt-1 text-sm leading-7 text-ink/70">{item.detail}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}