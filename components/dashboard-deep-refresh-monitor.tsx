"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type DashboardDeepRefreshMonitorProps = {
  range: "week" | "month" | "all";
  shouldStart: boolean;
};

type EnrichmentStatus = "idle" | "pending" | "running" | "success" | "error";
type ArtistBackfillStatus = "idle" | "pending" | "running" | "success" | "error";

export function DashboardDeepRefreshMonitor({ range, shouldStart }: DashboardDeepRefreshMonitorProps) {
  const router = useRouter();
  const [status, setStatus] = useState<EnrichmentStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [artistBackfillRunning, setArtistBackfillRunning] = useState(false);
  const [artistBackfillStatus, setArtistBackfillStatus] = useState<ArtistBackfillStatus>("idle");
  const [artistBackfillError, setArtistBackfillError] = useState<string | null>(null);
  const [artistBackfillCount, setArtistBackfillCount] = useState<number | null>(null);
  const enrichStartedRef = useRef(false);
  const artistBackfillStartedRef = useRef(false);

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

        const data = await response.json() as {
          status?: EnrichmentStatus;
          error?: string | null;
          artistBackfillStatus?: ArtistBackfillStatus;
          artistBackfillError?: string | null;
          artistBackfillCount?: number | null;
        };
        if (cancelled) {
          return;
        }

        const nextStatus = data.status ?? "idle";
        setStatus(nextStatus);
        setError(data.error ?? null);
        setArtistBackfillStatus(data.artistBackfillStatus ?? "idle");
        setArtistBackfillError(data.artistBackfillError ?? null);
        setArtistBackfillCount(typeof data.artistBackfillCount === "number" ? data.artistBackfillCount : null);

        const shouldKickoffEnrich =
          !enrichStartedRef.current &&
          (
            nextStatus === "pending" ||
            (shouldStart && nextStatus === "idle")
          );
        const shouldKickoffArtistBackfill =
          !artistBackfillStartedRef.current &&
          (
            (data.artistBackfillStatus ?? "idle") === "pending" ||
            (shouldStart && (data.artistBackfillStatus ?? "idle") === "idle")
          );

        if (shouldKickoffEnrich) {
          enrichStartedRef.current = true;
          setStatus("running");
          void fetch(`/api/dashboard/enrich?range=${range}`, {
            method: "POST",
            credentials: "same-origin",
          })
            .then(() => undefined)
            .catch(() => undefined);
        }

        if (shouldKickoffArtistBackfill) {
          artistBackfillStartedRef.current = true;
          setArtistBackfillRunning(true);
          void fetch("/api/dashboard/artist-metadata/backfill", {
            method: "POST",
            credentials: "same-origin",
          })
            .then(() => undefined)
            .catch(() => undefined)
            .finally(() => {
              setArtistBackfillRunning(false);
              router.refresh();
            });
        }

        if (
          nextStatus === "pending" ||
          nextStatus === "running" ||
          data.artistBackfillStatus === "pending" ||
          data.artistBackfillStatus === "running" ||
          shouldKickoffEnrich ||
          shouldKickoffArtistBackfill
        ) {
          timer = window.setTimeout(readStatus, 2500);
          return;
        }

        if (nextStatus === "success" || data.artistBackfillStatus === "success") {
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

  if (
    status !== "pending" &&
    status !== "running" &&
    status !== "error" &&
    artistBackfillStatus !== "pending" &&
    artistBackfillStatus !== "running" &&
    artistBackfillStatus !== "error" &&
    !artistBackfillRunning
  ) {
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
          : artistBackfillStatus === "error"
          ? `Artist metadata backfill finished with an error, so some artist images or genres may still be missing. ${artistBackfillError ?? ""}`.trim()
          : artistBackfillRunning || artistBackfillStatus === "running"
            ? "Deep dashboard refresh finished its cache rebuild and is now filling missing artist metadata. The page will update automatically when that finishes."
            : artistBackfillStatus === "pending"
              ? "Deep dashboard refresh finished its cache rebuild. Missing artist metadata is queued and should start shortly when the follow-up job begins."
            : artistBackfillStatus === "success"
              ? `Artist metadata backfill finished${artistBackfillCount !== null ? ` for ${artistBackfillCount} artists` : ""}. If images are still blank, the current cached sources did not contain recoverable artist artwork.`
          : "Deep dashboard refresh is running in the background. The page will update automatically when the richer cache is ready."}
    </div>
  );
}
