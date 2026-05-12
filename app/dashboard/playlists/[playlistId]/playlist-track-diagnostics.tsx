"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

type PlaylistUnavailableTrackSummary = {
  position: number;
  title: string;
  artist: string;
  album: string;
  reason: string;
  imageUrl?: string;
};

type PlaylistTrackDiagnostics = {
  totalItems: number;
  fetchedItems: number;
  analyzableTracks: number;
  rejectedItems: number;
  localItems: number;
  unavailableItems: number;
  partialItems: number;
  unknownItems: number;
  completed: boolean;
  nextOffset: number;
  lastError?: string;
  unavailableTracks: PlaylistUnavailableTrackSummary[];
};

export function PlaylistTrackDiagnosticsPanel({
  playlistId,
  mode,
  fallbackTotalItems,
  fallbackAnalyzableTracks,
}: {
  playlistId: string;
  mode: "authenticated" | "public";
  fallbackTotalItems: number;
  fallbackAnalyzableTracks: number;
}) {
  const [diagnostics, setDiagnostics] = useState<PlaylistTrackDiagnostics | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadDiagnostics() {
      try {
        const response = await fetch(`/api/dashboard/playlists/${playlistId}/diagnostics`, {
          cache: "no-store",
        });

        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as PlaylistTrackDiagnostics;
        if (!cancelled) {
          setDiagnostics(payload);
        }
      } catch {
        return;
      }
    }

    void loadDiagnostics();

    return () => {
      cancelled = true;
    };
  }, [playlistId]);

  const totalItems = diagnostics?.totalItems ?? fallbackTotalItems;
  const fetchedItems = diagnostics?.fetchedItems ?? fallbackAnalyzableTracks;
  const analyzableTracks = diagnostics?.analyzableTracks ?? fallbackAnalyzableTracks;
  const rejectedItems = diagnostics?.rejectedItems ?? Math.max(0, totalItems - analyzableTracks);
  const unavailableTracks = diagnostics?.unavailableTracks ?? [];

  return (
    <div className="space-y-6">
      <div className="rounded-[24px] border border-gold/25 bg-gold/10 px-5 py-4 text-sm text-ink/85">
        <p className="font-medium text-[var(--theme-title)]">Debug counts</p>
        <div className="mt-2 space-y-1">
          <p>Spotify playlist items: {totalItems}</p>
          <p>Cached playlist items fetched: {fetchedItems}</p>
          <p>Analyzable Spotify tracks: {analyzableTracks}</p>
          <p>Rejected items: {rejectedItems}</p>
          {mode === "authenticated" ? (
            <>
              <p>Local items: {diagnostics?.localItems ?? 0}</p>
              <p>Unavailable/taken down items: {diagnostics?.unavailableItems ?? 0}</p>
              <p>Partial/unknown items: {(diagnostics?.partialItems ?? 0) + (diagnostics?.unknownItems ?? 0)}</p>
            </>
          ) : null}
          <p>Next sync offset: {diagnostics?.nextOffset ?? 0}</p>
          {diagnostics?.lastError ? <p>Last sync error: {diagnostics.lastError}</p> : null}
        </div>
      </div>

      {mode === "authenticated" && unavailableTracks.length > 0 ? (
        <div className="glass-panel rounded-[32px] p-6">
          <p className="text-sm uppercase tracking-[0.24em] text-[#2b7f97]">Unavailable tracks</p>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--theme-body)]">
            These playlist items came back from Spotify as unavailable or no longer fully resolvable, so they are excluded from genre and top-track analysis.
          </p>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {unavailableTracks.map((track) => (
              <div key={`${track.position}:${track.title}:${track.artist}`} className="rounded-[24px] border border-white/10 bg-white/[0.03] p-4 text-[var(--theme-text)]">
                <div className="flex items-start gap-4">
                  {track.imageUrl ? (
                    <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-[20px] border border-white/10 bg-white/5">
                      <Image src={track.imageUrl} alt={track.title} fill sizes="80px" className="object-contain bg-white/[0.2]" />
                    </div>
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs uppercase tracking-[0.18em] text-[#2b7f97]">Item #{track.position}</p>
                    <p className="mt-2 break-words font-display text-xl leading-tight text-[var(--theme-title)]">{track.title}</p>
                    <p className="mt-2 break-words text-sm text-[var(--theme-muted)]">{track.artist}</p>
                    <p className="mt-2 break-words text-xs uppercase tracking-[0.16em] text-[var(--theme-muted)]">{track.album}</p>
                    <p className="mt-3 text-sm leading-6 text-[var(--theme-body)]">{track.reason}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
