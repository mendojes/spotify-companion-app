"use client";

import { useState } from "react";
import { RefreshCcw } from "lucide-react";
import { useRouter } from "next/navigation";

type RefreshSnapshotLinkProps = {
  href: string;
};

export function RefreshSnapshotLink({ href }: RefreshSnapshotLinkProps) {
  const router = useRouter();
  const [isRefreshing, setIsRefreshing] = useState(false);

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

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={handleRefresh}
        disabled={isRefreshing}
        className="pixel-chip inline-flex min-h-11 items-center gap-2 px-3 text-xs text-[var(--theme-text)] transition hover:text-[#2d0d46] disabled:cursor-wait disabled:opacity-80 sm:px-4 sm:text-sm"
      >
        <RefreshCcw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
        {isRefreshing ? "Refreshing snapshot" : "Refresh snapshot"}
      </button>
      {isRefreshing ? (
        <p className="text-xs uppercase tracking-[0.16em] text-[var(--theme-muted)] sm:text-sm">
          Refreshing snapshot...
        </p>
      ) : null}
    </div>
  );
}
