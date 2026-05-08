"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type DashboardDeepRefreshMonitorProps = {
  range: "week" | "month" | "all";
  shouldStart: boolean;
};

type EnrichmentStatus = "idle" | "pending" | "running" | "paused" | "success" | "error";
type ArtistBackfillStatus = "idle" | "pending" | "running" | "paused" | "success" | "error";
const BACKFILL_ONLY_STARTED_EVENT = "soundscope:dashboard-backfill-only-started";
const DASHBOARD_JOB_STARTED_EVENT = "soundscope:dashboard-job-started";

function formatStatusTimestamp(value?: string | null) {
  if (!value) {
    return "not recorded";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(value));
}

const AUTO_START_SUPPRESS_KEY = "dashboard-refresh-auto-start-suppressed-until";

function isAutoStartSuppressed() {
  if (typeof window === "undefined") {
    return false;
  }

  const rawValue = window.sessionStorage.getItem(AUTO_START_SUPPRESS_KEY);
  if (!rawValue) {
    return false;
  }

  const until = Number(rawValue);
  if (!Number.isFinite(until) || until <= Date.now()) {
    window.sessionStorage.removeItem(AUTO_START_SUPPRESS_KEY);
    return false;
  }

  return true;
}

function suppressAutoStartForMs(durationMs: number) {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.setItem(AUTO_START_SUPPRESS_KEY, String(Date.now() + durationMs));
}

