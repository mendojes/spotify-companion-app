"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { MaintenanceAction } from "@/lib/dashboard-maintenance";

const DASHBOARD_JOB_STARTED_EVENT = "soundscope:dashboard-job-started";

type MaintenanceButton = {
  action: MaintenanceAction;
  label: string;
  description: string;
  lane: "dashboard" | "backfill";
};

const BUTTONS: MaintenanceButton[] = [
  { action: "rebuild-playlist-cache", label: "Playlist Cache", description: "Rebuild only the stored playlist section cache.", lane: "dashboard" },
  { action: "rebuild-overview-cache", label: "Overview Cache", description: "Rebuild only the dashboard overview cache.", lane: "dashboard" },
  { action: "rebuild-top-list-caches", label: "Top Lists Cache", description: "Rebuild cached week, month, and year top lists only.", lane: "dashboard" },
  { action: "backfill-artist-metadata", label: "Artist Metadata", description: "Fetch missing permanent artist metadata and images.", lane: "dashboard" },
  { action: "delete-lastfm-imports", label: "Delete Last.fm Imports", description: "Remove imported Last.fm plays and reset the permanent-library footprint they created.", lane: "dashboard" },
  { action: "delete-unresolved-lastfm-imports", label: "Delete Unresolved Last.fm", description: "Remove only imported Last.fm plays that are still unresolved and still using synthetic Last.fm ids.", lane: "dashboard" },
  { action: "delete-non-spotify-track-metadata", label: "Delete Non-Spotify Track Metadata", description: "Remove any permanent track-metadata entries whose track id is not a real Spotify track id.", lane: "dashboard" },
  { action: "refresh-track-library-full", label: "Track Library Full", description: "Full rebuild of permanent track metadata and all-time counts, while skipping unresolved Last.fm imports.", lane: "dashboard" },
  { action: "refresh-track-library-incremental", label: "Track Library Incremental", description: "Only add plays after the stored track-library checkpoint, while skipping unresolved Last.fm imports.", lane: "dashboard" },
  { action: "refresh-artist-library-full", label: "Artist Library Full", description: "Full rebuild of permanent artist counts for this user.", lane: "dashboard" },
  { action: "refresh-artist-library-incremental", label: "Artist Library Incremental", description: "Only add plays after the stored artist-library checkpoint.", lane: "dashboard" },
  { action: "refresh-album-library-full", label: "Album Library Full", description: "Full rebuild of permanent album metadata and counts.", lane: "dashboard" },
  { action: "refresh-album-library-incremental", label: "Album Library Incremental", description: "Only add plays after the stored album-library checkpoint.", lane: "dashboard" },
  { action: "retry-unresolved-lastfm-imports", label: "Retry Unresolved Last.fm", description: "Retry only the imported scrobbles that are still unresolved and still using synthetic Last.fm ids.", lane: "backfill" },
  { action: "refresh-all-time-full", label: "All-Time Full", description: "Fully rebuild all-time top lists from permanent libraries.", lane: "dashboard" },
  { action: "refresh-all-time-incremental", label: "All-Time Incremental", description: "Update all-time top lists using only plays after the last stored checkpoint.", lane: "dashboard" },
];

export function DashboardMaintenancePanel() {
  const router = useRouter();
  const [runningAction, setRunningAction] = useState<MaintenanceAction | null>(null);

  async function runAction(button: MaintenanceButton) {
    if (runningAction) {
      return;
    }

    setRunningAction(button.action);
    window.dispatchEvent(new CustomEvent(DASHBOARD_JOB_STARTED_EVENT, {
      detail: {
        lane: button.lane,
        detail: button.description,
      },
    }));

    try {
      await fetch("/api/dashboard/maintenance", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: button.action }),
      });
      router.refresh();
    } finally {
      setRunningAction(null);
    }
  }

  return (
    <section className="rounded-[24px] border-[3px] border-[rgba(44,12,70,0.9)] bg-[rgba(255,247,252,0.86)] px-5 py-5 shadow-glow">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-display text-lg uppercase tracking-[0.12em] text-[var(--theme-title)]">Dashboard Maintenance</p>
          <p className="text-sm text-[var(--theme-muted)]">Run one isolated refresh or backfill step at a time so each batch can save real progress before it stops.</p>
        </div>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {BUTTONS.map((button) => {
          const isRunning = runningAction === button.action;
          return (
            <button
              key={button.action}
              type="button"
              onClick={() => void runAction(button)}
              disabled={Boolean(runningAction)}
              className="rounded-[20px] border-[2px] border-[rgba(44,12,70,0.22)] bg-white/70 px-4 py-4 text-left transition hover:border-[rgba(44,12,70,0.55)] disabled:opacity-60"
            >
              <p className="font-display text-sm uppercase tracking-[0.14em] text-[var(--theme-title)]">
                {isRunning ? `Running ${button.label}` : button.label}
              </p>
              <p className="mt-2 text-sm text-[var(--theme-text)]">{button.description}</p>
            </button>
          );
        })}
      </div>
    </section>
  );
}
