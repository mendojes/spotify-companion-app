"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Disc3 } from "lucide-react";
import { RecentTrackSummary } from "@/lib/types";
import { formatPstDateTime } from "@/lib/time";

type RecentHistoryState = {
  recentTracks: RecentTrackSummary[];
  nextCursor?: string | null;
  syncState?: "idle" | "syncing";
  syncMode?: "incremental" | "full";
  syncStartedAt?: string;
  syncError?: string;
  syncedRecentCount?: number;
  syncedAt?: string;
};

function formatPlayedAt(value: string) {
  return formatPstDateTime(value, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function RecentTracksPageView() {
  const [state, setState] = useState<RecentHistoryState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        if (!cancelled) {
          setIsSyncing(true);
        }

        const syncResponse = await fetch("/api/player/recent-sync?force=1&full=1", {
          method: "POST",
          cache: "no-store",
        }).catch(() => undefined);

        if (syncResponse && !syncResponse.ok) {
          const payload = (await syncResponse.json().catch(() => null)) as { error?: string } | null;
          throw new Error(payload?.error || "Could not sync recent playback from Spotify.");
        }

        const response = await fetch("/api/player/recent-history?limit=100", { cache: "no-store" });
        if (!response.ok) {
          throw new Error("Could not load recent playback.");
        }

        const nextState = (await response.json()) as RecentHistoryState;
        if (!cancelled) {
          setState(nextState);
          setError(null);
        }
      } catch {
        if (!cancelled) {
          setError("Recent listening history could not be loaded right now.");
        }
      } finally {
        if (!cancelled) {
          setIsSyncing(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  const recentTracks = state?.recentTracks ?? [];

  async function loadMore() {
    if (!state?.nextCursor || isLoadingMore) {
      return;
    }

    setIsLoadingMore(true);

    try {
      const response = await fetch(`/api/player/recent-history?limit=100&before=${encodeURIComponent(state.nextCursor)}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error("Could not load more recent playback.");
      }

      const nextState = (await response.json()) as RecentHistoryState;
      setState((current) => ({
        recentTracks: [...(current?.recentTracks ?? []), ...nextState.recentTracks],
        nextCursor: nextState.nextCursor,
        syncedRecentCount: current?.syncedRecentCount ?? nextState.syncedRecentCount,
        syncedAt: current?.syncedAt ?? nextState.syncedAt,
      }));
    } catch {
      setError("More recent listening history could not be loaded right now.");
    } finally {
      setIsLoadingMore(false);
    }
  }

  return (
    <section className="px-6 py-10 md:px-10">
      <div className="mx-auto max-w-7xl space-y-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-3xl space-y-3">
            <p className="text-sm uppercase tracking-[0.3em] text-coral/80">Recent History</p>
            <h1 className="font-display text-5xl text-[var(--theme-title)] md:text-6xl">Everything still spinning in your orbit.</h1>
            <p className="text-base leading-7 text-[var(--theme-body)]">
              A wider look at the tracks Listening Lore has synced from your recent listening history.
            </p>
          </div>
          <Link
            href="/dashboard"
            className="rounded-full border border-[rgba(57,18,98,0.16)] bg-white/[0.18] px-4 py-2 text-sm text-[var(--theme-text)] transition hover:border-gold/25 hover:text-gold"
          >
            Back to dashboard
          </Link>
        </div>

        {error ? (
          <div className="rounded-[28px] border border-gold/30 bg-gold/10 px-5 py-4 text-sm text-ink/85">{error}</div>
        ) : null}

        {isSyncing ? (
          <div className="rounded-[28px] border border-cyan/25 bg-cyan/10 px-5 py-4 text-sm text-ink/85">
            Syncing recent listening history from Spotify and backfilling missed plays from when the app was closed. This can take a few seconds if there are a lot of listens to recover.
          </div>
        ) : null}

        <div className="glass-panel rounded-[34px] p-6 md:p-8">
          <div className="flex items-center gap-3">
            <Disc3 className="h-5 w-5 text-coral" />
            <div>
              <p className="text-sm uppercase tracking-[0.24em] text-coral/80">Synced Tracks</p>
              <h2 className="mt-1 font-display text-3xl text-[var(--theme-title)]">Recent plays</h2>
            </div>
          </div>

          {state?.syncedAt ? (
            <p className="mt-4 text-sm text-[var(--theme-muted)]">
              Last synced {formatPstDateTime(state.syncedAt)}. Showing {recentTracks.length} recovered plays{state.nextCursor ? " so far" : ""}.
            </p>
          ) : null}

          {state?.syncState === "syncing" ? (
            <p className="mt-2 text-sm text-cyan">
              Spotify history recovery is still running{state.syncMode === "full" ? " in full-backfill mode" : ""}{state.syncStartedAt ? ` since ${formatPstDateTime(state.syncStartedAt)}` : ""}.
            </p>
          ) : null}

          {state?.syncError ? (
            <p className="mt-2 text-sm text-coral">
              Last Spotify history recovery error: {state.syncError}
            </p>
          ) : null}

          <div className="mt-8 space-y-4">
            {recentTracks.length > 0 ? (
              recentTracks.map((track) => (
                <div
                  key={`${track.trackId}:${track.playedAt}`}
                  className="flex items-center gap-5 rounded-[28px] border border-ink/10 bg-[linear-gradient(180deg,rgba(255,248,232,0.05),rgba(255,255,255,0.02))] p-5"
                >
                  {track.imageUrl ? (
                    <div className="relative h-28 w-28 overflow-hidden rounded-[28px] border border-ink/12 bg-white/5">
                      <Image src={track.imageUrl} alt={track.title} fill sizes="112px" className="object-contain bg-white/[0.2]" />
                    </div>
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display text-3xl text-[var(--theme-title)]">{track.title}</p>
                    <p className="mt-2 truncate text-base text-[var(--theme-body)]">{track.artist}</p>
                    <p className="mt-2 truncate text-sm uppercase tracking-[0.2em] text-[var(--theme-muted)]">{track.album}</p>
                  </div>
                  <p className="text-right text-sm text-[var(--theme-muted)]">{formatPlayedAt(track.playedAt)}</p>
                </div>
              ))
            ) : (
              <div className="rounded-[28px] border border-ink/10 bg-white/[0.03] p-6 text-sm text-ink/75">
                Recent listening history will start showing here as Spotify syncs into Listening Lore.
              </div>
            )}
          </div>

          {state?.nextCursor ? (
            <div className="mt-8 flex justify-center">
              <button
                type="button"
                onClick={() => void loadMore()}
                disabled={isLoadingMore}
                className="rounded-full border border-ink/15 bg-white/5 px-5 py-3 text-sm text-ink transition hover:border-gold/25 hover:text-gold disabled:cursor-wait disabled:opacity-60"
              >
                {isLoadingMore ? "Loading more..." : "Load more history"}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}



