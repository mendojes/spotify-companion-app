"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

type StageResponse = {
  stage?: "idle" | "tracks" | "artists" | "finalizing" | "completed" | "failed";
  phase?: string;
  error?: string;
};

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
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    async function tick() {
      try {
        console.log("[public-detail-refresh] stage-start", playlistId);
        const response = await fetch(
          `/api/public/playlist-detail-sync?playlistId=${encodeURIComponent(playlistId)}`,
          {
            method: "POST",
            cache: "no-store",
          },
        );

        const payload = (await response.json().catch(() => null)) as StageResponse | null;
        console.log("[public-detail-refresh] stage-response", response.status, payload);

        if (cancelled || !payload) {
          return;
        }

        if (payload.stage === "completed") {
          router.refresh();
          return;
        }

        if (payload.stage === "failed") {
          return;
        }

        timeoutId = setTimeout(() => {
          void tick();
        }, 1200);
      } catch (error) {
        console.error("[public-detail-refresh] stage-failed", error);
      }
    }

    void tick();

    return () => {
      cancelled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [playlistId, router, shouldRefresh]);

  return null;
}
