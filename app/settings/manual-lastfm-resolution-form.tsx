"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type ManualLastFmResolutionFormProps = {
  trackName: string;
  artistName: string;
  albumName: string;
};

function parseJsonSafely(rawText: string) {
  if (!rawText) {
    return null;
  }

  try {
    return JSON.parse(rawText) as { error?: string; message?: string };
  } catch {
    return null;
  }
}

export function ManualLastFmResolutionForm({
  trackName,
  artistName,
  albumName,
}: ManualLastFmResolutionFormProps) {
  const router = useRouter();
  const [spotifyLink, setSpotifyLink] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPending, startTransition] = useTransition();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedLink = spotifyLink.trim();
    if (!trimmedLink) {
      setError("Paste a Spotify track link or URI first.");
      return;
    }

    setError(null);
    setSuccess(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/settings/lastfm-unresolved", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          trackName,
          artistName,
          albumName,
          spotifyLink: trimmedLink,
        }),
      });

      const rawText = await response.text();
      const payload = parseJsonSafely(rawText);

      if (!response.ok) {
        setError(
          typeof payload?.error === "string"
            ? payload.error
            : `Could not resolve this imported track right now. Request failed with status ${response.status}.`,
        );
        return;
      }

      setSpotifyLink("");
      setSuccess(typeof payload?.message === "string" ? payload.message : "Resolved imported Last.fm plays.");
      startTransition(() => {
        router.refresh();
      });
    } catch {
      setError("Could not resolve this imported track right now. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <label className="block">
        <span className="mb-2 block font-mono text-xs uppercase tracking-[0.18em] text-[var(--theme-body)]">Spotify track link</span>
        <input
          type="text"
          value={spotifyLink}
          onChange={(event) => {
            setSpotifyLink(event.target.value);
            setError(null);
            setSuccess(null);
          }}
          placeholder="https://open.spotify.com/track/..."
          className="w-full rounded-[20px] border-[2px] border-[rgba(44,12,70,0.28)] bg-white/[0.72] px-4 py-3 text-sm text-[var(--theme-text)]"
        />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={isSubmitting || isPending}
          className="rounded-full border-[3px] border-[rgba(44,12,70,0.85)] bg-[rgba(255,236,245,0.9)] px-5 py-3 font-mono text-xs uppercase tracking-[0.16em] text-[var(--theme-text)] transition enabled:hover:bg-[rgba(255,225,239,0.96)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSubmitting || isPending ? "Saving..." : "Save Spotify match"}
        </button>
      </div>

      {error ? (
        <div className="rounded-[20px] border-[2px] border-[rgba(140,26,26,0.3)] bg-[rgba(255,120,120,0.12)] px-4 py-3 text-sm text-[var(--theme-text)]">
          {error}
        </div>
      ) : null}

      {success ? (
        <div className="rounded-[20px] border-[2px] border-[rgba(44,12,70,0.18)] bg-white/[0.36] px-4 py-3 text-sm text-[var(--theme-body)]">
          {success}
        </div>
      ) : null}
    </form>
  );
}
