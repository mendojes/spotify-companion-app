"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Heart, Pause, Play, Radio, Sparkles, Waves } from "lucide-react";
import { NowPlayingState, RecentTrackSummary } from "@/lib/types";

function formatPlayedAt(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatClock(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

const COLLAPSED_RECENT_COUNT = 3;
const NOW_PLAYING_POLL_MS = 1000 * 30;
const TRACK_END_DELAY_MS = 750;
const PROGRESS_TICK_MS = 1000;
const HANDOFF_GRACE_MS = PROGRESS_TICK_MS + TRACK_END_DELAY_MS;

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

function prependRecentTrack(recentTracks: RecentTrackSummary[], track: NonNullable<NowPlayingState["track"]>) {
  const playedAt = new Date().toISOString();
  const handedOffTrack: RecentTrackSummary = {
    trackId: track.id,
    title: track.title,
    artist: track.artist,
    album: track.album,
    imageUrl: track.imageUrl,
    playedAt,
  };

  return [handedOffTrack, ...recentTracks.filter((item) => item.trackId !== track.id)].slice(0, 12);
}

function mergeRecentTracks(primary: RecentTrackSummary[] = [], fallback: RecentTrackSummary[] = []) {
  const merged: RecentTrackSummary[] = [];
  const seen = new Set<string>();

  for (const track of [...primary, ...fallback]) {
    const key = `${track.trackId}:${track.playedAt}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    merged.push(track);
  }

  return merged.slice(0, 12);
}

function serverHasMatchingRecentTrack(recentTracks: RecentTrackSummary[], pendingTrack: RecentTrackSummary | null) {
  if (!pendingTrack) {
    return false;
  }

  const pendingPlayedAt = new Date(pendingTrack.playedAt).getTime();
  return recentTracks.some((track) => {
    if (track.trackId !== pendingTrack.trackId) {
      return false;
    }

    const playedAt = new Date(track.playedAt).getTime();
    return Number.isFinite(playedAt) && Math.abs(playedAt - pendingPlayedAt) <= 15000;
  });
}

function handOffCurrentTrack(previous: NowPlayingState) {
  if (!previous.track) {
    return { nextState: previous, recentTrack: null as RecentTrackSummary | null };
  }

  const nextRecentTracks = prependRecentTrack(previous.recentTracks ?? [], previous.track);
  const recentTrack = nextRecentTracks[0] ?? null;

  return {
    nextState: {
      ...previous,
      isPlaying: false,
      progressMs: previous.track.durationMs,
      recentTracks: nextRecentTracks,
      syncedRecentCount: (previous.syncedRecentCount ?? 0) + 1,
      syncedAt: new Date().toISOString(),
    },
    recentTrack,
  };
}

function useNowPlayingState() {
  const [state, setState] = useState<NowPlayingState | null>(null);
  const [displayProgressMs, setDisplayProgressMs] = useState(0);
  const [handoffPending, setHandoffPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stateRef = useRef<NowPlayingState | null>(null);
  const displayProgressRef = useRef(0);
  const pendingRecentTrackRef = useRef<RecentTrackSummary | null>(null);
  const pollTimerRef = useRef<number | undefined>(undefined);
  const handoffTimerRef = useRef<number | undefined>(undefined);
  const loadRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    displayProgressRef.current = displayProgressMs;
  }, [displayProgressMs]);

  useEffect(() => {
    let cancelled = false;

    function clearPollTimer() {
      if (pollTimerRef.current) {
        window.clearTimeout(pollTimerRef.current);
        pollTimerRef.current = undefined;
      }
    }

    function scheduleNextPoll() {
      if (cancelled) {
        return;
      }

      clearPollTimer();
      pollTimerRef.current = window.setTimeout(() => {
        void load();
      }, NOW_PLAYING_POLL_MS);
    }

    async function load() {
      try {
        const response = await fetch("/api/player/now-playing?limit=12", { cache: "no-store" });
        if (!response.ok) {
          throw new Error("Could not load current playback.");
        }

        const nextState = (await response.json()) as NowPlayingState;
        const previous = stateRef.current;
        const serverRecentTracks = nextState.recentTracks ?? [];
        const pendingRecentTrack = pendingRecentTrackRef.current;
        const serverContainsPending = serverHasMatchingRecentTrack(serverRecentTracks, pendingRecentTrack);
        const hasTrackChange =
          Boolean(previous?.track?.id) &&
          Boolean(nextState.track?.id) &&
          previous?.track?.id !== nextState.track?.id;

        if (serverContainsPending) {
          pendingRecentTrackRef.current = null;
        }

        const mergedRecentTracks = mergeRecentTracks(
          serverRecentTracks,
          pendingRecentTrack && !serverContainsPending
            ? [pendingRecentTrack, ...(previous?.recentTracks ?? [])]
            : previous?.recentTracks ?? [],
        );

        const remainingPreviousMs = previous?.track?.durationMs
          ? Math.max(0, previous.track.durationMs - displayProgressRef.current)
          : Number.POSITIVE_INFINITY;
        const shouldHandOffPrevious =
          !nextState.track &&
          Boolean(previous?.track) &&
          Boolean(previous?.isPlaying) &&
          !pendingRecentTrackRef.current &&
          remainingPreviousMs <= HANDOFF_GRACE_MS;

        const resolvedState = nextState.track
          ? (() => {
              if (hasTrackChange && previous?.track) {
                const { nextState: handedOffState, recentTrack } = handOffCurrentTrack(previous);
                pendingRecentTrackRef.current = recentTrack;

                return {
                  ...nextState,
                  recentTracks: mergeRecentTracks(handedOffState.recentTracks ?? [], mergedRecentTracks),
                };
              }

              return {
                ...nextState,
                recentTracks: mergedRecentTracks,
              };
            })()
          : shouldHandOffPrevious && previous?.track
            ? (() => {
                const { nextState: handedOffState, recentTrack } = handOffCurrentTrack(previous);
                pendingRecentTrackRef.current = recentTrack;

                return {
                  ...handedOffState,
                  recentTracks: mergeRecentTracks(handedOffState.recentTracks ?? [], mergedRecentTracks),
                  syncedRecentCount: nextState.syncedRecentCount ?? handedOffState.syncedRecentCount,
                  syncedAt: nextState.syncedAt ?? handedOffState.syncedAt,
                };
              })()
            : previous?.track
              ? {
                  ...previous,
                  isPlaying: false,
                  progressMs: previous.progressMs,
                  recentTracks: mergedRecentTracks,
                  syncedRecentCount: nextState.syncedRecentCount ?? previous.syncedRecentCount,
                  syncedAt: nextState.syncedAt ?? previous.syncedAt,
                }
              : {
                  ...nextState,
                  recentTracks: mergedRecentTracks,
                };

        if (!cancelled) {
          stateRef.current = resolvedState;
          setState(resolvedState);
          setHandoffPending(!nextState.track && Boolean(pendingRecentTrackRef.current));
          setError(null);
          scheduleNextPoll();
        }
      } catch {
        if (!cancelled) {
          setError("Live playback could not be loaded right now.");
          scheduleNextPoll();
        }
      }
    }

    loadRef.current = load;
    void load();

    return () => {
      cancelled = true;
      loadRef.current = null;
      clearPollTimer();
    };
  }, []);

  useEffect(() => {
    if (!state?.track?.durationMs) {
      setDisplayProgressMs(0);
      return;
    }

    setDisplayProgressMs(Math.max(0, Math.min(state.track.durationMs, state.progressMs ?? 0)));

    if (!state.isPlaying) {
      return;
    }

    const durationMs = state.track.durationMs;
    const tick = window.setInterval(() => {
      setDisplayProgressMs((previous) => Math.min(durationMs, previous + PROGRESS_TICK_MS));
    }, PROGRESS_TICK_MS);

    return () => {
      window.clearInterval(tick);
    };
  }, [state?.isPlaying, state?.progressMs, state?.track?.durationMs, state?.track?.id]);

  useEffect(() => {
    if (handoffTimerRef.current) {
      window.clearTimeout(handoffTimerRef.current);
      handoffTimerRef.current = undefined;
    }

    if (!state?.isPlaying || !state.track?.durationMs) {
      return;
    }

    const remainingMs = Math.max(0, state.track.durationMs - displayProgressMs);
    handoffTimerRef.current = window.setTimeout(() => {
      setState((previous) => {
        if (!previous?.track || previous.track.id !== state.track?.id) {
          return previous;
        }

        const { nextState, recentTrack } = handOffCurrentTrack(previous);
        pendingRecentTrackRef.current = recentTrack;
        return nextState;
      });
      setHandoffPending(true);
      void loadRef.current?.();
    }, remainingMs + TRACK_END_DELAY_MS);

    return () => {
      if (handoffTimerRef.current) {
        window.clearTimeout(handoffTimerRef.current);
        handoffTimerRef.current = undefined;
      }
    };
  }, [displayProgressMs, state?.isPlaying, state?.track?.durationMs, state?.track?.id]);

  return { state, displayProgressMs, handoffPending, error };
}

export function NowPlayingPanel() {
  const { state, displayProgressMs, handoffPending, error } = useNowPlayingState();
  const recentTracks = state?.recentTracks ?? [];
  const visibleRecentTracks = recentTracks.slice(0, COLLAPSED_RECENT_COUNT);
  const progress = useMemo(() => {
    if (!state?.track?.durationMs) {
      return 0;
    }

    return Math.max(0, Math.min(100, (displayProgressMs / state.track.durationMs) * 100));
  }, [displayProgressMs, state?.track?.durationMs]);
  const remainingMs = state?.track?.durationMs
    ? Math.max(0, state.track.durationMs - displayProgressMs)
    : 0;

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
          {state?.track?.durationMs ? (
            <div className="sticker-badge px-3 py-1 font-mono text-xs uppercase tracking-[0.18em] text-[var(--theme-badge)]">
              {handoffPending ? "checking next song" : `${formatClock(remainingMs)} left`}
            </div>
          ) : null}
        </div>

        {error ? <p className="mt-6 rounded-[20px] border-2 border-[rgba(57,18,98,0.22)] bg-white/55 px-4 py-3 text-sm text-[var(--theme-text)]">{error}</p> : null}

        {state?.track ? (
          <div className="mt-6 space-y-4">
            <div className="space-y-4">
              <div className="desktop-card overflow-hidden p-3">
                <div className="media-frame relative mx-auto aspect-square w-full max-w-[320px] p-2">
                  {state.track.imageUrl ? (
                    <Image src={state.track.imageUrl} alt={state.track.title} fill sizes="(max-width: 1280px) 320px, 380px" className="rounded-[18px] object-cover" />
                  ) : null}
                  <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(72,24,110,0.08)_36%,rgba(72,24,110,0.22))]" />
                </div>
              </div>

              <div className="desktop-card p-4">
                <p className="section-kicker">{handoffPending ? "Just finished" : "Playing now"}</p>
                <p className={`mt-2 font-display uppercase tracking-[0.08em] text-[var(--theme-title)] ${getAdaptiveHeadingClass(state.track.title)}`}>{state.track.title}</p>
                <p className={`mt-2 uppercase text-[var(--theme-muted)] ${getAdaptiveSubheadingClass(state.track.artist)}`}>{state.track.artist}</p>
                <p className="mt-1 break-words font-mono text-sm uppercase tracking-[0.14em] text-[var(--theme-body)]">{state.track.album}</p>
                {handoffPending ? (
                  <p className="mt-3 text-sm text-[var(--theme-muted)]">Waiting for the next Spotify playback update.</p>
                ) : null}
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
                <div className="mt-3 flex items-center justify-between font-mono text-xs uppercase tracking-[0.16em] text-[var(--theme-muted)]">
                  <span>{formatClock(displayProgressMs)}</span>
                  <span>-{formatClock(remainingMs)}</span>
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
                            <Image src={track.imageUrl} alt={track.title} fill sizes="64px" className="rounded-[12px] object-cover" />
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

