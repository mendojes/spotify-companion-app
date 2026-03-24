"use client";

import { Fragment, type ReactNode, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Clock3, Flame, Heart, ImageIcon, LibraryBig, PlaySquare, Search, SmilePlus, Sparkles, Star, Waves } from "lucide-react";
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
  quietSavedTracks,
  genrePulse,
  moodData,
  moodHeatmap,
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
  MoodHeatmapCell,
  MoodPoint,
  PlaylistInsight,
  TopListRange,
  StatCard,
  TopListsData,
  TrendPoint,
} from "@/lib/types";

const timeframeTabs: Array<{ key: DashboardRange; label: string }> = [
  { key: "week", label: "This Week" },
  { key: "month", label: "This Month" },
  { key: "all", label: "All Time" },
];

const topRangeTabs: Array<{ key: TopListRange; label: string }> = [
  { key: "week", label: "1 Week" },
  { key: "month", label: "1 Month" },
  { key: "year", label: "1 Year" },
  { key: "all", label: "All Time" },
  { key: "custom", label: "Custom" },
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
  selectedTopRange?: TopListRange;
  selectedTopFrom?: string;
  selectedTopTo?: string;
  sidebar?: ReactNode;
  dashboardBasePath?: string;
  analysisBasePath?: string | null;
  topListsPagePath?: string | null;
  playlistsPagePath?: string | null;
  rediscoveryPagePath?: string | null;
};

type DashboardData = {
  statCards: StatCard[];
  trendData: TrendPoint[];
  trendHeading: string;
  trendBadge: string;
  genrePulse: GenrePulse[];
  moodData: MoodPoint[];
  moodHeatmap: MoodHeatmapCell[];
  forgottenFavorites: FavoriteTrack[];
  quietSavedTracks: FavoriteTrack[];
  playlistInsights: PlaylistInsight[];
  sourceLabel: string;
  moodSource: string;
  cachedAt?: string;
  snapshotCount?: number;
  range: DashboardRange;
};

type DashboardHydrationPayload = {
  insights: DashboardInsights;
  topLists: TopListsData;
  heroTopLists: TopListsData;
};

const moodColors = ["#7AF7FF", "#6E82FF", "#FF5EC9", "#FFD37B", "#8EFFD1"];
const moodOrder = ["Energetic", "Chill", "Moody", "Joyful", "Focus"];

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
    moodHeatmap: moodHeatmap as MoodHeatmapCell[],
    forgottenFavorites: forgottenFavorites as FavoriteTrack[],
    quietSavedTracks: quietSavedTracks as FavoriteTrack[],
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

  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Los_Angeles",
    hour12: true,
  }).format(new Date(value)) + " PT";
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
        <Image src={imageUrl} alt={label} fill sizes="128px" className="rounded-[18px] object-contain bg-white/[0.2] p-1.5" />
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
      <h2 className="font-display text-4xl font-bold uppercase tracking-[0.08em] text-[var(--theme-title)] md:text-5xl xl:text-6xl">{title}</h2>
      <p className="max-w-3xl text-base leading-8 text-[var(--theme-body)] md:text-lg">{copy}</p>
      {meta ? <div className="space-y-1 text-sm text-[var(--theme-muted)]">{meta}</div> : null}
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
  const hasArtwork = Boolean(backgroundImage);

  return (
    <div className="window-panel relative flex h-full min-h-[18rem] flex-col overflow-hidden p-5 pt-14 text-[var(--theme-text)]">
      {backgroundImage ? (
        <div className="absolute inset-x-0 bottom-0 top-[44px] overflow-hidden">
          <Image src={backgroundImage} alt={label} fill sizes="(max-width: 1280px) 100vw, 420px" className="object-contain bg-white/[0.2] opacity-60" />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,245,255,0.18)_18%,rgba(70,24,108,0.74))]" />
        </div>
      ) : null}
      <div className="relative z-10 flex h-full flex-col">
        <div className="flex items-center justify-between gap-3">
          <p className="font-mono text-lg uppercase tracking-[0.16em] text-[var(--theme-muted)]">{label}</p>
          <div className="icon-bubble h-10 w-10 text-[var(--theme-accent)]">
            <Icon className="h-4 w-4" />
          </div>
        </div>
        <div className={hasArtwork ? "mt-5 flex flex-1 items-end" : "mt-5 flex flex-1 items-center justify-center text-center"}>
          <p className={`font-display uppercase tracking-[0.08em] text-white drop-shadow-[0_4px_18px_rgba(44,12,70,0.45)] ${getAdaptiveValueClass(value)}`}>{value}</p>
        </div>
        <p className={hasArtwork ? "mt-4 max-w-[18rem] text-sm uppercase tracking-[0.1em] text-[#ffeaff]" : "mt-4 text-center text-sm uppercase tracking-[0.1em] text-[var(--theme-muted)]"}>{detail}</p>
      </div>
    </div>
  );
}
function DesktopMiniWindow({
  title,
  subtitle,
  imageUrl,
  icon: Icon,
}: {
  title: string;
  subtitle: string;
  imageUrl?: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="desktop-card overflow-hidden p-3 text-[var(--theme-text)]">
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-sm uppercase tracking-[0.16em] text-[var(--theme-muted)]">{subtitle}</p>
        <div className="icon-bubble h-9 w-9 text-[var(--theme-accent)]">
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-[92px_1fr] sm:items-center">
        <div className="media-frame relative h-24 w-full p-1.5 sm:h-24 sm:w-24">
          {imageUrl ? <Image src={imageUrl} alt={title} fill sizes="96px" className="rounded-[14px] object-contain bg-white/[0.2] p-1" /> : null}
        </div>
        <div>
          <p className="font-display text-xl uppercase leading-tight tracking-[0.08em] text-[var(--theme-title)]">{title}</p>
          <p className="mt-2 text-xs uppercase tracking-[0.16em] text-[var(--theme-muted)]">saved to the visual shelf</p>
        </div>
      </div>
    </div>
  );
}

