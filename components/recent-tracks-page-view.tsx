"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Disc3 } from "lucide-react";
import { NowPlayingState } from "@/lib/types";

function formatPlayedAt(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function RecentTracksPageView() {
  const [state, setState] = useState<NowPlayingState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch("/api/player/now-playing?limit=50", { cache: "no-store" });
        if (!response.ok) {
          throw new Error("Could not load recent playback.");
        }

        const nextState = (await response.json()) as NowPlayingState;
        if (!cancelled) {
          setState(nextState);
          setError(null);
        }
      } catch {
        if (!cancelled) {
          setError("Recent listening history could not be loaded right now.");
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  const recentTracks = state?.recentTracks ?? [];

  return (
    <section className="px-6 py-10 md:px-10">
      <div className="mx-auto max-w-7xl space-y-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-3xl space-y-3">
            <p className="text-sm uppercase tracking-[0.3em] text-coral/80">Recent History</p>
            <h1 className="font-display text-5xl text-white md:text-6xl">Everything still spinning in your orbit.</h1>
            <p className="text-base leading-7 text-ink/80">
              A wider look at the tracks SoundScope has synced from your recent listening history.
            </p>
          </div>
          <Link
            href="/dashboard"
            className="rounded-full border border-ink/15 bg-white/5 px-4 py-2 text-sm text-ink transition hover:border-gold/25 hover:text-gold"
          >
            Back to dashboard
          </Link>
        </div>

        {error ? (
          <div className="rounded-[28px] border border-gold/30 bg-gold/10 px-5 py-4 text-sm text-ink/85">{error}</div>
        ) : null}

        <div className="glass-panel rounded-[34px] p-6 md:p-8">
          <div className="flex items-center gap-3">
            <Disc3 className="h-5 w-5 text-coral" />
            <div>
              <p className="text-sm uppercase tracking-[0.24em] text-coral/80">Synced Tracks</p>
              <h2 className="mt-1 font-display text-3xl text-white">Recent plays</h2>
            </div>
          </div>

          <div className="mt-8 space-y-4">
            {recentTracks.length > 0 ? (
              recentTracks.map((track) => (
                <div
                  key={`${track.trackId}:${track.playedAt}`}
                  className="flex items-center gap-5 rounded-[28px] border border-ink/10 bg-[linear-gradient(180deg,rgba(255,248,232,0.05),rgba(255,255,255,0.02))] p-5"
                >
                  {track.imageUrl ? (
                    <div className="relative h-28 w-28 overflow-hidden rounded-[28px] border border-ink/12 bg-white/5">
                      <Image src={track.imageUrl} alt={track.title} fill sizes="112px" className="object-cover" />
                    </div>
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display text-3xl text-white">{track.title}</p>
                    <p className="mt-2 truncate text-base text-ink/80">{track.artist}</p>
                    <p className="mt-2 truncate text-sm uppercase tracking-[0.2em] text-ink/55">{track.album}</p>
                  </div>
                  <p className="text-right text-sm text-ink/55">{formatPlayedAt(track.playedAt)}</p>
                </div>
              ))
            ) : (
              <div className="rounded-[28px] border border-ink/10 bg-white/[0.03] p-6 text-sm text-ink/75">
                Recent listening history will start showing here as Spotify syncs into SoundScope.
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
