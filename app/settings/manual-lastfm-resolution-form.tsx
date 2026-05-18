"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type ManualLastFmResolutionFormProps = {
  trackName: string;
  artistName: string;
  albumName: string;
};

type ResolutionMode = "spotify" | "local";

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
  const [mode, setMode] = useState<ResolutionMode>("spotify");
  const [spotifyLink, setSpotifyLink] = useState("");
  const [localTrackName, setLocalTrackName] = useState(trackName);
  const [localArtistName, setLocalArtistName] = useState(artistName);
  const [localAlbumName, setLocalAlbumName] = useState(albumName);
  const [localImageUrl, setLocalImageUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPending, startTransition] = useTransition();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (mode === "spotify" && !spotifyLink.trim()) {
      setError("Paste a Spotify track link or URI first.");
      return;
    }
    if (mode === "local" && (!localTrackName.trim() || !localArtistName.trim())) {
      setError("Track name and artist name are required for a local song.");
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
          mode,
          trackName,
          artistName,
          albumName,
          spotifyLink: spotifyLink.trim(),
          localTrackName: localTrackName.trim(),
          localArtistName: localArtistName.trim(),
          localAlbumName: localAlbumName.trim(),
          localImageUrl: localImageUrl.trim(),
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
      setLocalImageUrl("");
      setSuccess(
        typeof payload?.message === "string"
          ? payload.message
          : mode === "local"
            ? "Created a manual local-song match."
            : "Resolved imported Last.fm plays.",
      );
      startTransition(() => {
        router.refresh();
      });
    } catch {
      setError("Could not resolve this imported track right now. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const disabled = isSubmitting || isPending;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => {
            setMode("spotify");
            setError(null);
            setSuccess(null);
          }}
          className={`rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] transition ${
            mode === "spotify"
              ? "border-[rgba(44,12,70,0.85)] bg-[rgba(255,236,245,0.9)] text-[var(--theme-title)]"
              : "border-[rgba(44,12,70,0.22)] bg-white/70 text-[var(--theme-text)]"
          }`}
        >
          Spotify match
        </button>
        <button
          type="button"
          onClick={() => {
            setMode("local");
            setError(null);
            setSuccess(null);
          }}
          className={`rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] transition ${
            mode === "local"
              ? "border-[rgba(44,12,70,0.85)] bg-[rgba(255,236,245,0.9)] text-[var(--theme-title)]"
              : "border-[rgba(44,12,70,0.22)] bg-white/70 text-[var(--theme-text)]"
          }`}
        >
          Create local song
        </button>
      </div>

      {mode === "spotify" ? (
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
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block md:col-span-2">
            <span className="mb-2 block font-mono text-xs uppercase tracking-[0.18em] text-[var(--theme-body)]">Track name</span>
            <input
              type="text"
              value={localTrackName}
              onChange={(event) => {
                setLocalTrackName(event.target.value);
                setError(null);
                setSuccess(null);
              }}
              className="w-full rounded-[20px] border-[2px] border-[rgba(44,12,70,0.28)] bg-white/[0.72] px-4 py-3 text-sm text-[var(--theme-text)]"
            />
          </label>
          <label className="block">
            <span className="mb-2 block font-mono text-xs uppercase tracking-[0.18em] text-[var(--theme-body)]">Artist name</span>
            <input
              type="text"
              value={localArtistName}
              onChange={(event) => {
                setLocalArtistName(event.target.value);
                setError(null);
                setSuccess(null);
              }}
              className="w-full rounded-[20px] border-[2px] border-[rgba(44,12,70,0.28)] bg-white/[0.72] px-4 py-3 text-sm text-[var(--theme-text)]"
            />
          </label>
          <label className="block">
            <span className="mb-2 block font-mono text-xs uppercase tracking-[0.18em] text-[var(--theme-body)]">Album name</span>
            <input
              type="text"
              value={localAlbumName}
              onChange={(event) => {
                setLocalAlbumName(event.target.value);
                setError(null);
                setSuccess(null);
              }}
              className="w-full rounded-[20px] border-[2px] border-[rgba(44,12,70,0.28)] bg-white/[0.72] px-4 py-3 text-sm text-[var(--theme-text)]"
            />
          </label>
          <label className="block md:col-span-2">
            <span className="mb-2 block font-mono text-xs uppercase tracking-[0.18em] text-[var(--theme-body)]">Image URL (optional)</span>
            <input
              type="text"
              value={localImageUrl}
              onChange={(event) => {
                setLocalImageUrl(event.target.value);
                setError(null);
                setSuccess(null);
              }}
              placeholder="https://..."
              className="w-full rounded-[20px] border-[2px] border-[rgba(44,12,70,0.28)] bg-white/[0.72] px-4 py-3 text-sm text-[var(--theme-text)]"
            />
          </label>
          <p className="md:col-span-2 text-sm text-[var(--theme-muted)]">
            This will overwrite every unresolved imported play in this song group with the fields above and save it as a permanent local track record.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={disabled}
          className="rounded-full border-[3px] border-[rgba(44,12,70,0.85)] bg-[rgba(255,236,245,0.9)] px-5 py-3 font-mono text-xs uppercase tracking-[0.16em] text-[var(--theme-text)] transition enabled:hover:bg-[rgba(255,225,239,0.96)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {disabled ? "Saving..." : mode === "local" ? "Create local match" : "Save Spotify match"}
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
