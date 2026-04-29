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
  done?: boolean;
  reason?: string;
  error?: string;
};

const STORAGE_KEY = "public-playlist-worker-completed";

function readCompletedIds() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return new Set<string>();
    }

    return new Set<string>(JSON.parse(raw) as string[]);
  } catch {
    return new Set<string>();
  }
}

function writeCompletedIds(ids: Set<string>) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // ignore
  }
}

export function PublicPlaylistBackgroundWorker({
  playlistIds,
}: PublicPlaylistBackgroundWorkerProps) {
  const router = useRouter();
  const runningRef = useRef(false);

  const queue = useMemo(
    () => [...new Set(playlistIds.filter(Boolean))],
    [playlistIds],
  );

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
      const completedIds = readCompletedIds();
      let didCompleteAny = false;

      for (const playlistId of queue) {
        if (cancelled) {
          break;
        }

        if (completedIds.has(playlistId)) {
          continue;
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

          if (payload?.done) {
            completedIds.add(playlistId);
            writeCompletedIds(completedIds);
            didCompleteAny = true;
          }

          await sleep(1500);
        } catch (error) {
          console.error("[public-playlist-worker] failed", playlistId, error);
          await sleep(2000);
        }
      }

      runningRef.current = false;

      if (!cancelled && didCompleteAny) {
        router.refresh();
      }
    }

    void run();

    return () => {
      cancelled = true;
      runningRef.current = false;
    };
  }, [queue, router]);

  return null;
}