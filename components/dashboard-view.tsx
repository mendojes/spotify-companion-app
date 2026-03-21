"use client";

import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { Clock3, Flame, LibraryBig, Radar, Sparkles, Waves } from "lucide-react";
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
    detail: "Spotify OAuth, top tracks and artists, basic mood analysis, forgotten favorites, and the MongoDB cache layer.",
  },
  {
    phase: "Insight expansion",
    detail: "Playlist analysis, richer trend visualizations, session heuristics, and a sharper rediscovery engine.",
  },
  {
    phase: "Portfolio polish",
    detail: "Animated transitions, AI playlist generation, social sharing, and compare-with-friends mechanics.",
  },
];

type DashboardViewProps = {
  mode?: "preview" | "authenticated";
  insights?: DashboardInsights;
  selectedRange?: DashboardRange;
  topLists?: TopListsData;
  heroTopLists?: TopListsData;
  selectedTopRange?: SpotifyTimeRange;
  sidebar?: ReactNode;
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

const moodColors = ["#7AF7FF", "#6E82FF", "#FF5EC9", "#FFD37B", "#8EFFD1"];

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

  return {
    ...previewTopLists,
    artists: previewTopLists.artists.slice(0, 5),
    tracks: previewTopLists.tracks.slice(0, 5),
    albums: previewTopLists.albums.slice(0, 5),
  };
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

function Artwork({
  imageUrl,
  label,
  size = "md",
}: {
  imageUrl?: string;
  label: string;
  size?: "sm" | "md" | "lg";
}) {
  const dimensions = size === "lg" ? "h-32 w-32 rounded-[26px]" : size === "sm" ? "h-20 w-20 rounded-[20px]" : "h-24 w-24 rounded-[22px]";

  if (imageUrl) {
    return (
      <div className={`media-frame relative shrink-0 ${dimensions} p-1.5`}>
        <Image src={imageUrl} alt={label} fill sizes="128px" className="rounded-[18px] object-cover p-1.5" />
      </div>
    );
  }

  return (
    <div className={`media-frame flex shrink-0 items-center justify-center ${dimensions} p-3 font-mono text-xl uppercase tracking-[0.16em] text-ink/60`}>
      art
    </div>
  );
}

function SectionHeader({ kicker, title, copy, meta }: { kicker: string; title: string; copy: string; meta?: ReactNode }) {
  return (
    <div className="max-w-4xl space-y-3">
      <p className="section-kicker">{kicker}</p>
      <h2 className="font-display text-4xl font-bold uppercase tracking-[0.08em] text-white md:text-5xl xl:text-6xl">{title}</h2>
      <p className="max-w-3xl text-base leading-8 text-ink/78 md:text-lg">{copy}</p>
      {meta ? <div className="space-y-1 text-sm text-ink/65">{meta}</div> : null}
    </div>
  );
}

function TabPill({ active, children, href }: { active: boolean; children: ReactNode; href?: string }) {
  const className = `rounded-full px-4 py-2 font-mono text-lg uppercase tracking-[0.16em] transition ${
    active
      ? "neon-outline bg-[linear-gradient(135deg,rgba(255,214,243,0.95),rgba(255,94,201,0.95)_32%,rgba(110,130,255,0.95)_68%,rgba(122,247,255,0.95))] text-[#170718]"
      : "chrome-line bg-white/[0.05] text-ink/82 hover:border-cyan/40 hover:text-white"
  }`;

  if (!href) {
    return <button className={className}>{children}</button>;
  }

  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}

function getAdaptiveValueClass(value: string) {
  if (value.length > 22) {
    return "text-2xl md:text-3xl leading-[0.92] break-words";
  }

  if (value.length > 14) {
    return "text-3xl md:text-[2.15rem] leading-[0.92] break-words";
  }

  return "text-3xl md:text-4xl leading-[0.92]";
}

function MetricWindow({
  label,
  value,
  detail,
  icon: Icon,
  backgroundImage,
}: {
  label: string;
  value: string;
  detail: string;
  icon: React.ComponentType<{ className?: string }>;
  backgroundImage?: string;
}) {
  return (
    <div className="window-panel relative flex h-full min-h-[18rem] flex-col overflow-hidden p-5 pt-14">
      {backgroundImage ? (
        <>
          <Image src={backgroundImage} alt={label} fill sizes="(max-width: 1280px) 100vw, 420px" className="object-cover opacity-30" />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(17,8,31,0.2),rgba(17,8,31,0.86)_48%,rgba(17,8,31,0.96))]" />
        </>
      ) : null}
      <div className="relative z-10 flex h-full flex-col">
        <div className="flex items-center justify-between gap-3">
          <p className="font-mono text-lg uppercase tracking-[0.16em] text-ink/78">{label}</p>
          <Icon className="h-5 w-5 text-cyan" />
        </div>
        <div className="mt-5 flex-1">
          <p className={`font-display uppercase tracking-[0.08em] text-white drop-shadow-[0_4px_18px_rgba(0,0,0,0.42)] ${getAdaptiveValueClass(value)}`}>{value}</p>
        </div>
        <p className="mt-4 text-sm text-peach">{detail}</p>
      </div>
    </div>
  );
}

