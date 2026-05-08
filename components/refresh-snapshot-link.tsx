"use client";

import { useEffect, useState } from "react";
import { RefreshCcw, Wand2 } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type RefreshSnapshotLinkProps = {
  href: string;
};

const BACKFILL_ONLY_STARTED_EVENT = "soundscope:dashboard-backfill-only-started";

export function RefreshSnapshotLink({ href }: RefreshSnapshotLinkProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isRunningBackfill, setIsRunningBackfill] = useState(false);
  const search = searchParams.toString();

  useEffect(() => {
    if (!isRefreshing) {
      return;
    }

    if (pathname !== "/dashboard") {
      return;
    }

    if (searchParams.get("refreshed") === "1" || searchParams.get("refresh_error") === "1") {
      setIsRefreshing(false);
    }
  }, [isRefreshing, pathname, search, searchParams]);

  async function handleRefresh() {
    if (isRefreshing) {
      return;
    }

    setIsRefreshing(true);

    try {
      const response = await fetch(href, {
        method: "GET",
        credentials: "same-origin",
      });

      router.replace(response.url);
      router.refresh();
    } catch {
      window.location.assign(href);
    }
  }

  async function handleBackfillOnly() {
    if (isRunningBackfill) {
      return;
    }

    setIsRunningBackfill(true);
    window.dispatchEvent(new CustomEvent(BACKFILL_ONLY_STARTED_EVENT));

    try {
      await fetch("/api/dashboard/maintenance", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "normalize-lastfm-imports" }),
      });
      router.refresh();
    } finally {
      setIsRunningBackfill(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={handleBackfillOnly}
        disabled={isRunningBackfill}
        className="pixel-chip inline-flex min-h-11 items-center gap-2 px-3 text-xs text-[var(--theme-text)] transition hover:text-[#2d0d46] disabled:cursor-wait disabled:opacity-80 sm:px-4 sm:text-sm"
      >
        <Wand2 className={`h-4 w-4 ${isRunningBackfill ? "animate-pulse" : ""}`} />
        {isRunningBackfill ? "Normalizing Last.fm" : "Normalize Last.fm"}
      </button>
      <button
        type="button"
        onClick={handleRefresh}
        disabled={isRefreshing}
        className="pixel-chip inline-flex min-h-11 items-center gap-2 px-3 text-xs text-[var(--theme-text)] transition hover:text-[#2d0d46] disabled:cursor-wait disabled:opacity-80 sm:px-4 sm:text-sm"
      >
        <RefreshCcw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
        {isRefreshing ? "Refreshing snapshot" : "Refresh snapshot"}
      </button>
      {isRefreshing || isRunningBackfill ? (
        <p className="text-xs uppercase tracking-[0.16em] text-[var(--theme-muted)] sm:text-sm">
          {isRefreshing ? "Refreshing snapshot..." : "Normalizing Last.fm..."}
        </p>
      ) : null}
    </div>
  );
}
