"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type DashboardDeepRefreshMonitorProps = {
  range: "week" | "month" | "all";
  shouldStart: boolean;
};

type EnrichmentStatus = "idle" | "pending" | "running" | "success" | "error";

export function DashboardDeepRefreshMonitor({ range, shouldStart }: DashboardDeepRefreshMonitorProps) {
  const router = useRouter();
  const [status, setStatus] = useState<EnrichmentStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [artistBackfillRunning, setArtistBackfillRunning] = useState(false);
  const startedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    async function readStatus() {
      try {
        const response = await fetch("/api/dashboard/enrich/status", {
          method: "GET",
          credentials: "same-origin",
          cache: "no-store",
        });

        if (!response.ok) {
          return;
        }

        const data = await response.json() as { status?: EnrichmentStatus; error?: string | null };
        if (cancelled) {
          return;
        }

        const nextStatus = data.status ?? "idle";
        setStatus(nextStatus);
        setError(data.error ?? null);

        const shouldKickoff = shouldStart && !startedRef.current && (nextStatus === "pending" || nextStatus === "idle");

        if (shouldKickoff) {
          startedRef.current = true;
          setStatus("running");
          void fetch(`/api/dashboard/enrich?range=${range}`, {
            method: "POST",
            credentials: "same-origin",
          })
            .then(async (response) => {
              if (!response.ok) {
                return;
              }

              const payload = await response.json() as { needsArtistMetadataBackfill?: boolean };
              if (!payload.needsArtistMetadataBackfill) {
                return;
              }

              setArtistBackfillRunning(true);
              try {
                await fetch("/api/dashboard/artist-metadata/backfill", {
                  method: "POST",
                  credentials: "same-origin",
                });
              } finally {
                setArtistBackfillRunning(false);
                router.refresh();
              }
            })
            .catch(() => undefined);
        }

        if (nextStatus === "pending" || nextStatus === "running" || shouldKickoff) {
          timer = window.setTimeout(readStatus, 2500);
          return;
        }

        if (nextStatus === "success") {
          router.refresh();
        }
      } catch {
        timer = window.setTimeout(readStatus, 4000);
      }
    }

    void readStatus();

    return () => {
      cancelled = true;
      if (timer) {
        window.clearTimeout(timer);
      }
    };
  }, [range, router, shouldStart]);

  if (status !== "pending" && status !== "running" && status !== "error" && !artistBackfillRunning) {
    return null;
  }

  return (
    <div
      className={`mx-auto max-w-7xl rounded-[24px] border-[3px] px-5 py-4 text-sm shadow-glow ${
        status === "error"
          ? "border-[rgba(44,12,70,0.9)] bg-[rgba(255,236,245,0.82)] text-[#3a1a58]"
          : "border-[rgba(44,12,70,0.9)] bg-[rgba(229,255,255,0.78)] text-[#3a1a58]"
      }`}
    >
      {status === "error"
        ? `Deep dashboard refresh failed, so the page is still using the latest stored cache. ${error ?? ""}`.trim()
        : artistBackfillRunning
          ? "Deep dashboard refresh finished its cache rebuild and is now filling missing artist metadata. The page will update automatically when that finishes."
          : "Deep dashboard refresh is running in the background. The page will update automatically when the richer cache is ready."}
    </div>
  );
}
