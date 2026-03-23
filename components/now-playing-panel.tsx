"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Disc3, Heart, Play, Pause, Radio, Sparkles, Waves } from "lucide-react";
import { NowPlayingState } from "@/lib/types";

function formatPlayedAt(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

const COLLAPSED_RECENT_COUNT = 3;

function getAdaptiveHeadingClass(value: string) {
  if (value.length > 28) {
    return "text-xl md:text-2xl leading-[1.05] break-words";
  }

  if (value.length > 16) {
    return "text-2xl md:text-3xl leading-[1] break-words";
  }

  return "text-3xl md:text-[2.2rem] leading-[0.98]";
}

function getAdaptiveSubheadingClass(value: string) {
  if (value.length > 30) {
    return "text-xs tracking-[0.14em] break-words";
  }

  return "text-sm tracking-[0.18em]";
}

function getRecentTitleClass(value: string) {
  if (value.length > 26) {
    return "text-sm md:text-base leading-tight break-words";
  }

  return "text-base leading-tight";
}

function useNowPlayingState() {
  const [state, setState] = useState<NowPlayingState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch("/api/player/now-playing?limit=12", { cache: "no-store" });
        if (!response.ok) {
          throw new Error("Could not load current playback.");
        }

        const nextState = (await response.json()) as NowPlayingState;
        if (!cancelled) {
          setState((previous) => {
            if (nextState.track) {
              return nextState;
            }

            if (previous?.track) {
              return {
                ...previous,
                isPlaying: false,
                progressMs: previous.progressMs,
                recentTracks: nextState.recentTracks ?? previous.recentTracks,
                syncedRecentCount: nextState.syncedRecentCount ?? previous.syncedRecentCount,
                syncedAt: nextState.syncedAt ?? previous.syncedAt,
              };
            }

            return nextState;
          });
          setError(null);
        }
      } catch {
        if (!cancelled) {
          setError("Live playback could not be loaded right now.");
        }
      }
    }

    load();
    const timer = window.setInterval(load, 15000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return { state, error };
}

