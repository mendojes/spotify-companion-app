"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

export function PublicPlaylistBackgroundWorker({
  playlistIds,
}: {
  playlistIds: string[];
}) {
  const router = useRouter();
  const running = useRef(false);

  useEffect(() => {
    if (running.current) return;
    running.current = true;

    let cancelled = false;

    async function sleep(ms: number) {
      return new Promise((r) => setTimeout(r, ms));
    }

    async function run() {
      for (const id of playlistIds) {
        if (cancelled) break;

        try {
          await fetch(`/api/public/playlist-detail-sync?playlistId=${id}`, {
            method: "POST",
            cache: "no-store",
          });
        } catch {}

        await sleep(2000);
      }

      running.current = false;
      if (!cancelled) router.refresh();
    }

    run();

    return () => {
      cancelled = true;
      running.current = false;
    };
  }, [playlistIds, router]);

  return null;
}