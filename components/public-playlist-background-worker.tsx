"use client";

import { useEffect, useMemo, useRef } from "react";

export function PublicPlaylistBackgroundWorker({
  playlistIds,
}: {
  playlistIds: string[];
}) {
  const startedRef = useRef(false);

  const stablePlaylistIds = useMemo(
    () => [...new Set(playlistIds.filter(Boolean))].sort(),
    [playlistIds],
  );

  useEffect(() => {
    if (startedRef.current) {
      return;
    }

    if (stablePlaylistIds.length === 0) {
      return;
    }

    startedRef.current = true;
    let cancelled = false;

    async function sleep(ms: number) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    async function run() {
      for (const playlistId of stablePlaylistIds) {
        if (cancelled) {
          return;
        }

        try {
          await fetch(`/api/public/playlist-detail-sync?playlistId=${encodeURIComponent(playlistId)}`, {
            method: "POST",
            cache: "no-store",
          });
        } catch (error) {
          console.error("[public-playlist-worker] failed", playlistId, error);
        }

        await sleep(2000);
      }
    }

    void run();

    return () => {
      cancelled = true;
    };
  }, [stablePlaylistIds]);

  return null;
}