"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { MaintenanceAction, RetryUnresolvedBatchProfile } from "@/lib/dashboard-maintenance";

const DASHBOARD_JOB_STARTED_EVENT = "soundscope:dashboard-job-started";

type PlaylistSearchItem = {
  id: string;
  name: string;
  imageUrl?: string | null;
  trackCount: number;
  ownerName?: string | null;
};

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
  { action: "refresh-all-time-full", label: "All-Time Full", description: "Fully rebuild all-time top lists from permanent libraries.", lane: "dashboard" },
  { action: "refresh-all-time-incremental", label: "All-Time Incremental", description: "Update all-time top lists using only plays after the last stored checkpoint.", lane: "dashboard" },
];

const RETRY_PROFILES: Array<{
  value: RetryUnresolvedBatchProfile;
  label: string;
  description: string;
}> = [
  { value: "cache-only", label: "Cache Only (3000)", description: "Checks permanent libraries and cached playlists only. Does not call Spotify search at all, and scans a large unresolved batch locally." },
  { value: "conservative", label: "Conservative (25)", description: "Lowest Spotify search pressure. Best if rate limits are hitting often." },
  { value: "balanced", label: "Balanced (100)", description: "Good default. Tries a much larger batch without being too aggressive." },
  { value: "aggressive", label: "Aggressive (250)", description: "Larger retry pass with light pacing between Spotify lookups. Better throughput without bursting quite as hard." },
  { value: "very-aggressive", label: "Very Aggressive (500)", description: "Biggest backlog-burn mode. Uses a much larger target batch, longer runtime, and deliberate pacing to squeeze more completed matches per click before rate limits hit." },
];