function TrackShelfCard({
  track,
  accent = "mint",
}: {
  track: FavoriteTrack;
  accent?: "mint" | "gold";
}) {
  const accentClass = accent === "gold"
    ? "border-gold/25 bg-gold/10 text-gold"
    : "border-mint/20 bg-mint/10 text-mint";

  return (
    <div className="desktop-card p-4">
      <div className="flex items-start gap-4">
        <Artwork imageUrl={track.imageUrl} label={track.title} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="font-display text-xl uppercase tracking-[0.08em] text-[var(--theme-title)]">{track.title}</p>
          <p className="mt-1 text-sm text-[var(--theme-muted)]">{track.artist} / {track.album}</p>
          {track.reason ? <p className="mt-2 text-sm leading-6 text-[var(--theme-body)]">{track.reason}</p> : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <span className={`rounded-full px-3 py-1 text-xs uppercase tracking-[0.18em] ${accentClass}`}>
              {track.affinity}% match
            </span>
            <span className="rounded-full border border-[rgba(57,18,98,0.16)] bg-white/[0.55] px-3 py-1 text-xs uppercase tracking-[0.18em] text-[var(--theme-faint)]">
              {track.lastPlayed}
            </span>
          </div>
        </div>
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
  selectedTopRange = "month",
  selectedTopFrom,
  selectedTopTo,
  sidebar,
  dashboardBasePath = "/dashboard",
  analysisBasePath = "/dashboard/analysis",
  topListsPagePath = "/dashboard/top-lists",
  playlistsPagePath = "/dashboard/playlists",
  rediscoveryPagePath = "/dashboard/rediscovery",
}: DashboardViewProps) {
  const isPreview = mode === "preview";
  const [hydratedInsights, setHydratedInsights] = useState<DashboardInsights | undefined>(insights);
  const [hydratedTopLists, setHydratedTopLists] = useState<TopListsData | undefined>(topLists);
  const [hydratedHeroTopLists, setHydratedHeroTopLists] = useState<TopListsData | undefined>(heroTopLists ?? topLists);
  const activeInsights = hydratedInsights ?? insights;
  const activeTopLists = hydratedTopLists ?? topLists;
  const activeHeroTopLists = hydratedHeroTopLists ?? heroTopLists ?? hydratedTopLists ?? topLists;
  const data = getData(mode, activeInsights);
  const topListData = getTopListData(mode, activeTopLists);
  const heroTopListData = getTopListData(mode, activeHeroTopLists);
  const [livePlaylistInsights, setLivePlaylistInsights] = useState<PlaylistInsight[] | null>(() => (
    mode === "authenticated" && data.playlistInsights.length > 0 ? data.playlistInsights : null
  ));
  const playlistCards = livePlaylistInsights ?? data.playlistInsights;

  useEffect(() => {
    setHydratedInsights(insights);
    setHydratedTopLists(topLists);
    setHydratedHeroTopLists(heroTopLists ?? topLists);
  }, [heroTopLists, insights, topLists]);

  useEffect(() => {
    if (mode !== "authenticated") {
      setLivePlaylistInsights(null);
      return;
    }

    setLivePlaylistInsights((current) => {
      if (current && current.length > 0) {
        return current;
      }

      return data.playlistInsights.length > 0 ? data.playlistInsights : null;
    });
  }, [data.playlistInsights, mode]);

  useEffect(() => {
    if (mode !== "authenticated") {
      return;
    }

    let cancelled = false;
    const params = new URLSearchParams({
      range: selectedRange,
      topRange: selectedTopRange,
    });

    if (selectedTopRange === "custom" && selectedTopFrom && selectedTopTo) {
      params.set("topFrom", selectedTopFrom);
      params.set("topTo", selectedTopTo);
    }

    async function hydrateDashboard() {
      try {
        const response = await fetch("/api/dashboard/data?" + params.toString(), { cache: "no-store" });
        if (!response.ok) {
          throw new Error("Could not hydrate dashboard data.");
        }

        const payload = (await response.json()) as DashboardHydrationPayload;
        if (!cancelled) {
          setHydratedInsights(payload.insights);
          setHydratedTopLists(payload.topLists);
          setHydratedHeroTopLists(payload.heroTopLists);
        }
      } catch {
        if (!cancelled) {
          // Keep the lightweight server-rendered data if live hydration fails.
        }
      }
    }

    void hydrateDashboard();

    return () => {
      cancelled = true;
    };
  }, [mode, selectedRange, selectedTopFrom, selectedTopRange, selectedTopTo]);

  useEffect(() => {
    if (mode !== "authenticated") {
      return;
    }

    let cancelled = false;
    let timer: number | undefined;
    const hasServerPlaylistInsights = data.playlistInsights.length > 0;
    const refreshDelayMs = hasServerPlaylistInsights ? 1000 * 60 * 3 : 1000 * 60;

    async function loadPlaylistInsights() {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        timer = window.setTimeout(loadPlaylistInsights, refreshDelayMs);
        return;
      }

      try {
        const response = await fetch("/api/dashboard/playlist-insights", { cache: "no-store" });
        if (!response.ok) {
          throw new Error("Could not refresh playlist insights.");
        }

        const payload = (await response.json()) as { playlistInsights?: PlaylistInsight[] };
        if (!cancelled) {
          const nextInsights = payload.playlistInsights ?? [];

          if (nextInsights.length > 0) {
            setLivePlaylistInsights(nextInsights);
          }
        }
      } catch {
        if (!cancelled) {
          // Keep the last successful live set instead of snapping back to stale server data.
        }
      } finally {
        if (!cancelled) {
          timer = window.setTimeout(loadPlaylistInsights, refreshDelayMs);
        }
      }
    }

    if (hasServerPlaylistInsights) {
      timer = window.setTimeout(loadPlaylistInsights, refreshDelayMs);
    } else {
      void loadPlaylistInsights();
    }

    return () => {
      cancelled = true;
      if (timer) {
        window.clearTimeout(timer);
      }
    };
  }, [data.playlistInsights, mode]);
  const playlist = buildRediscoveryPlaylist(data.forgottenFavorites);
  const cachedAtLabel = formatTimestamp(data.cachedAt);
  const generatedAtLabel = formatTimestamp(topListData.generatedAt);
  const topRangeQuery = selectedTopRange === "custom" && selectedTopFrom && selectedTopTo ? `&topFrom=${selectedTopFrom}&topTo=${selectedTopTo}` : "";
  const moodHeatmapPeriods = [...new Set(data.moodHeatmap.map((cell) => cell.period))];
  const heatmapCellByKey = new Map(data.moodHeatmap.map((cell) => [`${cell.mood}::${cell.period}`, cell]));
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
              <div className="glass-panel rounded-[42px] px-6 py-7 md:px-8 md:py-8 xl:px-10">
                <div className="relative z-10 space-y-8 text-[var(--theme-text)]">
                  <div className="flex flex-wrap gap-3">
                    <div className="sticker-badge inline-flex items-center gap-2 px-4 py-2 font-mono text-sm uppercase tracking-[0.16em] text-[var(--theme-badge)]">
                      <SmilePlus className="h-4 w-4 text-[var(--theme-accent)]" /> live interface
                    </div>
                    <div className="sticker-badge inline-flex items-center gap-2 px-4 py-2 font-mono text-sm uppercase tracking-[0.16em] text-[var(--theme-badge)]">
                      <ImageIcon className="h-4 w-4 text-[var(--theme-highlight)]" /> image-heavy mode
                    </div>
                    <div className="sticker-badge inline-flex items-center gap-2 px-4 py-2 font-mono text-sm uppercase tracking-[0.16em] text-[var(--theme-badge)]">
                      <Heart className="h-4 w-4 text-[var(--theme-accent)]" /> soft chrome
                    </div>
                  </div>

                  <div className="grid gap-6 xl:grid-cols-[1.08fr_0.92fr] xl:items-start">
                    <div className="space-y-6">
                      <SectionHeader
                        kicker={isPreview ? "Dashboard preview" : "Live interface"}
                        title="A scrapbook dashboard for your listening life"
                        copy={
                          isPreview
                            ? "The preview now behaves like a pastel browser desktop full of art, shortcut windows, and collectible listening widgets instead of a plain analytics canvas."
                            : "Your Spotify history now lives inside a pastel collage of browser windows, cover-art shelves, and playful controls that feel saved from a cute 2000s homepage."
                        }
                        meta={
                          <>
                            <p className="text-[var(--theme-badge)]">{data.sourceLabel}</p>
                            <p>Mood model: {data.moodSource}</p>
                            {cachedAtLabel ? <p>Last snapshot: {cachedAtLabel}</p> : null}
                          </>
                        }
                      />

                      <div className="flex flex-wrap gap-3">
                        {timeframeTabs.map((tab) => {
                          const active = (isPreview ? "week" : selectedRange) === tab.key;
                          const href = isPreview
                            ? undefined
                            : `${dashboardBasePath}?range=${tab.key}&topRange=${selectedTopRange}${selectedTopRange === "custom" && selectedTopFrom && selectedTopTo ? `&topFrom=${selectedTopFrom}&topTo=${selectedTopTo}` : ""}`;

                          if (!href) {
                            return (
                              <TabPill key={tab.key} active={active}>
                                {tab.label}
                              </TabPill>
                            );
                          }

                          return (
                            <a
                              key={tab.key}
                              href={href}
                              className={`rounded-full px-4 py-2 font-mono text-lg uppercase tracking-[0.16em] transition ${
                                active
                                  ? "neon-outline bg-[linear-gradient(135deg,rgba(255,214,243,0.95),rgba(255,94,201,0.95)_32%,rgba(110,130,255,0.95)_68%,rgba(122,247,255,0.95))] text-[#170718]"
                                  : "chrome-line bg-white/[0.05] text-ink/82 hover:border-cyan/40 hover:text-white"
                              }`}
                            >
                              {tab.label}
                            </a>
                          );
                        })}
                      </div>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
                      <DesktopMiniWindow
                        title={leadTrack?.title ?? "No top track yet"}
                        subtitle="track popup"
                        imageUrl={leadTrack?.imageUrl}
                        icon={PlaySquare}
                      />
                      <DesktopMiniWindow
                        title={leadAlbum?.name ?? "No top album yet"}
                        subtitle="cover shelf"
                        imageUrl={leadAlbum?.imageUrl}
                        icon={Star}
                      />
                    </div>
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
                <div className="window-panel p-6 pt-16 md:p-7 md:pt-16 text-[var(--theme-text)]">
                  <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="section-kicker">Listening trend</p>
                      <h3 className="mt-2 font-display text-3xl uppercase tracking-[0.08em] text-[var(--theme-title)]">{data.trendHeading}</h3>
                    </div>
                    <div className="sticker-badge px-3 py-1 font-mono text-sm uppercase tracking-[0.16em] text-[var(--theme-badge)]">{data.trendBadge}</div>
                  </div>
                  <div className="mb-4 grid gap-3 sm:grid-cols-2">
                    <div className="desktop-card p-4">
                      <div className="flex items-center gap-3">
                        <div className="icon-bubble h-10 w-10 text-[var(--theme-accent)]">
                          <Search className="h-4 w-4" />
                        </div>
                        <div>
                          <p className="font-mono text-sm uppercase tracking-[0.16em] text-[var(--theme-muted)]">trend lens</p>
                          <p className="text-sm text-[var(--theme-body)]">track how much time you actually spent listening across each bucket in the selected range.</p>
                        </div>
                      </div>
                    </div>
                    <div className="desktop-card p-4">
                      <div className="flex items-center gap-3">
                        <div className="icon-bubble h-10 w-10 text-[var(--theme-highlight)]">
                          <Sparkles className="h-4 w-4" />
                        </div>
                        <div>
                          <p className="font-mono text-sm uppercase tracking-[0.16em] text-[var(--theme-muted)]">artist spread</p>
                          <p className="text-sm text-[var(--theme-body)]">the magenta bars show how wide your artist rotation got during each listening window.</p>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="h-[330px] rounded-[24px] border-2 border-[rgba(57,18,98,0.18)] bg-white/[0.45] p-3">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={data.trendData}>
                        <defs>
                          <linearGradient id="minutesFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#7AF7FF" stopOpacity={0.52} />
                            <stop offset="100%" stopColor="#7AF7FF" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.08)" />
                        <XAxis dataKey="label" stroke="var(--theme-text)" tickLine={false} axisLine={false} />
                        <YAxis stroke="var(--theme-text)" tickLine={false} axisLine={false} />
                        <Tooltip contentStyle={{ background: "rgba(17,8,31,0.95)", borderRadius: 18, border: "1px solid rgba(255,255,255,0.14)" }} />
                        <Area type="monotone" dataKey="minutes" stroke="#7AF7FF" strokeWidth={3} fill="url(#minutesFill)" />
                        <Bar dataKey="rediscovered" fill="#FF5EC9" radius={[10, 10, 0, 0]} barSize={20} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                  {!isPreview && analysisBasePath ? (
                    <div className="mt-4 flex flex-wrap gap-3">
                      {data.trendData.map((point) => (
                        <Link
                          key={point.label}
                          href={`${analysisBasePath}?section=trend&range=${selectedRange}&label=${encodeURIComponent(point.label)}`}
                          className="pixel-chip text-[var(--theme-text)] transition hover:text-[#2d0d46]"
                        >
                          Open {point.label} sessions
                        </Link>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="glass-panel rounded-[34px] p-6 md:p-7 text-[var(--theme-text)]">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="section-kicker">Genre pulse</p>
                      <h3 className="mt-2 font-display text-3xl uppercase tracking-[0.08em] text-[var(--theme-title)]">Genres driving the mix</h3>
                    </div>
                    <div className="icon-bubble h-11 w-11 text-[var(--theme-accent)]">
                      <ImageIcon className="h-5 w-5" />
                    </div>
                  </div>
                  <div className="mt-4 desktop-card p-4">
                    <p className="font-mono text-sm uppercase tracking-[0.16em] text-[var(--theme-muted)]">genre shelf</p>
                    <p className="mt-1 text-sm text-[var(--theme-body)]">your biggest styles get stacked like icons pinned to a pastel corkboard.</p>
                  </div>
                  <div className="mt-6 h-[300px] rounded-[24px] border-2 border-[rgba(57,18,98,0.18)] bg-white/[0.45] p-3">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data.genrePulse} layout="vertical" margin={{ left: 8 }}>
                        <CartesianGrid horizontal={false} stroke="rgba(255,255,255,0.06)" />
                        <XAxis type="number" hide />
                        <YAxis type="category" dataKey="genre" stroke="var(--theme-text)" tickLine={false} axisLine={false} width={96} />
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
                      <div key={genre.genre} className="desktop-card px-4 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-display text-lg uppercase tracking-[0.08em] text-[var(--theme-title)]">{genre.genre}</span>
                          <span className="font-mono text-xl uppercase text-[var(--theme-highlight)]">{genre.hours}h</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="grid gap-6 2xl:grid-cols-[0.88fr_1.12fr]">
                <div className="glass-panel rounded-[34px] p-6 md:p-7 text-[var(--theme-text)]">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="section-kicker">Mood analysis</p>
                      <h3 className="mt-2 font-display text-3xl uppercase tracking-[0.08em] text-[var(--theme-title)]">Vibe radar</h3>
                    </div>
                    <div className="icon-bubble h-11 w-11 text-[var(--theme-highlight)]">
                      <Heart className="h-5 w-5" />
                    </div>
                  </div>
                  <p className="mt-3 max-w-md text-sm leading-7 text-[var(--theme-body)]">{getVibeSummary(data.moodData)}</p>
                  <div className="mt-6 h-[270px] rounded-[24px] border-2 border-[rgba(57,18,98,0.18)] bg-white/[0.45] p-3">
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

                <div className="window-panel p-6 pt-16 md:p-7 md:pt-16 text-[var(--theme-text)]">
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
                    <p className="font-mono text-sm uppercase tracking-[0.16em] text-[var(--theme-muted)]">session mood map</p>
                    <p className="mt-1 text-sm text-[var(--theme-body)]">brighter cells mark the times of day where each listening mood shows up the most in your recent sessions.</p>
                  </div>
                  <div className="mt-5 overflow-hidden rounded-[24px] border-2 border-[rgba(57,18,98,0.18)] bg-white/[0.45]">
                    <div className="grid" style={{ gridTemplateColumns: `minmax(140px, 1.2fr) repeat(${moodHeatmapPeriods.length}, minmax(0, 1fr))` }}>
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
                            if (!analysisBasePath) {
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
                            }

                            return (
                              <Link
                                key={`${mood}-${period}`}
                                href={`${analysisBasePath}?section=heatmap&range=${selectedRange}&mood=${encodeURIComponent(mood)}&period=${encodeURIComponent(period)}`}
                                className="border-b border-l border-[rgba(57,18,98,0.12)] p-4 text-center transition hover:brightness-110"
                                style={{
                                  background: `linear-gradient(135deg, rgba(255,255,255,0.16), ${moodColors[rowIndex % moodColors.length]}${alpha})`,
                                }}
                              >
                                <p className="font-mono text-lg uppercase text-[var(--theme-title)]">{intensity}%</p>
                                <p className="mt-1 text-xs uppercase tracking-[0.14em] text-[var(--theme-muted)]">{Math.round(cell?.minutes ?? 0)} min</p>
                              </Link>
                            );
                          })}
                        </Fragment>
                      ))}
                    </div>
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
                <p className="text-[var(--theme-badge)]">{topListData.sourceLabel}</p>
                {generatedAtLabel ? <p>Generated: {generatedAtLabel}</p> : null}
              </>
            }
          />

          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-3">
                {topRangeTabs.map((tab) => {
                  const active = (isPreview ? "month" : selectedTopRange) === tab.key;
                  const href = isPreview ? undefined : `${dashboardBasePath}?range=${selectedRange}&topRange=${tab.key}${tab.key === "custom" ? topRangeQuery : ""}`;

                  return (
                    <TabPill key={tab.key} active={active} href={href}>
                      {tab.label}
                    </TabPill>
                  );
                })}
              </div>
              {!isPreview && playlistsPagePath ? (
                <Link
                  href={`${topListsPagePath}?range=${selectedTopRange}&tab=artists&page=1${selectedTopRange === "custom" && selectedTopFrom && selectedTopTo ? `&from=${selectedTopFrom}&to=${selectedTopTo}` : ""}`}
                  className="pixel-chip text-[var(--theme-text)] transition hover:text-[#2d0d46]"
                >
                  View all rankings
                </Link>
              ) : null}
            </div>
            {!isPreview && playlistsPagePath ? (
              <form action={dashboardBasePath} method="get" className="desktop-card flex flex-wrap items-end gap-3 p-4">
                <input type="hidden" name="range" value={selectedRange} />
                <input type="hidden" name="topRange" value="custom" />
                <label className="space-y-2 text-sm text-[var(--theme-muted)]">
                  <span className="block font-mono uppercase tracking-[0.14em]">From</span>
                  <input name="topFrom" type="date" defaultValue={selectedTopRange === "custom" ? selectedTopFrom : undefined} className="rounded-2xl border border-white/15 bg-white/60 px-3 py-2 text-[var(--theme-text)]" />
                </label>
                <label className="space-y-2 text-sm text-[var(--theme-muted)]">
                  <span className="block font-mono uppercase tracking-[0.14em]">To</span>
                  <input name="topTo" type="date" defaultValue={selectedTopRange === "custom" ? selectedTopTo : undefined} className="rounded-2xl border border-white/15 bg-white/60 px-3 py-2 text-[var(--theme-text)]" />
                </label>
                <button type="submit" className="pixel-chip text-[var(--theme-text)] transition hover:text-[#2d0d46]">Apply custom window</button>
              </form>
            ) : null}
          </div>

          <div className="grid gap-6 xl:grid-cols-3">
            <div className="glass-panel rounded-[34px] p-6 text-[var(--theme-text)]">
              <div className="mb-6 flex items-center gap-3">
                <LibraryBig className="h-5 w-5 text-cyan" />
                <div>
                  <p className="section-kicker">Top artists</p>
                  <h3 className="mt-2 font-display text-3xl uppercase tracking-[0.08em] text-[var(--theme-title)]">Faces of the era</h3>
                </div>
              </div>
              <div className="space-y-4">
                {topListData.artists.map((artist) => (
                  <div key={artist.id} className="desktop-card p-4">
                    <div className="flex items-start gap-4">
                      <Artwork imageUrl={artist.imageUrl} label={artist.name} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <p className="pr-3 font-display text-xl uppercase leading-tight tracking-[0.08em] text-[var(--theme-title)] md:text-2xl">{artist.name}</p>
                          <p className="font-mono text-xl uppercase text-[var(--theme-highlight)]">#{artist.rank}</p>
                        </div>
                        <p className="mt-2 text-sm text-[var(--theme-muted)]">
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
                  <h3 className="mt-2 font-display text-3xl uppercase tracking-[0.08em] text-[var(--theme-title)]">Tracks on repeat</h3>
                </div>
              </div>
              <div className="space-y-4">
                {topListData.tracks.map((track) => (
                  <div key={track.id} className="desktop-card p-4">
                    <div className="flex items-start gap-4">
                      <Artwork imageUrl={track.imageUrl} label={track.title} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <p className="pr-3 font-display text-xl uppercase leading-tight tracking-[0.08em] text-[var(--theme-title)] md:text-2xl">{track.title}</p>
                          <p className="font-mono text-xl uppercase text-[var(--theme-accent)]">#{track.rank}</p>
                        </div>
                        <p className="mt-2 text-sm text-[var(--theme-muted)]">{track.artist}</p>
                        <p className="mt-1 font-mono text-lg uppercase tracking-[0.12em] text-[var(--theme-faint)]">{track.album}</p>
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
                  <h3 className="mt-2 font-display text-3xl uppercase tracking-[0.08em] text-[var(--theme-title)]">Projects that stick</h3>
                </div>
              </div>
              <div className="space-y-4">
                {topListData.albums.map((album) => (
                  <div key={album.id} className="desktop-card p-4">
                    <div className="flex items-start gap-4">
                      <Artwork imageUrl={album.imageUrl} label={album.name} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <p className="pr-3 font-display text-xl uppercase leading-tight tracking-[0.08em] text-[var(--theme-title)] md:text-2xl">{album.name}</p>
                          <p className="font-mono text-xl uppercase text-[var(--theme-highlight)]">#{album.rank}</p>
                        </div>
                        <p className="mt-2 text-sm text-[var(--theme-muted)]">{album.artist}</p>
                        <p className="mt-1 font-mono text-lg uppercase tracking-[0.12em] text-[var(--theme-faint)]">
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
            <div className="glass-panel rounded-[36px] p-6 md:p-7 text-[var(--theme-text)]">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="section-kicker">Forgotten favorites</p>
                  <h3 className="mt-2 font-display text-3xl uppercase tracking-[0.08em] text-[var(--theme-title)]">Big songs that fell out of orbit</h3>
                </div>
                {!isPreview && rediscoveryPagePath ? (
                  <Link href={`${rediscoveryPagePath}?range=${selectedRange}`} className="pixel-chip text-[var(--theme-text)] transition hover:text-[#2d0d46]">
                    View more
                  </Link>
                ) : null}
              </div>
              <div className="grid gap-5 md:grid-cols-[1.05fr_0.95fr]">
                <div className="media-frame relative min-h-[420px] p-2">
                  {data.forgottenFavorites[0]?.imageUrl ? (
                    <Image
                      src={data.forgottenFavorites[0].imageUrl}
                      alt={data.forgottenFavorites[0].title}
                      fill
                      sizes="(max-width: 1280px) 100vw, 500px"
                      className="rounded-[22px] object-contain bg-white/[0.2] p-1.5"
                    />
                  ) : null}
                  <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(72,24,110,0.14)_36%,rgba(72,24,110,0.72))]" />
                  <div className="absolute bottom-6 left-6 right-6 rounded-[24px] border-2 border-white/35 bg-[rgba(255,245,255,0.72)] p-5 text-[var(--theme-text)] backdrop-blur-md">
                    <p className="section-kicker">Spotlight replay</p>
                    <h3 className="mt-2 font-display text-4xl uppercase tracking-[0.08em] text-[var(--theme-title)]">{data.forgottenFavorites[0]?.title}</h3>
                    <p className="mt-2 text-sm uppercase tracking-[0.2em] text-[var(--theme-muted)]">{data.forgottenFavorites[0]?.artist} / {data.forgottenFavorites[0]?.album}</p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <span className="pixel-chip text-mint">{data.forgottenFavorites[0]?.affinity}% affinity</span>
                      <span className="pixel-chip text-gold">{data.forgottenFavorites[0]?.lastPlayed}</span>
                    </div>
                  </div>
                </div>
                <div className="space-y-4">
                  {data.forgottenFavorites.slice(1, 4).map((track) => (
                    <TrackShelfCard key={`${track.title}-${track.artist}`} track={track} accent="mint" />
                  ))}
                </div>
              </div>
            </div>

            <div className="window-panel p-6 pt-16 md:p-7 md:pt-16 text-[var(--theme-text)]">
              <div className="mb-6 flex items-center gap-3">
                <div className="icon-bubble h-11 w-11 text-[var(--theme-accent)]">
                  <Sparkles className="h-5 w-5" />
                </div>
                <div>
                  <p className="section-kicker">Saved deep cuts</p>
                  <h3 className="mt-2 font-display text-3xl uppercase tracking-[0.08em] text-[var(--theme-title)]">Older saves worth revisiting</h3>
                </div>
              </div>
              <div className="space-y-4">
                {data.quietSavedTracks.slice(0, 3).map((track) => (
                  <TrackShelfCard key={`${track.title}-${track.artist}`} track={track} accent="gold" />
                ))}
              </div>
              <div className="mt-6 desktop-card p-5">
                <p className="font-mono text-lg uppercase tracking-[0.18em] text-[var(--theme-highlight)]">Current logic</p>
                <p className="mt-3 text-sm leading-7 text-[var(--theme-body)]">
                  Favorites still use affinity and historical importance, while saved deep cuts widen the net to older library songs that have gone quiet even without favorite-level history.
                </p>
              </div>
              {playlist.length > 0 ? (
                <div className="mt-4 space-y-3">
                  {playlist.slice(0, 3).map((item, index) => (
                    <div key={item.slot} className={`desktop-card flex items-center justify-between px-4 py-4 ${index === 0 ? "bg-[rgba(106,244,255,0.14)]" : "bg-[rgba(255,250,255,0.62)]"}`}>
                      <div className="flex items-center gap-4">
                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,rgba(255,214,243,0.95),rgba(255,94,201,0.95)_32%,rgba(110,130,255,0.95)_68%,rgba(122,247,255,0.95))] font-display text-[#170718]">
                          {item.slot}
                        </div>
                        <div>
                          <p className="font-display text-lg uppercase tracking-[0.08em] text-[var(--theme-title)]">{item.label}</p>
                          <p className="mt-1 text-sm text-[var(--theme-muted)]">{item.reason}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          {!isPreview && rediscoveryPagePath ? (
            <div className="flex justify-end">
              <Link href={`${rediscoveryPagePath}?range=${selectedRange}`} className="pixel-chip text-[var(--theme-text)] transition hover:text-[#2d0d46]">
                View more rediscovery
              </Link>
            </div>
          ) : null}
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
            <p className="font-mono text-lg uppercase tracking-[0.12em] text-[var(--theme-muted)]">Open any playlist to inspect its structure in more detail.</p>
            {!isPreview && playlistsPagePath ? (
              <Link href={playlistsPagePath} className="pixel-chip text-[var(--theme-text)] transition hover:text-[#2d0d46]">
                View all playlists
              </Link>
            ) : null}
          </div>

          <div className="grid gap-5 lg:grid-cols-3">
            {playlistCards.map((playlistCard, index) => {
              const content = (
                <>
                  {playlistCard.imageUrl ? (
                    <div className="media-frame relative mb-5 h-60 p-2">
                      <Image src={playlistCard.imageUrl} alt={playlistCard.name} fill sizes="(max-width: 1024px) 100vw, 420px" className="rounded-[22px] object-contain bg-white/[0.2] p-1.5" />
                      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(72,24,110,0.14)_36%,rgba(72,24,110,0.72))]" />
                      <div className="absolute bottom-5 left-5 right-5 flex items-end justify-between gap-3">
                        <div>
                          <p className="section-kicker">Playlist insight</p>
                          <h3 className="mt-2 font-display text-3xl uppercase tracking-[0.08em] text-[var(--theme-title)]">{playlistCard.name}</h3>
                        </div>
                        <div className="sticker-badge px-3 py-1 font-mono text-lg text-[var(--theme-badge)]">0{index + 1}</div>
                      </div>
                    </div>
                  ) : null}
                  <div className="grid gap-4">
                    <div className="desktop-card p-4">
                      <p className="font-mono text-lg uppercase tracking-[0.16em] text-[var(--theme-muted)]">Mood consistency</p>
                      <p className="mt-2 text-[var(--theme-title)]">{playlistCard.mood}</p>
                    </div>
                    <div className="desktop-card p-4">
                      <p className="font-mono text-lg uppercase tracking-[0.16em] text-[var(--theme-muted)]">Genre diversity</p>
                      <p className="mt-2 text-[var(--theme-title)]">{playlistCard.diversity}</p>
                    </div>
                    <div className="desktop-card p-4">
                      <p className="font-mono text-lg uppercase tracking-[0.16em] text-[var(--theme-muted)]">Redundancy</p>
                      <p className="mt-2 text-[var(--theme-title)]">{playlistCard.overlap}</p>
                    </div>
                  </div>
                </>
              );

              const className = `glass-panel rounded-[32px] p-6 text-[var(--theme-text)] transition ${index === 0 ? "shadow-glow" : ""}`;

              if (!isPreview && playlistCard.id && playlistsPagePath) {
                return (
                  <Link key={playlistCard.id} href={`${playlistsPagePath ?? "/dashboard/playlists"}/${playlistCard.id}`} className={`${className} hover:border-cyan/40 hover:bg-white/[0.05]`}>
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
        <div className="mx-auto max-w-7xl window-panel p-8 pt-16 md:p-10 md:pt-16 text-[var(--theme-text)]">
          <div className="grid gap-8 lg:grid-cols-[0.92fr_1.08fr] lg:items-start">
            <div>
              <p className="section-kicker">Build path</p>
              <h2 className="mt-4 max-w-md font-display text-5xl font-bold uppercase tracking-[0.08em] text-[var(--theme-title)] md:text-6xl">
                Stronger MVP now, louder music intelligence next.
              </h2>
              <p className="mt-5 max-w-lg text-base leading-8 text-[var(--theme-body)]">
                The new shell is designed so richer live data can keep slotting into a distinct visual identity without drifting back into generic analytics tiles.
              </p>
            </div>
            <div className="space-y-5">
              {roadmap.map((item, index) => (
                <div key={item.phase} className="desktop-card p-5">
                  <div className="flex items-start gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,rgba(255,214,243,0.95),rgba(255,94,201,0.95)_32%,rgba(110,130,255,0.95)_68%,rgba(122,247,255,0.95))] font-display text-[#170718]">
                      0{index + 1}
                    </div>
                    <div>
                      <p className="font-display text-xl uppercase tracking-[0.08em] text-[var(--theme-title)]">{item.phase}</p>
                      <p className="mt-2 text-sm leading-7 text-[var(--theme-body)]">{item.detail}</p>
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







