function TrendMarquee({ tracks }: { tracks: TopListsData["tracks"] }) {
  const items = [...tracks, ...tracks];

  return (
    <div className="marquee-strip rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 font-mono text-lg uppercase tracking-[0.18em] text-ink/80">
      <div>
        {items.map((track, index) => (
          <span key={`${track.id}-${index}`}>{track.title} / {track.artist}</span>
        ))}
      </div>
    </div>
  );
}

export function DashboardView({
  mode = "preview",
  insights,
  selectedRange = "week",
  topLists,
  heroTopLists,
  selectedTopRange = "medium_term",
  sidebar,
}: DashboardViewProps) {
  const isPreview = mode === "preview";
  const data = getData(mode, insights);
  const topListData = getTopListData(mode, topLists);
  const heroTopListData = getTopListData(mode, heroTopLists ?? topLists);
  const playlist = buildRediscoveryPlaylist(data.forgottenFavorites);
  const cachedAtLabel = formatTimestamp(data.cachedAt);
  const generatedAtLabel = formatTimestamp(topListData.generatedAt);
  const leadArtist = heroTopListData.artists[0];
  const leadTrack = heroTopListData.tracks[0];
  const leadAlbum = heroTopListData.albums[0];
  const listeningCard = data.statCards[0];
  const heroStatCards: Array<{
    label: string;
    value: string;
    detail: string;
    icon: React.ComponentType<{ className?: string }>;
    backgroundImage?: string;
  }> = [];

  if (listeningCard) {
    heroStatCards.push({
      label: listeningCard.label,
      value: listeningCard.value,
      detail: listeningCard.delta,
      icon: Clock3,
      backgroundImage: undefined,
    });
  }

  if (leadArtist) {
    heroStatCards.push({
      label: "Top artist",
      value: leadArtist.name,
      detail: leadArtist.genres.length > 0 ? leadArtist.genres.slice(0, 2).join(" / ") : "Spotify top artist",
      icon: LibraryBig,
      backgroundImage: leadArtist.imageUrl,
    });
  }

  if (leadTrack) {
    heroStatCards.push({
      label: "Top track",
      value: leadTrack.title,
      detail: leadTrack.artist,
      icon: Flame,
      backgroundImage: leadTrack.imageUrl,
    });
  }

  if (leadAlbum) {
    heroStatCards.push({
      label: "Top album",
      value: leadAlbum.name,
      detail: leadAlbum.artist,
      icon: Sparkles,
      backgroundImage: leadAlbum.imageUrl,
    });
  }

  return (
    <>
      <section id="dashboard" className="px-6 py-10 md:px-10">
        <div className="mx-auto max-w-7xl space-y-8">
          <TrendMarquee tracks={topListData.tracks} />

          <div className={sidebar && !isPreview ? "grid gap-8 2xl:grid-cols-[minmax(0,1fr)_420px] 2xl:items-start" : "space-y-8"}>
            <div className="min-w-0">
              <div className="glass-panel rounded-[40px] px-6 py-7 md:px-8 md:py-8 xl:px-10">
                <div className="absolute inset-x-0 top-0 h-24 bg-[linear-gradient(180deg,rgba(255,255,255,0.18),transparent)]" />
                <div className="relative z-10 space-y-6">
                  <SectionHeader
                    kicker={isPreview ? "Dashboard preview" : "Live interface"}
                    title="A scrapbook dashboard for your listening life"
                    copy={
                      isPreview
                        ? "The preview leans into a collage of artwork, taste signals, and retro widgets so the experience feels collectible and alive instead of boxed into a standard analytics grid."
                        : "Your Spotify history now lives inside a louder, image-heavy interface with trend windows and playlist panels that feel like a saved portal from 2002."
                    }
                    meta={
                      <>
                        <p className="text-cyan">{data.sourceLabel}</p>
                        <p>Mood model: {data.moodSource}</p>
                        {cachedAtLabel ? <p>Last snapshot: {cachedAtLabel}</p> : null}
                      </>
                    }
                  />

                  <div className="flex flex-wrap gap-3">
                    {timeframeTabs.map((tab) => {
                      const active = (isPreview ? "week" : selectedRange) === tab.key;
                      const href = isPreview ? undefined : `/dashboard?range=${tab.key}&topRange=${selectedTopRange}`;

                      return (
                        <TabPill key={tab.key} active={active} href={href}>
                          {tab.label}
                        </TabPill>
                      );
                    })}
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    {heroStatCards.map((stat) => (
                      <MetricWindow
                        key={stat.label}
                        label={stat.label}
                        value={stat.value}
                        detail={stat.detail}
                        icon={stat.icon}
                        backgroundImage={stat.backgroundImage}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {sidebar && !isPreview ? <div className="min-w-0">{sidebar}</div> : null}
          </div>

          <div className="grid gap-6 2xl:grid-cols-[1.2fr_0.8fr]">
                <div className="window-panel p-6 pt-16 md:p-7 md:pt-16">
                  <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="section-kicker">Listening trend</p>
                      <h3 className="mt-2 font-display text-3xl uppercase tracking-[0.08em] text-white">{data.trendHeading}</h3>
                    </div>
                    <span className="pixel-chip text-cyan">{data.trendBadge}</span>
                  </div>
                  <div className="h-[330px] rounded-[24px] border border-white/10 bg-white/[0.04] p-3">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={data.trendData}>
                        <defs>
                          <linearGradient id="minutesFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#7AF7FF" stopOpacity={0.52} />
                            <stop offset="100%" stopColor="#7AF7FF" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.08)" />
                        <XAxis dataKey="label" stroke="#FFF6F4" tickLine={false} axisLine={false} />
                        <YAxis stroke="#FFF6F4" tickLine={false} axisLine={false} />
                        <Tooltip contentStyle={{ background: "rgba(17,8,31,0.95)", borderRadius: 18, border: "1px solid rgba(255,255,255,0.14)" }} />
                        <Area type="monotone" dataKey="minutes" stroke="#7AF7FF" strokeWidth={3} fill="url(#minutesFill)" />
                        <Bar dataKey="rediscovered" fill="#FF5EC9" radius={[10, 10, 0, 0]} barSize={20} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="glass-panel rounded-[34px] p-6 md:p-7">
                  <p className="section-kicker">Genre pulse</p>
                  <h3 className="mt-2 font-display text-3xl uppercase tracking-[0.08em] text-white">Top lanes this month</h3>
                  <div className="mt-6 h-[300px] rounded-[24px] border border-white/10 bg-white/[0.04] p-3">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data.genrePulse} layout="vertical" margin={{ left: 8 }}>
                        <CartesianGrid horizontal={false} stroke="rgba(255,255,255,0.06)" />
                        <XAxis type="number" hide />
                        <YAxis type="category" dataKey="genre" stroke="#FFF6F4" tickLine={false} axisLine={false} width={96} />
                        <Tooltip contentStyle={{ background: "rgba(17,8,31,0.95)", borderRadius: 18, border: "1px solid rgba(255,255,255,0.14)" }} />
                        <Bar dataKey="hours" radius={[0, 14, 14, 0]} barSize={18}>
                          {data.genrePulse.map((entry) => (
                            <Cell key={entry.genre} fill={entry.color} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="mt-5 grid gap-3">
                    {data.genrePulse.slice(0, 3).map((genre) => (
                      <div key={genre.genre} className="rounded-[22px] border border-white/10 bg-white/[0.05] px-4 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-display text-lg uppercase tracking-[0.08em] text-white">{genre.genre}</span>
                          <span className="font-mono text-xl uppercase text-cyan">{genre.hours}h</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="grid gap-6 2xl:grid-cols-[0.88fr_1.12fr]">
                <div className="glass-panel rounded-[34px] p-6 md:p-7">
                  <p className="section-kicker">Mood analysis</p>
                  <h3 className="mt-2 font-display text-3xl uppercase tracking-[0.08em] text-white">Vibe radar</h3>
                  <p className="mt-3 max-w-md text-sm leading-7 text-ink/76">{getVibeSummary(data.moodData)}</p>
                  <div className="mt-6 h-[270px] rounded-[24px] border border-white/10 bg-white/[0.04] p-3">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={data.moodData} dataKey="share" nameKey="mood" innerRadius={62} outerRadius={98} paddingAngle={4}>
                          {data.moodData.map((entry, index) => (
                            <Cell key={entry.mood} fill={moodColors[index % moodColors.length]} />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={{ background: "rgba(17,8,31,0.95)", borderRadius: 18, border: "1px solid rgba(255,255,255,0.14)" }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="window-panel p-6 pt-16 md:p-7 md:pt-16">
                  <div className="mb-6 flex items-center justify-between gap-3">
                    <div>
                      <p className="section-kicker">Mood heatmap</p>
                      <h3 className="mt-2 font-display text-3xl uppercase tracking-[0.08em] text-white">Energy vs share</h3>
                    </div>
                    <Waves className="h-5 w-5 text-cyan" />
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    {data.moodData.map((mood, index) => (
                      <div key={mood.mood} className="rounded-[24px] border border-white/10 bg-white/[0.05] p-5">
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-display text-xl uppercase tracking-[0.08em] text-white">{mood.mood}</p>
                          <p className="font-mono text-xl uppercase text-cyan">{mood.share}%</p>
                        </div>
                        <div className="mt-4 h-3 rounded-full bg-white/10">
                          <div
                            className="h-3 rounded-full"
                            style={{
                              width: `${mood.energy}%`,
                              background: `linear-gradient(90deg, ${moodColors[index % moodColors.length]}, #FFD37B)`,
                            }}
                          />
                        </div>
                        <p className="mt-3 text-sm text-ink/68">Energy score {mood.energy}/100</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
        </div>
      </section>

      <section className="px-6 py-20 md:px-10">
        <div className="mx-auto max-w-7xl space-y-10">
          <SectionHeader
            kicker="Top lists"
            title="Album-art walls and rotating favorites"
            copy="Each ranking is now built like a collectible media shelf, with art-forward cards instead of plain list rows."
            meta={
              <>
                <p className="text-cyan">{topListData.sourceLabel}</p>
                {generatedAtLabel ? <p>Generated: {generatedAtLabel}</p> : null}
              </>
            }
          />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-3">
              {topRangeTabs.map((tab) => {
                const active = (isPreview ? "medium_term" : selectedTopRange) === tab.key;
                const href = isPreview ? undefined : `/dashboard?range=${selectedRange}&topRange=${tab.key}`;

                return (
                  <TabPill key={tab.key} active={active} href={href}>
                    {tab.label}
                  </TabPill>
                );
              })}
            </div>
            {!isPreview ? (
              <Link
                href={`/dashboard/top-lists?range=${selectedTopRange}&tab=artists&page=1`}
                className="chrome-line rounded-full bg-white/[0.05] px-4 py-2 font-mono text-lg uppercase tracking-[0.14em] text-gold transition hover:border-gold/35 hover:bg-gold/10"
              >
                View all rankings
              </Link>
            ) : null}
          </div>

          <div className="grid gap-6 xl:grid-cols-3">
            <div className="glass-panel rounded-[34px] p-6">
              <div className="mb-6 flex items-center gap-3">
                <LibraryBig className="h-5 w-5 text-cyan" />
                <div>
                  <p className="section-kicker">Top artists</p>
                  <h3 className="mt-2 font-display text-3xl uppercase tracking-[0.08em] text-white">Faces of the era</h3>
                </div>
              </div>
              <div className="space-y-4">
                {topListData.artists.map((artist) => (
                  <div key={artist.id} className="rounded-[26px] border border-white/10 bg-white/[0.05] p-4">
                    <div className="flex items-start gap-4">
                      <Artwork imageUrl={artist.imageUrl} label={artist.name} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <p className="pr-3 font-display text-xl uppercase leading-tight tracking-[0.08em] text-white md:text-2xl">{artist.name}</p>
                          <p className="font-mono text-xl uppercase text-cyan">#{artist.rank}</p>
                        </div>
                        <p className="mt-2 text-sm text-ink/70">
                          {artist.genres.length > 0 ? artist.genres.slice(0, 2).join(" / ") : "Genres unavailable"}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="glass-panel rounded-[34px] p-6">
              <div className="mb-6 flex items-center gap-3">
                <Flame className="h-5 w-5 text-coral" />
                <div>
                  <p className="section-kicker">Top songs</p>
                  <h3 className="mt-2 font-display text-3xl uppercase tracking-[0.08em] text-white">Tracks on repeat</h3>
                </div>
              </div>
              <div className="space-y-4">
                {topListData.tracks.map((track) => (
                  <div key={track.id} className="rounded-[26px] border border-white/10 bg-white/[0.05] p-4">
                    <div className="flex items-start gap-4">
                      <Artwork imageUrl={track.imageUrl} label={track.title} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <p className="pr-3 font-display text-xl uppercase leading-tight tracking-[0.08em] text-white md:text-2xl">{track.title}</p>
                          <p className="font-mono text-xl uppercase text-gold">#{track.rank}</p>
                        </div>
                        <p className="mt-2 text-sm text-ink/70">{track.artist}</p>
                        <p className="mt-1 font-mono text-lg uppercase tracking-[0.12em] text-ink/55">{track.album}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="glass-panel rounded-[34px] p-6">
              <div className="mb-6 flex items-center gap-3">
                <Sparkles className="h-5 w-5 text-gold" />
                <div>
                  <p className="section-kicker">Top albums</p>
                  <h3 className="mt-2 font-display text-3xl uppercase tracking-[0.08em] text-white">Projects that stick</h3>
                </div>
              </div>
              <div className="space-y-4">
                {topListData.albums.map((album) => (
                  <div key={album.id} className="rounded-[26px] border border-white/10 bg-white/[0.05] p-4">
                    <div className="flex items-start gap-4">
                      <Artwork imageUrl={album.imageUrl} label={album.name} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <p className="pr-3 font-display text-xl uppercase leading-tight tracking-[0.08em] text-white md:text-2xl">{album.name}</p>
                          <p className="font-mono text-xl uppercase text-mint">#{album.rank}</p>
                        </div>
                        <p className="mt-2 text-sm text-ink/70">{album.artist}</p>
                        <p className="mt-1 font-mono text-lg uppercase tracking-[0.12em] text-ink/55">
                          {album.trackCount} ranked track{album.trackCount === 1 ? "" : "s"}
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
          <SectionHeader
            kicker="Rediscovery"
            title="Bring buried favorites back with a little drama"
            copy="The rediscovery area now behaves like a memory wall, with spotlight artwork and supporting widgets for why each track deserves a return."
          />

          <div className="grid gap-6 lg:grid-cols-[1.08fr_0.92fr]">
            <div className="glass-panel rounded-[36px] p-6 md:p-7">
              <div className="grid gap-5 md:grid-cols-[1.05fr_0.95fr]">
                <div className="media-frame relative min-h-[420px] p-2">
                  {data.forgottenFavorites[0]?.imageUrl ? (
                    <Image
                      src={data.forgottenFavorites[0].imageUrl}
                      alt={data.forgottenFavorites[0].title}
                      fill
                      sizes="(max-width: 1280px) 100vw, 500px"
                      className="rounded-[22px] object-cover p-1.5"
                    />
                  ) : null}
                  <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent,rgba(11,4,18,0.82))]" />
                  <div className="absolute bottom-6 left-6 right-6 rounded-[24px] border border-white/20 bg-black/20 p-5 backdrop-blur-md">
                    <p className="section-kicker">Spotlight replay</p>
                    <h3 className="mt-2 font-display text-4xl uppercase tracking-[0.08em] text-white">{data.forgottenFavorites[0]?.title}</h3>
                    <p className="mt-2 text-sm uppercase tracking-[0.2em] text-ink/78">{data.forgottenFavorites[0]?.artist} / {data.forgottenFavorites[0]?.album}</p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <span className="pixel-chip text-mint">{data.forgottenFavorites[0]?.affinity}% affinity</span>
                      <span className="pixel-chip text-gold">{data.forgottenFavorites[0]?.lastPlayed}</span>
                    </div>
                  </div>
                </div>
                <div className="space-y-4">
                  {data.forgottenFavorites.slice(1).map((track) => (
                    <div key={track.title} className="rounded-[28px] border border-white/10 bg-white/[0.05] p-4">
                      <div className="flex items-start gap-4">
                        <Artwork imageUrl={track.imageUrl} label={track.title} size="sm" />
                        <div className="min-w-0 flex-1">
                          <p className="font-display text-xl uppercase tracking-[0.08em] text-white">{track.title}</p>
                          <p className="mt-1 text-sm text-ink/70">{track.artist} / {track.album}</p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <span className="rounded-full border border-mint/20 bg-mint/10 px-3 py-1 text-xs uppercase tracking-[0.18em] text-mint">
                              {track.affinity}% affinity
                            </span>
                            <span className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-xs uppercase tracking-[0.18em] text-ink/68">
                              {track.lastPlayed}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="window-panel p-6 pt-16 md:p-7 md:pt-16">
              <div className="mb-6 flex items-center gap-3">
                <Sparkles className="h-5 w-5 text-gold" />
                <div>
                  <p className="section-kicker">Auto playlist</p>
                  <h3 className="mt-2 font-display text-3xl uppercase tracking-[0.08em] text-white">Rediscovery queue logic</h3>
                </div>
              </div>
              <div className="space-y-4">
                {playlist.map((item, index) => (
                  <div key={item.slot} className={`flex items-center justify-between rounded-[24px] border px-4 py-4 ${index === 0 ? "border-cyan/25 bg-cyan/10" : "border-white/10 bg-white/[0.05]"}`}>
                    <div className="flex items-center gap-4">
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,rgba(255,214,243,0.95),rgba(255,94,201,0.95)_32%,rgba(110,130,255,0.95)_68%,rgba(122,247,255,0.95))] font-display text-[#170718]">
                        {item.slot}
                      </div>
                      <div>
                        <p className="font-display text-lg uppercase tracking-[0.08em] text-white">{item.label}</p>
                        <p className="mt-1 text-sm text-ink/70">{item.reason}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-6 rounded-[24px] border border-cyan/20 bg-cyan/10 p-5">
                <p className="font-mono text-lg uppercase tracking-[0.18em] text-cyan/80">Current logic</p>
                <p className="mt-3 text-sm leading-7 text-ink/82">
                  Short-term favorites, long-term staples, saved-library affinity, and recent-play gaps now get surfaced as a more collectible queue instead of a simple text list.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="px-6 py-20 md:px-10">
        <div className="mx-auto max-w-7xl space-y-10">
          <SectionHeader
            kicker="Playlist lab"
            title="Playlist intelligence as a glossy media wall"
            copy="Playlist cards now feel like mini magazine covers, so the mood and overlap data sits on top of artwork instead of beside it."
          />

          <div className="flex items-center justify-between gap-4">
            <p className="font-mono text-lg uppercase tracking-[0.12em] text-ink/65">Open any playlist to inspect its structure in more detail.</p>
            {!isPreview ? (
              <Link href="/dashboard/playlists" className="chrome-line rounded-full bg-cyan/10 px-4 py-2 font-mono text-lg uppercase tracking-[0.14em] text-cyan">
                View all playlists
              </Link>
            ) : null}
          </div>

          <div className="grid gap-5 lg:grid-cols-3">
            {data.playlistInsights.map((playlistCard, index) => {
              const content = (
                <>
                  {playlistCard.imageUrl ? (
                    <div className="media-frame relative mb-5 h-60 p-2">
                      <Image src={playlistCard.imageUrl} alt={playlistCard.name} fill sizes="(max-width: 1024px) 100vw, 420px" className="rounded-[22px] object-cover p-1.5" />
                      <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent,rgba(11,4,18,0.82))]" />
                      <div className="absolute bottom-5 left-5 right-5 flex items-end justify-between gap-3">
                        <div>
                          <p className="section-kicker">Playlist insight</p>
                          <h3 className="mt-2 font-display text-3xl uppercase tracking-[0.08em] text-white">{playlistCard.name}</h3>
                        </div>
                        <div className="rounded-full border border-white/20 bg-black/20 px-3 py-1 font-mono text-lg text-cyan">0{index + 1}</div>
                      </div>
                    </div>
                  ) : null}
                  <div className="grid gap-4">
                    <div className="rounded-[22px] border border-white/10 bg-white/[0.05] p-4">
                      <p className="font-mono text-lg uppercase tracking-[0.16em] text-ink/60">Mood consistency</p>
                      <p className="mt-2 text-white">{playlistCard.mood}</p>
                    </div>
                    <div className="rounded-[22px] border border-white/10 bg-white/[0.05] p-4">
                      <p className="font-mono text-lg uppercase tracking-[0.16em] text-ink/60">Genre diversity</p>
                      <p className="mt-2 text-white">{playlistCard.diversity}</p>
                    </div>
                    <div className="rounded-[22px] border border-white/10 bg-white/[0.05] p-4">
                      <p className="font-mono text-lg uppercase tracking-[0.16em] text-ink/60">Redundancy</p>
                      <p className="mt-2 text-white">{playlistCard.overlap}</p>
                    </div>
                  </div>
                </>
              );

              const className = `glass-panel rounded-[32px] p-6 transition ${index === 0 ? "shadow-glow" : ""}`;

              if (!isPreview && playlistCard.id) {
                return (
                  <Link key={playlistCard.id} href={`/dashboard/playlists/${playlistCard.id}`} className={`${className} hover:border-cyan/40 hover:bg-white/[0.05]`}>
                    {content}
                  </Link>
                );
              }

              return (
                <div key={playlistCard.name} className={className}>
                  {content}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section id="roadmap" className="px-6 py-20 pb-28 md:px-10">
        <div className="mx-auto max-w-7xl window-panel p-8 pt-16 md:p-10 md:pt-16">
          <div className="grid gap-8 lg:grid-cols-[0.92fr_1.08fr] lg:items-start">
            <div>
              <p className="section-kicker">Build path</p>
              <h2 className="mt-4 max-w-md font-display text-5xl font-bold uppercase tracking-[0.08em] text-white md:text-6xl">
                Stronger MVP now, louder music intelligence next.
              </h2>
              <p className="mt-5 max-w-lg text-base leading-8 text-ink/75">
                The new shell is designed so richer live data can keep slotting into a distinct visual identity without drifting back into generic analytics tiles.
              </p>
            </div>
            <div className="space-y-5">
              {roadmap.map((item, index) => (
                <div key={item.phase} className="rounded-[28px] border border-white/10 bg-white/[0.05] p-5">
                  <div className="flex items-start gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,rgba(255,214,243,0.95),rgba(255,94,201,0.95)_32%,rgba(110,130,255,0.95)_68%,rgba(122,247,255,0.95))] font-display text-[#170718]">
                      0{index + 1}
                    </div>
                    <div>
                      <p className="font-display text-xl uppercase tracking-[0.08em] text-white">{item.phase}</p>
                      <p className="mt-2 text-sm leading-7 text-ink/72">{item.detail}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}










