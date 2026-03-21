"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Disc3, Radio, Waves, Play, Pause, History } from "lucide-react";
import { NowPlayingState } from "@/lib/types";

function formatPlayedAt(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

const COLLAPSED_RECENT_COUNT = 2;

function getAdaptiveHeadingClass(value: string) {
  if (value.length > 28) {
    return "text-xl md:text-2xl leading-[1.04] break-words";
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
          setState(nextState);
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
      <div className="window-panel p-6 pt-16 md:p-7 md:pt-16">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Radio className="h-5 w-5 text-gold" />
            <div>
              <p className="section-kicker">Now playing</p>
              <h2 className="mt-1 font-display text-3xl uppercase tracking-[0.08em] text-white">Media deck</h2>
            </div>
          </div>
          <div className="rounded-full border border-cyan/20 bg-cyan/10 px-3 py-1 font-mono text-lg uppercase tracking-[0.18em] text-cyan">
            live
          </div>
        </div>

        {error ? <p className="mt-6 text-sm text-gold">{error}</p> : null}

        {state?.track ? (
          <div className="mt-6 space-y-4">
            <div className="media-frame relative mx-auto h-56 w-full max-w-[320px] p-2">
              {state.track.imageUrl ? (
                <Image
                  src={state.track.imageUrl}
                  alt={state.track.title}
                  fill
                  sizes="(max-width: 1280px) 300px, 320px"
                  className="rounded-[24px] object-cover p-1.5"
                />
              ) : null}
              <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent,rgba(11,4,18,0.2)_82%,rgba(11,4,18,0.4))]" />
            </div>

            <div className="rounded-[24px] border border-white/10 bg-white/[0.05] p-4">
              <p className="section-kicker">{state.isPlaying ? "Playing now" : "Paused"}</p>
              <p className={`mt-2 font-display uppercase tracking-[0.08em] text-white ${getAdaptiveHeadingClass(state.track.title)}`}>
                {state.track.title}
              </p>
              <p className={`mt-2 uppercase text-ink/78 ${getAdaptiveSubheadingClass(state.track.artist)}`}>{state.track.artist}</p>
              <p className="mt-1 font-mono text-base uppercase tracking-[0.14em] break-words text-cyan/90">{state.track.album}</p>
              {state.syncedAt ? <p className="mt-3 text-xs uppercase tracking-[0.18em] text-ink/55">Synced {formatPlayedAt(state.syncedAt)}</p> : null}
            </div>

            <div className="rounded-[24px] border border-white/10 bg-white/[0.05] p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 text-white">
                  {state.isPlaying ? <Play className="h-4 w-4 text-cyan" /> : <Pause className="h-4 w-4 text-coral" />}
                  <span className="font-mono text-base uppercase tracking-[0.16em]">Session progress</span>
                </div>
              </div>
              <div className="mt-4 h-3 rounded-full bg-white/10">
                <div
                  className="h-3 rounded-full bg-[linear-gradient(90deg,rgba(255,214,243,0.95),rgba(255,94,201,0.95)_32%,rgba(110,130,255,0.95)_68%,rgba(122,247,255,0.95))]"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>

            <div className="glass-panel rounded-[24px] p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Disc3 className="h-5 w-5 text-coral" />
                  <p className="font-mono text-base uppercase tracking-[0.16em] text-ink/78">Recent tracks</p>
                </div>
                {recentTracks.length > COLLAPSED_RECENT_COUNT ? (
                  <Link
                    href="/dashboard/recent"
                    className="rounded-full border border-ink/15 bg-white/5 px-3 py-1 font-mono text-xs uppercase tracking-[0.14em] text-ink/75 transition hover:border-gold/25 hover:text-gold"
                  >
                    View all
                  </Link>
                ) : null}
              </div>

              <div className="space-y-3">
                {visibleRecentTracks.length > 0 ? (
                  visibleRecentTracks.map((track, index) => (
                    <div
                      key={`${track.trackId}:${track.playedAt}`}
                      className={`rounded-[18px] border p-3 ${index === 0 ? "border-coral/20 bg-[linear-gradient(135deg,rgba(255,94,201,0.18),rgba(255,211,123,0.08))]" : "border-ink/10 bg-white/[0.04]"}`}
                    >
                      <div className="flex items-start gap-3">
                        {track.imageUrl ? (
                          <div className="media-frame relative h-14 w-14 shrink-0 p-1">
                            <Image src={track.imageUrl} alt={track.title} fill sizes="56px" className="rounded-[12px] object-cover p-1" />
                          </div>
                        ) : null}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <p className={`font-display uppercase tracking-[0.06em] text-white ${getRecentTitleClass(track.title)}`}>{track.title}</p>
                              <p className="mt-1 text-xs uppercase tracking-[0.12em] text-ink/70 break-words">{track.artist}</p>
                              <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.12em] text-ink/55">{formatPlayedAt(track.playedAt)}</p>
                            </div>
                            {index === 0 ? <History className="mt-1 h-4 w-4 shrink-0 text-coral" /> : <Waves className="mt-1 h-4 w-4 shrink-0 text-cyan" />}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-[18px] border border-ink/10 bg-white/[0.03] p-4 text-sm text-ink/75">
                    Recent listening history will start showing here as Spotify syncs into SoundScope.
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-6 rounded-[28px] border border-ink/10 bg-white/[0.03] p-6 text-sm text-ink/75">
            No active playback detected right now.
          </div>
        )}
      </div>
    </div>
  );
}
