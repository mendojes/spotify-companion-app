"use client";

import { useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";

type PublicPlaylistBackgroundWorkerProps = {
  playlistIds: string[];
};

type WorkerResponse = {
  ok?: boolean;
  partial?: boolean;
  playlistId?: string;
  reason?: string;
  error?: string;
};

export function PublicPlaylistBackgroundWorker({
  playlistIds,
}: PublicPlaylistBackgroundWorkerProps) {
  const router = useRouter();
  const queue = useMemo(
    () => [...new Set(playlistIds.filter(Boolean))],
    [playlistIds],
  );
  const runningRef = useRef(false);

  useEffect(() => {
    if (queue.length === 0 || runningRef.current) {
      return;
    }

    let cancelled = false;
    runningRef.current = true;

    async function sleep(ms: number) {
      await new Promise((resolve) => setTimeout(resolve, ms));
    }

    async function run() {
      for (const playlistId of queue) {
        if (cancelled) {
          break;
        }

        try {
          const response = await fetch(
            `/api/public/playlist-detail-sync?playlistId=${encodeURIComponent(playlistId)}`,
            {
              method: "POST",
              cache: "no-store",
            },
          );

          const payload = (await response.json().catch(() => null)) as WorkerResponse | null;
          console.log("[public-playlist-worker]", playlistId, response.status, payload);

          if (payload?.ok) {
            router.refresh();
          }

          await sleep(1500);
        } catch (error) {
          console.error("[public-playlist-worker] failed", playlistId, error);
          await sleep(2000);
        }
      }

      runningRef.current = false;
    }

    void run();

    return () => {
      cancelled = true;
      runningRef.current = false;
    };
  }, [queue, router]);

  return null;
}