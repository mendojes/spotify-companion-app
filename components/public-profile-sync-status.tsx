"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type PublicProfileSyncState = {
  spotifyUserId: string;
  profileUrl: string;
  status: "idle" | "running" | "completed" | "failed";
  phase: string;
  processedPlaylists: number;
  totalPlaylists: number;
  startedAt?: string;
  finishedAt?: string;
  updatedAt?: string;
  durationMs?: number;
  error?: string;
};

type PublicProfileSyncStatusProps = {
  spotifyUserId: string;
  shouldStart?: boolean;
  className?: string;
  compact?: boolean;
  expectedPlaylistCount?: number;
};

function formatClock(value?: string) {
  if (!value) {
    return "—";
  }

  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function formatDuration(durationMs?: number) {
  if (!durationMs || durationMs <= 0) {
    return "—";
  }

  const totalSeconds = Math.round(durationMs / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

export function PublicProfileSyncStatus({
  spotifyUserId,
  shouldStart = false,
  className = "",
  compact = false,
  expectedPlaylistCount,
}: PublicProfileSyncStatusProps) {
  const router = useRouter();
  const [syncState, setSyncState] = useState<PublicProfileSyncState | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);
  const didStartRef = useRef(false);
  const previousStatusRef = useRef<PublicProfileSyncState["status"] | null>(null);

  useEffect(() => {
    let cancelled = false;
    let pollTimeout: ReturnType<typeof setTimeout> | undefined;

    async function fetchStatus() {
      try {
        const response = await fetch("/api/public/profile-sync-status", {
          method: "GET",
          cache: "no-store",
        });

        if (!response.ok) {
          return null;
        }

        const payload = (await response.json()) as PublicProfileSyncState;

        if (!cancelled) {
          const previousStatus = previousStatusRef.current;
          previousStatusRef.current = payload.status;
          setSyncState(payload);
          setBootstrapping(false);

          if (payload.status === "completed" && previousStatus === "running") {
            router.refresh();
          }
        }

        return payload;
      } catch {
        if (!cancelled) {
          setBootstrapping(false);
        }
        return null;
      }
    }

    async function startSync() {
      if (!shouldStart || didStartRef.current) {
        return;
      }

      didStartRef.current = true;
      void fetch("/api/public/profile-sync", {
        method: "POST",
        cache: "no-store",
      }).catch(() => undefined);
    }

    async function tick() {
      const status = await fetchStatus();

      if (!cancelled && shouldStart && (!status || status.status === "idle" || status.status === "failed")) {
        await startSync();
      }

      if (!cancelled) {
        const nextStatus = status?.status;
        if (nextStatus === "running" || (shouldStart && (!status || nextStatus === "idle"))) {
          pollTimeout = setTimeout(() => {
            void tick();
          }, 1800);
        }
      }
    }

    void tick();

    return () => {
      cancelled = true;
      if (pollTimeout) {
        clearTimeout(pollTimeout);
      }
    };
  }, [router, shouldStart, spotifyUserId]);

  const display: PublicProfileSyncState = useMemo(() => {
    if (!syncState) {
      return {
        spotifyUserId,
        profileUrl: "",
        status: shouldStart ? "running" : "idle",
        phase: shouldStart ? "Preparing public playlist sync" : "Public playlist sync idle",
        processedPlaylists: 0,
        totalPlaylists: expectedPlaylistCount ?? 0,
        startedAt: undefined,
        finishedAt: undefined,
        updatedAt: undefined,
        durationMs: undefined,
        error: undefined,
      };
    }

    return syncState;
  }, [expectedPlaylistCount, shouldStart, spotifyUserId, syncState]);

  const toneClass =
    display.status === "completed"
      ? "border-emerald-300/40 bg-emerald-50/70"
      : display.status === "failed"
        ? "border-rose-300/40 bg-rose-50/70"
        : "border-cyan/20 bg-cyan/10";

  const statusLabel =
    bootstrapping && !syncState
      ? "Checking sync status"
      : display.status === "completed"
        ? "Insights ready"
        : display.status === "failed"
          ? "Sync failed"
          : display.status === "running"
            ? "Syncing public playlists"
            : "Ready to sync";

  const totalPlaylists =
    display.totalPlaylists && display.totalPlaylists > 0
      ? display.totalPlaylists
      : expectedPlaylistCount ?? 0;

  return (
    <div className={`rounded-[24px] border px-5 py-4 text-[var(--theme-body)] ${toneClass} ${className}`.trim()}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-[0.24em] text-[#2b7f97]">Public playlist sync</p>
          <p className="font-display text-2xl text-[var(--theme-title)]">{statusLabel}</p>
          <p className="text-sm leading-6">{display.phase}</p>
        </div>
        <div className="rounded-full border border-white/50 bg-white/50 px-4 py-2 text-sm text-[var(--theme-text)]">
          {display.processedPlaylists ?? 0}/{totalPlaylists} playlists
        </div>
      </div>

      <div className={`mt-4 grid gap-3 ${compact ? "sm:grid-cols-2" : "sm:grid-cols-4"}`}>
        <div className="rounded-2xl border border-white/40 bg-white/50 px-4 py-3">
          <p className="text-xs uppercase tracking-[0.18em] text-[var(--theme-muted)]">Started</p>
          <p className="mt-2 text-sm text-[var(--theme-text)]">{formatClock(display.startedAt)}</p>
        </div>
        <div className="rounded-2xl border border-white/40 bg-white/50 px-4 py-3">
          <p className="text-xs uppercase tracking-[0.18em] text-[var(--theme-muted)]">Finished</p>
          <p className="mt-2 text-sm text-[var(--theme-text)]">{formatClock(display.finishedAt)}</p>
        </div>
        <div className="rounded-2xl border border-white/40 bg-white/50 px-4 py-3">
          <p className="text-xs uppercase tracking-[0.18em] text-[var(--theme-muted)]">Elapsed</p>
          <p className="mt-2 text-sm text-[var(--theme-text)]">{formatDuration(display.durationMs)}</p>
        </div>
        <div className="rounded-2xl border border-white/40 bg-white/50 px-4 py-3">
          <p className="text-xs uppercase tracking-[0.18em] text-[var(--theme-muted)]">Last update</p>
          <p className="mt-2 text-sm text-[var(--theme-text)]">{formatClock(display.updatedAt)}</p>
        </div>
      </div>

      {display.error ? (
        <p className="mt-4 rounded-2xl border border-rose-200/60 bg-white/60 px-4 py-3 text-sm text-rose-700">
          {display.error}
        </p>
      ) : null}
    </div>
  );
}