export function DashboardMaintenancePanel() {
  const router = useRouter();
  const [runningAction, setRunningAction] = useState<MaintenanceAction | null>(null);
  const [retryProfile, setRetryProfile] = useState<RetryUnresolvedBatchProfile>("balanced");
  const [playlistQuery, setPlaylistQuery] = useState("");
  const [playlistResults, setPlaylistResults] = useState<PlaylistSearchItem[]>([]);
  const [playlistSearchState, setPlaylistSearchState] = useState<"idle" | "loading" | "done">("idle");
  const [selectedPlaylist, setSelectedPlaylist] = useState<PlaylistSearchItem | null>(null);

  async function runAction(button: MaintenanceButton, extraBody?: Record<string, unknown>) {
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
        body: JSON.stringify({ action: button.action, ...extraBody }),
      });
      router.refresh();
    } finally {
      setRunningAction(null);
    }
  }

  async function searchPlaylists() {
    const trimmedQuery = playlistQuery.trim();
    if (trimmedQuery.length < 2) {
      setPlaylistResults([]);
      setPlaylistSearchState("idle");
      return;
    }

    setPlaylistSearchState("loading");
    try {
      const response = await fetch(`/api/dashboard/playlist-library/search?q=${encodeURIComponent(trimmedQuery)}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      const data = await response.json().catch(() => ({ items: [] }));
      setPlaylistResults(Array.isArray(data?.items) ? data.items : []);
      setPlaylistSearchState("done");
    } catch {
      setPlaylistResults([]);
      setPlaylistSearchState("done");
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
        <div className="rounded-[20px] border-[2px] border-[rgba(44,12,70,0.22)] bg-white/70 px-4 py-4 md:col-span-2 xl:col-span-3">
          <p className="font-display text-sm uppercase tracking-[0.14em] text-[var(--theme-title)]">Retry Unresolved Last.fm</p>
          <p className="mt-2 text-sm text-[var(--theme-text)]">
            Choose how aggressively Listening Lore should search Spotify for unresolved imported tracks. Larger passes reduce clicks, but they can hit Spotify rate limits sooner. The stronger modes now deliberately pace Spotify searches instead of blasting them back-to-back.
          </p>

          <div className="mt-4 rounded-[18px] border-[2px] border-[rgba(44,12,70,0.18)] bg-white/65 px-4 py-4">
            <p className="font-display text-xs uppercase tracking-[0.14em] text-[var(--theme-title)]">Preferred Playlist Source</p>
            <p className="mt-2 text-sm text-[var(--theme-text)]">
              Search for one stored playlist to use as the cached tracklist source for this normalization pass. Nothing is shown here until you search.
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                type="search"
                value={playlistQuery}
                onChange={(event) => setPlaylistQuery(event.target.value)}
                placeholder="Search stored playlists by name..."
                className="min-w-0 flex-1 rounded-full border border-[rgba(44,12,70,0.18)] bg-white px-4 py-2 text-sm text-[var(--theme-text)] outline-none transition focus:border-[rgba(44,12,70,0.45)]"
              />
              <button
                type="button"
                onClick={() => void searchPlaylists()}
                disabled={playlistSearchState === "loading" || playlistQuery.trim().length < 2}
                className="rounded-full border border-[rgba(44,12,70,0.28)] bg-[rgba(255,236,245,0.9)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--theme-title)] transition hover:border-[rgba(44,12,70,0.55)] disabled:opacity-60"
              >
                {playlistSearchState === "loading" ? "Searching..." : "Search"}
              </button>
            </div>
            {selectedPlaylist ? (
              <div className="mt-3 rounded-[16px] border border-[rgba(44,12,70,0.18)] bg-[rgba(255,236,245,0.72)] px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-display text-sm uppercase tracking-[0.12em] text-[var(--theme-title)]">{selectedPlaylist.name}</p>
                    <p className="mt-1 text-xs text-[var(--theme-muted)]">
                      {selectedPlaylist.trackCount.toLocaleString()} tracks{selectedPlaylist.ownerName ? ` • ${selectedPlaylist.ownerName}` : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedPlaylist(null)}
                    className="rounded-full border border-[rgba(44,12,70,0.2)] bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--theme-title)]"
                  >
                    Clear
                  </button>
                </div>
              </div>
            ) : null}
            {playlistSearchState === "done" ? (
              playlistResults.length > 0 ? (
                <div className="mt-3 grid gap-2">
                  {playlistResults.map((playlist) => (
                    <button
                      key={playlist.id}
                      type="button"
                      onClick={() => setSelectedPlaylist(playlist)}
                      className="rounded-[16px] border border-[rgba(44,12,70,0.18)] bg-white/80 px-4 py-3 text-left transition hover:border-[rgba(44,12,70,0.5)]"
                    >
                      <p className="font-display text-sm uppercase tracking-[0.12em] text-[var(--theme-title)]">{playlist.name}</p>
                      <p className="mt-1 text-xs text-[var(--theme-muted)]">
                        {playlist.trackCount.toLocaleString()} tracks{playlist.ownerName ? ` • ${playlist.ownerName}` : ""}
                      </p>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-sm text-[var(--theme-muted)]">No stored playlists matched that search.</p>
              )
            ) : null}
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-2 xl:grid-cols-5">
            {RETRY_PROFILES.map((profile) => {
              const isSelected = retryProfile === profile.value;
              return (
                <button
                  key={profile.value}
                  type="button"
                  disabled={Boolean(runningAction)}
                  onClick={() => {
                    setRetryProfile(profile.value);
                    void runAction(
                      {
                        action: "retry-unresolved-lastfm-imports",
                        label: profile.label,
                        description: profile.description,
                        lane: "backfill",
                      },
                      { retryProfile: profile.value, playlistId: selectedPlaylist?.id },
                    );
                  }}
                  className={`rounded-[18px] border-[2px] px-4 py-4 text-left transition disabled:opacity-60 ${
                    isSelected
                      ? "border-[rgba(44,12,70,0.75)] bg-[rgba(255,236,245,0.9)]"
                      : "border-[rgba(44,12,70,0.22)] bg-white/65 hover:border-[rgba(44,12,70,0.55)]"
                  }`}
                >
                  <p className="font-display text-sm uppercase tracking-[0.14em] text-[var(--theme-title)]">
                    {runningAction === "retry-unresolved-lastfm-imports" && isSelected ? `Running ${profile.label}` : profile.label}
                  </p>
                  <p className="mt-2 text-sm text-[var(--theme-text)]">{profile.description}</p>
                </button>
              );
            })}
          </div>
        </div>
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