export function DashboardDeepRefreshMonitor({ range, shouldStart }: DashboardDeepRefreshMonitorProps) {
  const router = useRouter();
  const [status, setStatus] = useState<EnrichmentStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [finishedAt, setFinishedAt] = useState<string | null>(null);
  const [artistBackfillRunning, setArtistBackfillRunning] = useState(false);
  const [artistBackfillStatus, setArtistBackfillStatus] = useState<ArtistBackfillStatus>("idle");
  const [artistBackfillError, setArtistBackfillError] = useState<string | null>(null);
  const [artistBackfillCount, setArtistBackfillCount] = useState<number | null>(null);
  const [artistBackfillDetail, setArtistBackfillDetail] = useState<string | null>(null);
  const [artistBackfillStartedAt, setArtistBackfillStartedAt] = useState<string | null>(null);
  const [artistBackfillFinishedAt, setArtistBackfillFinishedAt] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [runningBackfillOnly, setRunningBackfillOnly] = useState(false);
  const enrichStartedRef = useRef(false);
  const artistBackfillStartedRef = useRef(false);

  useEffect(() => {
    if (status === "idle" || status === "success" || status === "error") {
      enrichStartedRef.current = false;
    }
  }, [status]);

  useEffect(() => {
    if (
      artistBackfillStatus === "idle" ||
      artistBackfillStatus === "success" ||
      artistBackfillStatus === "error" ||
      artistBackfillStatus === "paused"
    ) {
      artistBackfillStartedRef.current = false;
      setArtistBackfillRunning(false);
    }
  }, [artistBackfillStatus]);

  useEffect(() => {
    function handleBackfillOnlyStarted() {
      setArtistBackfillRunning(true);
      setRunningBackfillOnly(true);
      setArtistBackfillStatus((currentStatus) => (currentStatus === "idle" ? "running" : currentStatus));
      setArtistBackfillDetail((currentDetail) => currentDetail ?? "Starting imported-track normalization and metadata backfill");
    }

    function handleDashboardJobStarted(event: Event) {
      const customEvent = event as CustomEvent<{ lane?: "dashboard" | "backfill"; detail?: string }>;
      if (customEvent.detail?.lane === "backfill") {
        setArtistBackfillRunning(true);
        setArtistBackfillStatus("running");
        setArtistBackfillDetail(customEvent.detail.detail ?? "Starting dashboard backfill job");
        return;
      }

      setStatus("running");
      setDetail(customEvent.detail?.detail ?? "Starting dashboard maintenance job");
    }

    window.addEventListener(BACKFILL_ONLY_STARTED_EVENT, handleBackfillOnlyStarted);
    window.addEventListener(DASHBOARD_JOB_STARTED_EVENT, handleDashboardJobStarted as EventListener);
    return () => {
      window.removeEventListener(BACKFILL_ONLY_STARTED_EVENT, handleBackfillOnlyStarted);
      window.removeEventListener(DASHBOARD_JOB_STARTED_EVENT, handleDashboardJobStarted as EventListener);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    let pollCount = 0;

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
          detail?: string | null;
          startedAt?: string | null;
          finishedAt?: string | null;
          artistBackfillStatus?: ArtistBackfillStatus;
          artistBackfillError?: string | null;
          artistBackfillCount?: number | null;
          artistBackfillDetail?: string | null;
          artistBackfillStep?: string | null;
          artistBackfillStartedAt?: string | null;
          artistBackfillFinishedAt?: string | null;
        };
        if (cancelled) {
          return;
        }

        const nextStatus = data.status ?? "idle";
        setStatus(nextStatus);
        setError(data.error ?? null);
        setDetail(data.detail ?? null);
        setStartedAt(data.startedAt ?? null);
        setFinishedAt(data.finishedAt ?? null);
        setArtistBackfillStatus(data.artistBackfillStatus ?? "idle");
        setArtistBackfillError(data.artistBackfillError ?? null);
        setArtistBackfillCount(typeof data.artistBackfillCount === "number" ? data.artistBackfillCount : null);
        setArtistBackfillDetail(data.artistBackfillDetail ?? null);
        setArtistBackfillStartedAt(data.artistBackfillStartedAt ?? null);
        setArtistBackfillFinishedAt(data.artistBackfillFinishedAt ?? null);

        const shouldKickoffEnrich =
          !isAutoStartSuppressed() &&
          !enrichStartedRef.current &&
          (data.artistBackfillStatus ?? "idle") !== "pending" &&
          (data.artistBackfillStatus ?? "idle") !== "paused" &&
          (
            nextStatus === "pending" ||
            (shouldStart && nextStatus === "idle")
          );
        const shouldKickoffArtistBackfill =
          !isAutoStartSuppressed() &&
          !artistBackfillStartedRef.current &&
          (
            (
              nextStatus === "success" &&
              (
              (data.artistBackfillStatus ?? "idle") === "pending" ||
              (data.artistBackfillStatus ?? "idle") === "paused" ||
              (shouldStart && (data.artistBackfillStatus ?? "idle") === "idle")
            )
          ) ||
          (
              ((data.artistBackfillStatus ?? "idle") === "pending" || (data.artistBackfillStatus ?? "idle") === "paused") &&
              typeof data.artistBackfillDetail === "string" &&
              data.artistBackfillDetail.startsWith("Paused ")
            )
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
          nextStatus === "paused" ||
          data.artistBackfillStatus === "pending" ||
          data.artistBackfillStatus === "running" ||
          data.artistBackfillStatus === "paused" ||
          shouldKickoffEnrich ||
          shouldKickoffArtistBackfill
        ) {
          pollCount += 1;
          const hasRunningWork =
            nextStatus === "running" ||
            nextStatus === "paused" ||
            data.artistBackfillStatus === "running" ||
            data.artistBackfillStatus === "paused";
          const delayMs = hasRunningWork
            ? Math.min(15000, 5000 + pollCount * 1000)
            : 5000;
          timer = window.setTimeout(readStatus, delayMs);
          return;
        }

        if (nextStatus === "success" || data.artistBackfillStatus === "success") {
          router.refresh();
        }
      } catch {
        timer = window.setTimeout(readStatus, 8000);
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
    status !== "paused" &&
    status !== "error" &&
    artistBackfillStatus !== "pending" &&
    artistBackfillStatus !== "running" &&
    artistBackfillStatus !== "paused" &&
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
      <p>
        {status === "error"
        ? `Deep dashboard refresh failed, so the page is still using the latest stored cache. ${error ?? ""}`.trim()
          : artistBackfillStatus === "error"
          ? `Artist metadata backfill finished with an error, so some artist images or genres may still be missing. ${artistBackfillError ?? ""}`.trim()
          : artistBackfillRunning || artistBackfillStatus === "running"
            ? status === "success"
              ? "Deep dashboard refresh finished its cache rebuild and is now filling missing artist metadata. The page will update automatically when that finishes."
              : "Imported-track normalization and metadata backfill are running in the background. The page will update automatically as saved progress lands."
            : artistBackfillStatus === "paused"
              ? "Artist metadata backfill paused to avoid a timeout. Refresh again to continue from the saved checkpoint."
            : artistBackfillStatus === "pending"
              ? "Deep dashboard refresh finished its cache rebuild. Missing artist metadata is queued and should start shortly when the follow-up job begins."
            : artistBackfillStatus === "success"
              ? `Artist metadata backfill finished${artistBackfillCount !== null ? ` for ${artistBackfillCount} artists` : ""}. If images are still blank, the current cached sources did not contain recoverable artist artwork.`
          : "Deep dashboard refresh is running in the background. The page will update automatically when the richer cache is ready."}
      </p>
      <div className="mt-3 space-y-1 font-mono text-xs uppercase tracking-[0.08em] text-[#5a2f7f]">
        <p>Dashboard enrich: {status} | detail: {detail ?? "none"} | started: {formatStatusTimestamp(startedAt)} | finished: {formatStatusTimestamp(finishedAt)}</p>
        <p>Artist backfill: {artistBackfillStatus} | detail: {artistBackfillDetail ?? "none"} | started: {formatStatusTimestamp(artistBackfillStartedAt)} | finished: {formatStatusTimestamp(artistBackfillFinishedAt)}</p>
      </div>
      <div className="mt-4 flex flex-wrap justify-end gap-3">
        <button
          type="button"
          disabled={runningBackfillOnly || cancelling}
          onClick={() => {
            setRunningBackfillOnly(true);
            enrichStartedRef.current = false;
            artistBackfillStartedRef.current = false;
            if (typeof window !== "undefined") {
              window.sessionStorage.removeItem(AUTO_START_SUPPRESS_KEY);
            }
            setArtistBackfillRunning(true);
            void fetch("/api/dashboard/artist-metadata/backfill", {
              method: "POST",
              credentials: "same-origin",
            })
              .catch(() => undefined)
              .finally(() => {
                setRunningBackfillOnly(false);
                setArtistBackfillRunning(false);
                router.refresh();
              });
          }}
          className="rounded-full border border-[rgba(57,18,98,0.18)] bg-white/[0.18] px-4 py-2 text-xs uppercase tracking-[0.16em] text-[var(--theme-text)] transition hover:border-gold/25 hover:text-gold disabled:opacity-50"
        >
          {runningBackfillOnly ? "Running Backfill..." : "Run Backfill Only"}
        </button>
        <button
          type="button"
          disabled={cancelling || runningBackfillOnly}
          onClick={() => {
            setCancelling(true);
            enrichStartedRef.current = false;
            artistBackfillStartedRef.current = false;
            setArtistBackfillRunning(false);
            suppressAutoStartForMs(60_000);
            void fetch("/api/dashboard/refresh/cancel", {
              method: "POST",
              credentials: "same-origin",
            })
              .catch(() => undefined)
              .finally(() => {
                setCancelling(false);
                router.refresh();
              });
          }}
          className="rounded-full border border-[rgba(57,18,98,0.18)] bg-white/[0.18] px-4 py-2 text-xs uppercase tracking-[0.16em] text-[var(--theme-text)] transition hover:border-gold/25 hover:text-gold disabled:opacity-50"
        >
          {cancelling ? "Cancelling..." : "Cancel Refresh Progress"}
        </button>
      </div>
    </div>
  );
}