export function NowPlayingPanel() {
  const { state, error } = useNowPlayingState();
  const recentTracks = state?.recentTracks ?? [];
  const visibleRecentTracks = recentTracks.slice(0, COLLAPSED_RECENT_COUNT);
  const progress = useMemo(() => {
    if (!state?.track?.durationMs || !state.progressMs) {
      return 0;
    }

    return Math.max(0, Math.min(100, (state.progressMs / state.track.durationMs) * 100));
  }, [state?.progressMs, state?.track?.durationMs]);

  return (
    <div className="w-full 2xl:sticky 2xl:top-24">
      <div className="window-panel p-6 pt-16 text-[var(--theme-text)] md:p-7 md:pt-16">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="icon-bubble h-11 w-11 text-[var(--theme-accent)]">
              <Radio className="h-5 w-5" />
            </div>
            <div>
              <p className="section-kicker">Now playing</p>
              <h2 className="mt-1 font-display text-2xl uppercase tracking-[0.08em] text-[var(--theme-title)]">Current playback</h2>
            </div>
          </div>
          <div className="sticker-badge px-3 py-1 font-mono text-sm uppercase tracking-[0.18em] text-[var(--theme-badge)]">live</div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 text-[var(--theme-text)]">
          {state?.syncedAt ? (
            <div className="sticker-badge px-3 py-1 font-mono text-xs uppercase tracking-[0.18em] text-[var(--theme-badge)]">
              synced {formatPlayedAt(state.syncedAt)}
            </div>
          ) : null}
          {state?.syncedRecentCount ? (
            <div className="sticker-badge px-3 py-1 font-mono text-xs uppercase tracking-[0.18em] text-[var(--theme-badge)]">
              {state.syncedRecentCount} recent plays
            </div>
          ) : null}
        </div>

        {error ? <p className="mt-6 rounded-[20px] border-2 border-[rgba(57,18,98,0.22)] bg-white/55 px-4 py-3 text-sm text-[var(--theme-text)]">{error}</p> : null}

        {state?.track ? (
          <div className="mt-6 space-y-4">
            <div className="space-y-4">
              <div className="desktop-card overflow-hidden p-3">
                <div className="media-frame relative h-64 w-full p-2">
                  {state.track.imageUrl ? (
                    <Image src={state.track.imageUrl} alt={state.track.title} fill sizes="(max-width: 1280px) 320px, 380px" className="rounded-[18px] object-cover p-1.5" />
                  ) : null}
                  <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(72,24,110,0.08)_36%,rgba(72,24,110,0.22))]" />
                </div>
              </div>

              <div className="desktop-card p-4">
                <p className="section-kicker">Playing now</p>
                <p className={`mt-2 font-display uppercase tracking-[0.08em] text-[var(--theme-title)] ${getAdaptiveHeadingClass(state.track.title)}`}>{state.track.title}</p>
                <p className={`mt-2 uppercase text-[var(--theme-muted)] ${getAdaptiveSubheadingClass(state.track.artist)}`}>{state.track.artist}</p>
                <p className="mt-1 break-words font-mono text-sm uppercase tracking-[0.14em] text-[var(--theme-body)]">{state.track.album}</p>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
              <div className="desktop-card p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-mono text-sm uppercase tracking-[0.16em] text-[var(--theme-muted)]">session progress</p>
                  {state.isPlaying ? <Play className="h-4 w-4 text-[var(--theme-highlight)]" /> : <Pause className="h-4 w-4 text-[var(--theme-accent)]" />}
                </div>
                <div className="mt-4 h-4 rounded-full border-2 border-[rgba(57,18,98,0.18)] bg-white/45 p-1">
                  <div className="h-full rounded-full bg-[linear-gradient(90deg,#ff91e7,var(--theme-accent)_45%,var(--theme-highlight))]" style={{ width: `${progress}%` }} />
                </div>
              </div>

              <div className="desktop-card overflow-hidden p-4">
                <p className="font-mono text-sm uppercase tracking-[0.16em] text-[var(--theme-muted)]">Playing from</p>
                <div className="mt-4 rounded-[20px] border-2 border-[rgba(57,18,98,0.16)] bg-white/[0.45] p-4">
                  <p className="break-words font-display text-2xl uppercase tracking-[0.08em] text-[var(--theme-title)]">
                    {state.playingFrom?.label ?? state.track.album}
                  </p>
                  <p className="mt-2 text-xs uppercase tracking-[0.16em] text-[var(--theme-muted)]">
                    {state.playingFrom?.type === "playlist"
                      ? "playlist source"
                      : state.playingFrom?.type === "collection"
                        ? "library source"
                        : "album source"}
                  </p>
                </div>
              </div>
            </div>

            <div className="glass-panel rounded-[26px] p-4">
              <div className="mb-3 flex items-center justify-between gap-3 text-[var(--theme-text)]">
                <div className="flex items-center gap-3">
                  <div className="icon-bubble h-10 w-10 text-[var(--theme-highlight)]">
                    <Waves className="h-4 w-4" />
                  </div>
                  <p className="font-mono text-base uppercase tracking-[0.16em]">Recent tracks</p>
                </div>
                {recentTracks.length > COLLAPSED_RECENT_COUNT ? (
                  <Link href="/dashboard/recent" className="pixel-chip text-[var(--theme-text)] transition hover:text-[#2d0d46]">
                    View all
                  </Link>
                ) : null}
              </div>

              <div className="space-y-3">
                {visibleRecentTracks.length > 0 ? (
                  visibleRecentTracks.map((track, index) => (
                    <div key={`${track.trackId}:${track.playedAt}`} className="desktop-card p-3 text-[var(--theme-text)]">
                      <div className="flex items-start gap-3">
                        {track.imageUrl ? (
                          <div className="media-frame relative h-16 w-16 shrink-0 p-1">
                            <Image src={track.imageUrl} alt={track.title} fill sizes="64px" className="rounded-[12px] object-cover p-1" />
                          </div>
                        ) : null}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <p className={`font-display uppercase tracking-[0.06em] text-[var(--theme-title)] ${getRecentTitleClass(track.title)}`}>{track.title}</p>
                              <p className="mt-1 break-words text-xs uppercase tracking-[0.12em] text-[var(--theme-muted)]">{track.artist}</p>
                              <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--theme-faint)]">{formatPlayedAt(track.playedAt)}</p>
                            </div>
                            <div className="icon-bubble h-8 w-8 shrink-0 text-[var(--theme-accent)]">
                              {index === 0 ? <Heart className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-[18px] border-2 border-[rgba(57,18,98,0.16)] bg-white/[0.5] p-4 text-sm text-[var(--theme-body)]">
                    Recent listening history will start showing here as Spotify syncs into SoundScope.
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-6 rounded-[24px] border-2 border-[rgba(57,18,98,0.16)] bg-white/[0.52] p-6 text-sm text-[var(--theme-body)]">
            No active playback detected right now.
          </div>
        )}
      </div>
    </div>
  );
}
