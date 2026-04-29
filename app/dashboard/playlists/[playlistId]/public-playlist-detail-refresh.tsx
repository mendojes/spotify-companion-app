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

        if (!response.ok || cancelled) {
          return;
        }

        router.refresh();
      } catch {
        // keep stored fallback visible
      }
    }

    void run();

    return () => {
      cancelled = true;
    };
  }, [playlistId, router, shouldRefresh]);

  return null;
}