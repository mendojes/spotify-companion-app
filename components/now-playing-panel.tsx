"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { Disc3, Radio } from "lucide-react";
import { NowPlayingState } from "@/lib/types";

function formatPlayedAt(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function NowPlayingPanel() {
  const [state, setState] = useState<NowPlayingState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch("/api/player/now-playing", { cache: "no-store" });
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

  return (
    <section className="px-6 py-10 md:px-10">
      <div className="mx-auto grid max-w-7xl gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="glass-panel rounded-[32px] p-6">
          <div className="flex items-center gap-3">
            <Radio className="h-5 w-5 text-cyan" />
            <div>
              <p className="text-sm uppercase tracking-[0.24em] text-cyan/70">Now Playing</p>
              <h2 className="mt-2 font-display text-2xl text-white">Live listening state</h2>
            </div>
          </div>

          {error ? <p className="mt-6 text-sm text-gold">{error}</p> : null}

          {state?.track ? (
            <div className="mt-6 flex items-start gap-5">
              {state.track.imageUrl ? (
                <div className="relative h-28 w-28 overflow-hidden rounded-[28px] border border-white/10 bg-white/5">
                  <Image src={state.track.imageUrl} alt={state.track.title} fill sizes="112px" className="object-cover" />
                </div>
              ) : null}
              <div className="min-w-0 flex-1">
                <p className="text-sm text-cyan">{state.isPlaying ? "Playing now" : "Paused / inactive"}</p>
                <h3 className="mt-2 font-display text-3xl text-white">{state.track.title}</h3>
                <p className="mt-2 text-base text-ink/80">{state.track.artist}</p>
                <p className="mt-2 text-sm uppercase tracking-[0.18em] text-ink/55">{state.track.album}</p>
                {state.syncedAt ? <p className="mt-4 text-xs text-ink/50">Synced {formatPlayedAt(state.syncedAt)}</p> : null}
              </div>
            </div>
          ) : (
            <div className="mt-6 rounded-[26px] border border-white/10 bg-white/[0.03] p-5 text-sm text-ink/75">
              No active playback detected right now.
            </div>
          )}
        </div>

        <div className="glass-panel rounded-[32px] p-6">
          <div className="flex items-center gap-3">
            <Disc3 className="h-5 w-5 text-gold" />
            <div>
              <p className="text-sm uppercase tracking-[0.24em] text-cyan/70">Recent Tracks</p>
              <h2 className="mt-2 font-display text-2xl text-white">What you listened to lately</h2>
            </div>
          </div>

          <div className="mt-6 space-y-4">
            {state?.recentTracks && state.recentTracks.length > 0 ? (
              state.recentTracks.map((track) => (
                <div key={`${track.trackId}:${track.playedAt}`} className="flex items-center gap-4 rounded-[24px] border border-white/10 bg-white/[0.03] p-4">
                  {track.imageUrl ? (
                    <div className="relative h-20 w-20 overflow-hidden rounded-[24px] border border-white/10 bg-white/5">
                      <Image src={track.imageUrl} alt={track.title} fill sizes="80px" className="object-cover" />
                    </div>
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-white">{track.title}</p>
                    <p className="mt-1 truncate text-sm text-ink/70">{track.artist}</p>
                    <p className="mt-1 truncate text-xs uppercase tracking-[0.18em] text-ink/55">{track.album}</p>
                  </div>
                  <p className="text-xs text-ink/50">{formatPlayedAt(track.playedAt)}</p>
                </div>
              ))
            ) : (
              <div className="rounded-[26px] border border-white/10 bg-white/[0.03] p-5 text-sm text-ink/75">
                Recent listening history will start showing here as Spotify syncs into SoundScope.
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}