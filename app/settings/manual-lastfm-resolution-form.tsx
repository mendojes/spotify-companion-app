"use client";

import Image from "next/image";
import { FormEvent, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type ManualLastFmResolutionFormProps = {
  trackName: string;
  artistName: string;
  albumName: string;
  skippedAt?: string;
};

type ResolutionMode = "spotify" | "local";

type SpotifyPreview = {
  trackId: string;
  trackName: string;
  artistName: string;
  artistNames?: string[];
  albumName?: string;
  durationMs?: number;
  imageUrl?: string;
};

type CachedSuggestion = SpotifyPreview & {
  playlistId?: string;
  playlistName?: string;
  score: number;
  titleScore: number;
  artistScore: number;
  albumScore: number;
  romanizedTitleScore: number;
  source: "playlist-cache" | "track-library" | "track-metadata";
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
  skippedAt,
}: ManualLastFmResolutionFormProps) {
  const router = useRouter();
  const [mode, setMode] = useState<ResolutionMode>("spotify");
  const [spotifyLink, setSpotifyLink] = useState("");
  const [localTrackName, setLocalTrackName] = useState(trackName);
  const [localArtistName, setLocalArtistName] = useState(artistName);
  const [localAlbumName, setLocalAlbumName] = useState(albumName);
  const [localImageUrl, setLocalImageUrl] = useState("");
  const [spotifyPreview, setSpotifyPreview] = useState<SpotifyPreview | null>(null);
  const [cachedSuggestions, setCachedSuggestions] = useState<CachedSuggestion[]>([]);
  const [hasLoadedSuggestions, setHasLoadedSuggestions] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [isPending, startTransition] = useTransition();

  async function handleSkipMatching() {
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
          intent: "skip",
          trackName,
          artistName,
          albumName,
        }),
      });

      const rawText = await response.text();
      const payload = parseJsonSafely(rawText);
      if (!response.ok) {
        setError(
          typeof payload?.error === "string"
            ? payload.error
            : `Could not skip this imported track right now. Request failed with status ${response.status}.`,
        );
        return;
      }

      setSuccess(
        typeof payload?.message === "string"
          ? payload.message
          : "Marked this unresolved song group as skipped.",
      );
      startTransition(() => {
        router.refresh();
      });
    } catch {
      setError("Could not skip this imported track right now. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function loadCachedSuggestions() {
    setIsLoadingSuggestions(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch("/api/settings/lastfm-unresolved", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          intent: "suggest",
          trackName,
          artistName,
          albumName,
        }),
      });

      const rawText = await response.text();
      const payload = parseJsonSafely(rawText) as ({ error?: string; suggestions?: CachedSuggestion[] } | null);
      if (!response.ok) {
        setError(typeof payload?.error === "string" ? payload.error : "Could not load cached suggestions right now.");
        return;
      }

      setCachedSuggestions(Array.isArray(payload?.suggestions) ? payload.suggestions : []);
      setHasLoadedSuggestions(true);
    } catch {
      setError("Could not load cached suggestions right now. Please try again.");
    } finally {
      setIsLoadingSuggestions(false);
    }
  }

  useEffect(() => {
    if (mode === "spotify" && !hasLoadedSuggestions && !isLoadingSuggestions) {
      void loadCachedSuggestions();
    }
  }, [mode, hasLoadedSuggestions, isLoadingSuggestions]);

  async function handleUseSuggestedMatch(suggestion: CachedSuggestion) {
    setMode("spotify");
    setSpotifyLink(suggestion.trackId);
    setSpotifyPreview(suggestion);
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
          mode: "spotify",
          trackName,
          artistName,
          albumName,
          spotifyLink: suggestion.trackId,
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

      setSuccess(
        typeof payload?.message === "string"
          ? payload.message
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

  async function handlePreviewSpotifyMatch() {
    const trimmedLink = spotifyLink.trim();
    if (!trimmedLink) {
      setError("Paste a Spotify track link or URI first.");
      return;
    }

    setError(null);
    setSuccess(null);
    setSpotifyPreview(null);
    setIsPreviewing(true);

    try {
      const response = await fetch("/api/settings/lastfm-unresolved", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          intent: "preview",
          mode: "spotify",
          trackName,
          artistName,
          albumName,
          spotifyLink: trimmedLink,
        }),
      });

      const rawText = await response.text();
      const payload = parseJsonSafely(rawText) as ({ error?: string; message?: string; preview?: SpotifyPreview } | null);

      if (!response.ok || !payload?.preview) {
        setError(
          typeof payload?.error === "string"
            ? payload.error
            : `Could not preview this Spotify track right now. Request failed with status ${response.status}.`,
        );
        return;
      }

      setSpotifyPreview(payload.preview);
      setSuccess(typeof payload?.message === "string" ? payload.message : "Preview loaded. Confirm to save this Spotify match.");
    } catch {
      setError("Could not preview this Spotify track right now. Please try again.");
    } finally {
      setIsPreviewing(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (mode === "spotify" && !spotifyLink.trim()) {
      setError("Paste a Spotify track link or URI first.");
      return;
    }
    if (mode === "spotify" && !spotifyPreview) {
      setError("Preview this Spotify match first so you can confirm it is the correct song.");
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
      setSpotifyPreview(null);
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

  const disabled = isSubmitting || isPending || isPreviewing;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => {
            setMode("spotify");
            setError(null);
            setSuccess(null);
            setSpotifyPreview(null);
            if (!hasLoadedSuggestions && cachedSuggestions.length === 0) {
              void loadCachedSuggestions();
            }
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
            setSpotifyPreview(null);
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
        <div className="space-y-4">
          <div className="rounded-[20px] border-[2px] border-[rgba(44,12,70,0.18)] bg-white/[0.36] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--theme-body)]">Best cached matches</p>
                <p className="mt-1 text-sm text-[var(--theme-muted)]">These come from the same cache-only resolver sources: playlist cache, permanent track library, and stored track metadata.</p>
              </div>
              <button
                type="button"
                onClick={() => void loadCachedSuggestions()}
                disabled={isLoadingSuggestions || isSubmitting || isPending}
                className="rounded-full border border-[rgba(44,12,70,0.28)] bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--theme-title)] transition hover:border-[rgba(44,12,70,0.55)] disabled:opacity-60"
              >
                {isLoadingSuggestions ? "Loading..." : hasLoadedSuggestions ? "Refresh cached suggestions" : "Load cached suggestions"}
              </button>
            </div>
            {cachedSuggestions.length > 0 ? (
              <div className="mt-3 grid gap-3">
                {cachedSuggestions.map((suggestion) => (
                  <div key={suggestion.trackId} className="rounded-[18px] border border-[rgba(44,12,70,0.18)] bg-white/80 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex min-w-0 gap-3">
                        {suggestion.imageUrl ? (
                          <Image
                            src={suggestion.imageUrl}
                            alt={`${suggestion.trackName} cover art`}
                            width={72}
                            height={72}
                            className="h-[72px] w-[72px] shrink-0 rounded-[14px] border border-[rgba(44,12,70,0.18)] object-cover"
                          />
                        ) : null}
                        <div className="min-w-0 space-y-1">
                          <p className="font-display text-lg uppercase tracking-[0.08em] text-[var(--theme-title)]">{suggestion.trackName}</p>
                          <p className="text-sm text-[var(--theme-body)]">{suggestion.artistName}</p>
                          <p className="text-sm text-[var(--theme-muted)]">{suggestion.albumName || "Unknown album"}</p>
                          <p className="text-xs uppercase tracking-[0.14em] text-[var(--theme-muted)]">
                            {suggestion.source === "playlist-cache" ? "Playlist cache" : suggestion.source === "track-library" ? "Track library" : "Track metadata"} | match {Math.round(suggestion.score * 100)}%
                          </p>
                          {suggestion.source === "playlist-cache" && suggestion.playlistName ? (
                            <p className="text-xs uppercase tracking-[0.14em] text-[var(--theme-muted)]">
                              From playlist: {suggestion.playlistName}
                            </p>
                          ) : null}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleUseSuggestedMatch(suggestion)}
                        disabled={isSubmitting || isPending}
                        className="rounded-full border-[3px] border-[rgba(44,12,70,0.85)] bg-[rgba(255,236,245,0.9)] px-4 py-2 font-mono text-xs uppercase tracking-[0.16em] text-[var(--theme-text)] transition enabled:hover:bg-[rgba(255,225,239,0.96)] disabled:opacity-50"
                      >
                        {isSubmitting || isPending ? "Saving..." : "Use this match"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : !isLoadingSuggestions && hasLoadedSuggestions ? (
              <p className="mt-3 text-sm text-[var(--theme-muted)]">No cached suggestions matched this unresolved song group.</p>
            ) : !isLoadingSuggestions ? (
              <p className="mt-3 text-sm text-[var(--theme-muted)]">Cached suggestions have not loaded yet.</p>
            ) : null}
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void handleSkipMatching()}
                disabled={isSubmitting || isPending}
                className="rounded-full border border-[rgba(44,12,70,0.28)] bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--theme-title)] transition hover:border-[rgba(44,12,70,0.55)] disabled:opacity-60"
              >
                {isSubmitting || isPending ? "Saving..." : "Skip this group for cache-only matching"}
              </button>
              <p className="text-sm text-[var(--theme-muted)]">
                {skippedAt
                  ? `Already skipped on ${new Date(skippedAt).toLocaleString()}.`
                  : "Use this when none of the cached suggestions are the right song."}
              </p>
            </div>
          </div>

          <label className="block">
            <span className="mb-2 block font-mono text-xs uppercase tracking-[0.18em] text-[var(--theme-body)]">Spotify track link</span>
            <input
              type="text"
              value={spotifyLink}
              onChange={(event) => {
                setSpotifyLink(event.target.value);
                setSpotifyPreview(null);
                setError(null);
                setSuccess(null);
              }}
              placeholder="https://open.spotify.com/track/..."
              className="w-full rounded-[20px] border-[2px] border-[rgba(44,12,70,0.28)] bg-white/[0.72] px-4 py-3 text-sm text-[var(--theme-text)]"
            />
          </label>
        </div>
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

      {mode === "spotify" && spotifyPreview ? (
        <div className="rounded-[20px] border-[2px] border-[rgba(44,12,70,0.18)] bg-white/[0.46] p-4">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--theme-body)]">Confirm Spotify match</p>
          <div className="mt-3 flex gap-4">
            {spotifyPreview.imageUrl ? (
              <Image
                src={spotifyPreview.imageUrl}
                alt={`${spotifyPreview.trackName} cover art`}
                width={80}
                height={80}
                className="h-20 w-20 rounded-[16px] border border-[rgba(44,12,70,0.18)] object-cover"
              />
            ) : null}
            <div className="space-y-1">
              <p className="font-display text-lg uppercase tracking-[0.08em] text-[var(--theme-title)]">{spotifyPreview.trackName}</p>
              <p className="text-sm text-[var(--theme-body)]">{spotifyPreview.artistName}</p>
              <p className="text-sm text-[var(--theme-muted)]">{spotifyPreview.albumName || "Unknown album"}</p>
              <p className="text-xs uppercase tracking-[0.14em] text-[var(--theme-muted)]">Spotify track id: {spotifyPreview.trackId}</p>
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        {mode === "spotify" ? (
          <>
            <button
              type="button"
              onClick={() => void handlePreviewSpotifyMatch()}
              disabled={disabled}
              className="rounded-full border-[3px] border-[rgba(44,12,70,0.5)] bg-white/[0.72] px-5 py-3 font-mono text-xs uppercase tracking-[0.16em] text-[var(--theme-text)] transition enabled:hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPreviewing ? "Previewing..." : "Preview Spotify match"}
            </button>
            <button
              type="submit"
              disabled={disabled || !spotifyPreview}
              className="rounded-full border-[3px] border-[rgba(44,12,70,0.85)] bg-[rgba(255,236,245,0.9)] px-5 py-3 font-mono text-xs uppercase tracking-[0.16em] text-[var(--theme-text)] transition enabled:hover:bg-[rgba(255,225,239,0.96)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting || isPending ? "Saving..." : "Confirm and save Spotify match"}
            </button>
          </>
        ) : (
          <button
            type="submit"
            disabled={disabled}
            className="rounded-full border-[3px] border-[rgba(44,12,70,0.85)] bg-[rgba(255,236,245,0.9)] px-5 py-3 font-mono text-xs uppercase tracking-[0.16em] text-[var(--theme-text)] transition enabled:hover:bg-[rgba(255,225,239,0.96)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {disabled ? "Saving..." : "Create local match"}
          </button>
        )}
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
