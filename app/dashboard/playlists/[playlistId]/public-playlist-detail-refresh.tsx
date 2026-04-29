"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

type PublicPlaylistDetailRefreshProps = {
  playlistId: string;
  shouldRefresh: boolean;
};

export function PublicPlaylistDetailRefresh({
  playlistId,
  shouldRefresh,
}: PublicPlaylistDetailRefreshProps) {
  const router = useRouter();

  useEffect(() => {
    if (!shouldRefresh) {
      return;
    }

    console.log("[public-detail-refresh] starting", playlistId);

    let cancelled = false;

    async function run() {
      try {
        const response = await fetch(
          `/api/public/playlist-detail-sync?playlistId=${encodeURIComponent(playlistId)}`,
          {
            method: "POST",
            cache: "no-store",
          },
        );

        const payload = await response.json().catch(() => null);

        console.log("[public-detail-refresh] response", response.status, payload);

        if (cancelled) {
          return;
        }

        if (payload?.ok) {
          router.refresh();
        }
      } catch (err) {
        console.error("[public-detail-refresh] failed", err);
      }
    }

    void run();

    return () => {
      cancelled = true;
    };
  }, [playlistId, router, shouldRefresh]);

  return null;
}