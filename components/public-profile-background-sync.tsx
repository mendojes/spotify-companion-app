"use client";

import { useEffect } from "react";

type PublicProfileBackgroundSyncProps = {
  spotifyUserId: string;
};

const SYNC_THROTTLE_MS = 1000 * 60;

export function PublicProfileBackgroundSync({ spotifyUserId }: PublicProfileBackgroundSyncProps) {
  useEffect(() => {
    if (!spotifyUserId) {
      return;
    }

    const storageKey = `public-profile-sync:${spotifyUserId}`;
    const lastRunAtRaw = window.sessionStorage.getItem(storageKey);
    const lastRunAt = lastRunAtRaw ? Number(lastRunAtRaw) : 0;

    if (Number.isFinite(lastRunAt) && Date.now() - lastRunAt < SYNC_THROTTLE_MS) {
      return;
    }

    window.sessionStorage.setItem(storageKey, String(Date.now()));

    void fetch("/api/public/profile-sync", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ trigger: "public-dashboard" }),
    }).catch(() => undefined);
  }, [spotifyUserId]);

  return null;
}
