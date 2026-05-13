"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

type PlaylistDetailSyncProps = {
  playlistId: string;
};

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function PlaylistDetailSync({ playlistId }: PlaylistDetailSyncProps) {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    async function runSyncLoop() {
      for (let attempt = 0; attempt < 10 && !cancelled; attempt += 1) {
        try {
          const response = await fetch(`/api/dashboard/playlists/${playlistId}/detail-sync`, {
            method: "POST",
            cache: "no-store",
          });

          if (!response.ok) {
            break;
          }

          const payload = (await response.json()) as {
            completed?: boolean;
            updated?: boolean;
          };

          if (cancelled) {
            return;
          }

          if (payload.updated) {
            router.refresh();
          }

          if (payload.completed) {
            break;
          }
        } catch {
          break;
        }

        await wait(1500);
      }
    }

    void runSyncLoop();

    return () => {
      cancelled = true;
    };
  }, [playlistId, router]);

  return null;
}
