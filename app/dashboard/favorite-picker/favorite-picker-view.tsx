"use client";

import Image from "next/image";
import { startTransition, useEffect, useMemo, useState } from "react";
import { LibraryBig, Link2, Search, Shuffle, Sparkles, Trophy } from "lucide-react";
import {
  chooseFavoritePickerSong,
  createFavoritePickerState,
  FavoritePickerTargetSummary,
  FavoritePickerTrack,
  getFavoritePickerChoice,
  getFavoritePickerRankedTracks,
  goBackFavoritePickerChoice,
  isFavoritePickerComplete,
  skipFavoritePickerChoice,
  type FavoritePickerState,
} from "@/lib/favorite-picker";

type FavoritePickerViewProps = {
  spotifyConnected: boolean;
  displayName: string;
};

type LoadState = "build" | "pick" | "done";

function TargetArtwork({ imageUrl, label }: { imageUrl?: string; label: string }) {
  if (imageUrl) {
    return (
      <div className="media-frame relative h-16 w-16 shrink-0 p-1.5">
        <Image src={imageUrl} alt={label} fill sizes="64px" className="rounded-[16px] object-cover" />
      </div>
    );
  }

  return (
    <div className="media-frame flex h-16 w-16 shrink-0 items-center justify-center p-1.5 font-mono text-xs uppercase tracking-[0.16em] text-[var(--theme-muted)]">
      art
    </div>
  );
}

function SongCard({
  track,
  buttonLabel,
  onPick,
}: {
  track: FavoritePickerTrack;
  buttonLabel: string;
  onPick: () => void;
}) {
  return (
    <div className="glass-panel flex h-full flex-col rounded-[32px] p-5 text-[var(--theme-text)]">
      <div className="media-frame relative aspect-square p-2">
        {track.imageUrl ? (
          <Image src={track.imageUrl} alt={track.name} fill sizes="(max-width: 1024px) 100vw, 420px" className="rounded-[22px] object-cover" />
        ) : null}
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(72,24,110,0.18)_40%,rgba(72,24,110,0.56))]" />
      </div>

      <div className="mt-5 flex-1 space-y-3">
        <div>
          <p className="section-kicker">Pick your favorite</p>
          <h3 className="mt-2 font-display text-3xl uppercase tracking-[0.08em] text-[var(--theme-title)]">{track.name}</h3>
          <p className="mt-2 text-sm leading-7 text-[var(--theme-body)]">{track.artistLabel}</p>
          <p className="mt-1 font-mono text-xs uppercase tracking-[0.16em] text-[var(--theme-muted)]">{track.albumName}</p>
        </div>

        <div className="desktop-card p-4">
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--theme-muted)]">Included from</p>
          <p className="mt-2 text-sm leading-6 text-[var(--theme-body)]">{track.sourceLabels.slice(0, 3).join(" / ")}</p>
        </div>
      </div>

      <div className="mt-5 flex gap-3">
        <button onClick={onPick} className="neon-outline inline-flex flex-1 items-center justify-center rounded-full px-5 py-3 text-sm font-medium uppercase tracking-[0.18em] text-[#170718]">
          {buttonLabel}
        </button>
        {track.spotifyUrl ? (
          <a
            href={track.spotifyUrl}
            target="_blank"
            rel="noreferrer"
            className="pixel-chip inline-flex items-center justify-center px-4 text-[var(--theme-text)] transition hover:text-[#2d0d46]"
          >
            Listen
          </a>
        ) : null}
      </div>
    </div>
  );
}

function TargetCard({
  target,
  action,
}: {
  target: FavoritePickerTargetSummary;
  action?: React.ReactNode;
}) {
  return (
    <div className="desktop-card flex items-center gap-4 p-4">
      <TargetArtwork imageUrl={target.imageUrl} label={target.name} />
      <div className="min-w-0 flex-1">
        <p className="font-display text-xl uppercase tracking-[0.08em] text-[var(--theme-title)]">{target.name}</p>
        <p className="mt-1 text-sm text-[var(--theme-body)]">{target.subtitle}</p>
        {typeof target.trackCount === "number" ? (
          <p className="mt-1 font-mono text-xs uppercase tracking-[0.16em] text-[var(--theme-muted)]">{target.trackCount} tracks</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

export function FavoritePickerView({ spotifyConnected, displayName }: FavoritePickerViewProps) {
  const [phase, setPhase] = useState<LoadState>("build");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<FavoritePickerTargetSummary[]>([]);
  const [selectedTargets, setSelectedTargets] = useState<FavoritePickerTargetSummary[]>([]);
  const [libraryTargets, setLibraryTargets] = useState<FavoritePickerTargetSummary[]>([]);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [pastedInput, setPastedInput] = useState("");
  const [pickerState, setPickerState] = useState<FavoritePickerState | null>(null);
  const [pickerTracks, setPickerTracks] = useState<FavoritePickerTrack[]>([]);
  const [loadingLibrary, setLoadingLibrary] = useState(false);
  const [loadingPicker, setLoadingPicker] = useState(false);
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!spotifyConnected) {
      return;
    }

    setLoadingLibrary(true);
    fetch("/api/favorite-picker/library", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as { results?: FavoritePickerTargetSummary[]; error?: string };
        if (!response.ok) {
          throw new Error(payload.error ?? "Could not load Spotify playlists.");
        }

        setLibraryTargets(payload.results ?? []);
      })
      .catch((error) => {
        setMessage(error instanceof Error ? error.message : "Could not load your Spotify playlists.");
      })
      .finally(() => {
        setLoadingLibrary(false);
      });
  }, [spotifyConnected]);

  const currentChoice = useMemo(() => (pickerState ? getFavoritePickerChoice(pickerState) : null), [pickerState]);
  const rankedTracks = useMemo(() => (pickerState ? getFavoritePickerRankedTracks(pickerState) : []), [pickerState]);
  const filteredLibraryTargets = useMemo(() => {
    const query = libraryQuery.trim().toLowerCase();

    if (!query) {
      return libraryTargets;
    }

    return libraryTargets.filter((target) => {
      const haystack = `${target.name} ${target.subtitle}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [libraryQuery, libraryTargets]);

  useEffect(() => {
    if (pickerState && isFavoritePickerComplete(pickerState)) {
      setPhase("done");
    }
  }, [pickerState]);

  function appendTarget(target: FavoritePickerTargetSummary) {
    setSelectedTargets((current) => {
      if (current.some((entry) => entry.id === target.id && entry.type === target.type)) {
        return current;
      }

      return [...current, target];
    });
  }

  function removeTarget(target: FavoritePickerTargetSummary) {
    setSelectedTargets((current) => current.filter((entry) => !(entry.id === target.id && entry.type === target.type)));
  }

  function runSearch() {
    if (!searchQuery.trim()) {
      return;
    }

    setSearching(true);
    setMessage(null);

    startTransition(() => {
      fetch(`/api/favorite-picker/search?q=${encodeURIComponent(searchQuery.trim())}`, { cache: "no-store" })
        .then(async (response) => {
          const payload = await response.json() as { results?: FavoritePickerTargetSummary[]; error?: string };
          if (!response.ok) {
            throw new Error(payload.error ?? "Could not search Spotify.");
          }

          setSearchResults(payload.results ?? []);
        })
        .catch((error) => {
          setMessage(error instanceof Error ? error.message : "Could not search Spotify.");
        })
        .finally(() => {
          setSearching(false);
        });
    });
  }

  function addPastedTarget() {
    if (!pastedInput.trim()) {
      return;
    }

    setMessage(null);

    fetch("/api/favorite-picker/targets", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ inputs: [pastedInput.trim()] }),
    })
      .then(async (response) => {
        const payload = await response.json() as { targets?: FavoritePickerTargetSummary[]; error?: string };
        if (!response.ok) {
          throw new Error(payload.error ?? "Could not load that Spotify link.");
        }

        const target = payload.targets?.[0];
        if (!target) {
          throw new Error("That link was not a Spotify artist, album, or playlist.");
        }

        appendTarget(target);
        setPastedInput("");
      })
      .catch((error) => {
        setMessage(error instanceof Error ? error.message : "Could not load that Spotify link.");
      });
  }

  function startPicker() {
    if (selectedTargets.length === 0) {
      setMessage("Add at least one playlist, album, or artist first.");
      return;
    }

    setLoadingPicker(true);
    setMessage(null);

    fetch("/api/favorite-picker/targets", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        targets: selectedTargets.map((target) => ({
          id: target.id,
          type: target.type,
        })),
      }),
    })
      .then(async (response) => {
        const payload = await response.json() as {
          targets?: FavoritePickerTargetSummary[];
          tracks?: FavoritePickerTrack[];
          error?: string;
        };

        if (!response.ok) {
          throw new Error(payload.error ?? "Could not build the favorite picker.");
        }

        const tracks = payload.tracks ?? [];
        if (tracks.length < 2) {
          throw new Error("The selected targets did not produce enough songs to compare.");
        }

        setSelectedTargets(payload.targets ?? selectedTargets);
        setPickerTracks(tracks);
        setPickerState(createFavoritePickerState(tracks));
        setPhase("pick");
      })
      .catch((error) => {
        setMessage(error instanceof Error ? error.message : "Could not build the favorite picker.");
      })
      .finally(() => {
        setLoadingPicker(false);
      });
  }

  function resetPicker() {
    setPhase("build");
    setPickerState(null);
    setPickerTracks([]);
    setMessage(null);
  }

  return (
    <div className="space-y-8">
      <section className="glass-panel rounded-[36px] p-6 text-[var(--theme-text)] md:p-8">
        <p className="section-kicker">Favorite picker</p>
        <h1 className="mt-3 font-display text-4xl uppercase tracking-[0.08em] text-[var(--theme-title)] md:text-5xl">
          Rank songs head-to-head until your favorites shake out.
        </h1>
        <p className="mt-5 max-w-3xl text-base leading-8 text-[var(--theme-body)]">
          {spotifyConnected
            ? `${displayName}, you can mix your own Spotify playlists with public albums, artists, and playlists from search or pasted links.`
            : `${displayName}, you can use public Spotify playlists, albums, and artists from search or pasted links without connecting Spotify.`}
        </p>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <div className="desktop-card p-4">
            <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--theme-muted)]">Multi-source</p>
            <p className="mt-2 text-sm leading-6 text-[var(--theme-body)]">Combine multiple playlists, albums, and artists into one picker session.</p>
          </div>
          <div className="desktop-card p-4">
            <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--theme-muted)]">Tournament logic</p>
            <p className="mt-2 text-sm leading-6 text-[var(--theme-body)]">The ranking works through elimination rounds instead of doing a simple sort.</p>
          </div>
          <div className="desktop-card p-4">
            <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--theme-muted)]">Control the run</p>
            <p className="mt-2 text-sm leading-6 text-[var(--theme-body)]">Skip matchups, go back one choice, and keep ranking until the list is fully ordered.</p>
          </div>
        </div>
      </section>

      {message ? (
        <div className="rounded-[24px] border-[3px] border-[rgba(44,12,70,0.9)] bg-[rgba(255,247,224,0.86)] px-5 py-4 text-sm text-[var(--theme-text)] shadow-glow">
          {message}
        </div>
      ) : null}

      {phase === "build" ? (
        <div className="space-y-6">
          <section className="window-panel rounded-[32px] p-6 pt-14 text-[var(--theme-text)]">
            <div className="max-w-3xl">
              <div className="flex items-center gap-3">
                <Sparkles className="h-5 w-5 text-[var(--theme-accent)]" />
                <div>
                  <p className="section-kicker">Selected targets</p>
                  <h2 className="mt-1 font-display text-3xl uppercase tracking-[0.08em] text-[var(--theme-title)]">Build your song pool</h2>
                </div>
              </div>

              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <div className="desktop-card p-4">
                  <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--theme-muted)]">Targets</p>
                  <p className="mt-2 font-display text-3xl uppercase tracking-[0.08em] text-[var(--theme-title)]">{selectedTargets.length}</p>
                </div>
                <div className="desktop-card p-4">
                  <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--theme-muted)]">Mode</p>
                  <p className="mt-2 text-sm leading-6 text-[var(--theme-body)]">{spotifyConnected ? "Private playlists + public Spotify targets" : "Public Spotify targets"}</p>
                </div>
              </div>

              <div className="mt-5 space-y-3">
                {selectedTargets.length > 0 ? selectedTargets.map((target) => (
                  <TargetCard
                    key={`${target.type}-${target.id}`}
                    target={target}
                    action={(
                      <button
                        onClick={() => removeTarget(target)}
                        className="rounded-full border border-[rgba(57,18,98,0.16)] bg-white/[0.18] px-4 py-2 text-sm text-[var(--theme-text)]"
                      >
                        Remove
                      </button>
                    )}
                  />
                )) : (
                  <div className="desktop-card p-4 text-sm leading-7 text-[var(--theme-body)]">
                    Add one or more sources on the left. You can mix playlists, albums, and artists in the same run.
                  </div>
                )}
              </div>

              <div className="mt-6 flex flex-wrap gap-3">
                <button
                  onClick={startPicker}
                  disabled={loadingPicker || selectedTargets.length === 0}
                  className="neon-outline inline-flex items-center justify-center rounded-full px-5 py-3 text-sm font-medium uppercase tracking-[0.18em] text-[#170718] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loadingPicker ? "Loading songs" : "Start picking"}
                </button>
                <button
                  onClick={() => setSelectedTargets([])}
                  disabled={selectedTargets.length === 0}
                  className="pixel-chip inline-flex items-center justify-center px-5 py-3 text-[var(--theme-text)] transition hover:text-[#2d0d46] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Clear targets
                </button>
              </div>
            </div>
          </section>

          <section className={`grid gap-6 ${spotifyConnected ? "xl:grid-cols-3" : "xl:grid-cols-2"}`}>
            <div className="glass-panel rounded-[32px] p-6 text-[var(--theme-text)]">
              <div className="flex items-center gap-3">
                <Search className="h-5 w-5 text-[var(--theme-accent)]" />
                <div>
                  <p className="section-kicker">Search Spotify</p>
                  <h2 className="mt-1 font-display text-3xl uppercase tracking-[0.08em] text-[var(--theme-title)]">Find public targets</h2>
                </div>
              </div>
              <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                <input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search artists, albums, or playlists"
                  className="w-full rounded-[18px] border-[3px] border-[rgba(44,12,70,0.2)] bg-white/70 px-4 py-3 text-base text-[var(--theme-text)]"
                />
                <button
                  onClick={runSearch}
                  disabled={searching}
                  className="neon-outline inline-flex items-center justify-center rounded-full px-5 py-3 text-sm font-medium uppercase tracking-[0.18em] text-[#170718] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {searching ? "Searching" : "Search"}
                </button>
              </div>

              <div className="mt-5 space-y-3">
                {searchResults.length > 0 ? searchResults.map((target) => (
                  <TargetCard
                    key={`${target.type}-${target.id}`}
                    target={target}
                    action={(
                      <button
                        onClick={() => appendTarget(target)}
                        className="pixel-chip inline-flex px-4 text-[var(--theme-text)] transition hover:text-[#2d0d46]"
                      >
                        Add
                      </button>
                    )}
                  />
                )) : (
                  <div className="desktop-card p-4 text-sm leading-7 text-[var(--theme-body)]">
                    Search for any public Spotify playlist, album, or artist and add several at once before starting.
                  </div>
                )}
              </div>
            </div>

            <div className="glass-panel rounded-[32px] p-6 text-[var(--theme-text)]">
              <div className="flex items-center gap-3">
                <Link2 className="h-5 w-5 text-[var(--theme-highlight)]" />
                <div>
                  <p className="section-kicker">Paste a link</p>
                  <h2 className="mt-1 font-display text-3xl uppercase tracking-[0.08em] text-[var(--theme-title)]">Add a direct Spotify target</h2>
                </div>
              </div>
              <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                <input
                  value={pastedInput}
                  onChange={(event) => setPastedInput(event.target.value)}
                  placeholder="https://open.spotify.com/playlist/... or album/artist"
                  className="w-full rounded-[18px] border-[3px] border-[rgba(44,12,70,0.2)] bg-white/70 px-4 py-3 text-base text-[var(--theme-text)]"
                />
                <button
                  onClick={addPastedTarget}
                  className="pixel-chip inline-flex items-center justify-center px-5 py-3 text-[var(--theme-text)] transition hover:text-[#2d0d46]"
                >
                  Add link
                </button>
              </div>
            </div>

            {spotifyConnected ? (
              <div className="glass-panel rounded-[32px] p-6 text-[var(--theme-text)]">
                <div className="flex items-center gap-3">
                  <LibraryBig className="h-5 w-5 text-cyan" />
                  <div>
                    <p className="section-kicker">Your Spotify library</p>
                    <h2 className="mt-1 font-display text-3xl uppercase tracking-[0.08em] text-[var(--theme-title)]">Pull from your own playlists</h2>
                  </div>
                </div>
                <div className="mt-5">
                  <input
                    value={libraryQuery}
                    onChange={(event) => setLibraryQuery(event.target.value)}
                    placeholder="Search your playlists"
                    className="w-full rounded-[18px] border-[3px] border-[rgba(44,12,70,0.2)] bg-white/70 px-4 py-3 text-base text-[var(--theme-text)]"
                  />
                </div>
                <div className="mt-5 space-y-3">
                  {loadingLibrary ? (
                    <div className="desktop-card p-4 text-sm leading-7 text-[var(--theme-body)]">Loading your playlists...</div>
                  ) : filteredLibraryTargets.length > 0 ? filteredLibraryTargets.slice(0, 18).map((target) => (
                    <TargetCard
                      key={`${target.type}-${target.id}`}
                      target={target}
                      action={(
                        <button
                          onClick={() => appendTarget(target)}
                          className="pixel-chip inline-flex px-4 text-[var(--theme-text)] transition hover:text-[#2d0d46]"
                        >
                          Add
                        </button>
                      )}
                    />
                  )) : (
                    <div className="desktop-card p-4 text-sm leading-7 text-[var(--theme-body)]">
                      {libraryTargets.length > 0 ? "No playlists matched that search." : "No playlists were available from your Spotify account yet."}
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}

      {phase !== "build" && pickerState && currentChoice ? (
        <div className="space-y-6">
          <div className="grid gap-4 lg:grid-cols-[0.85fr_1.3fr_1.3fr]">
            <div className="window-panel rounded-[32px] p-6 pt-14 text-[var(--theme-text)]">
              <p className="section-kicker">Round status</p>
              <h2 className="mt-2 font-display text-3xl uppercase tracking-[0.08em] text-[var(--theme-title)]">
                {pickerTracks.length} songs in play
              </h2>
              <div className="mt-6 desktop-card p-5 text-center">
                <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--theme-muted)]">More eliminations until next favorite</p>
                <p className="mt-3 font-display text-6xl uppercase tracking-[0.08em] text-[var(--theme-title)]">
                  {pickerState.eliminationCountdown}
                </p>
              </div>

              <div className="mt-5 space-y-3">
                <button
                  onClick={() => setPickerState((current) => current ? skipFavoritePickerChoice(current) : current)}
                  className="pixel-chip inline-flex w-full items-center justify-center gap-2 px-5 py-3 text-[var(--theme-text)] transition hover:text-[#2d0d46]"
                >
                  <Shuffle className="h-4 w-4" /> Skip matchup
                </button>
                <button
                  onClick={() => setPickerState((current) => current ? goBackFavoritePickerChoice(current) : current)}
                  disabled={pickerState.history.length === 0}
                  className="rounded-full border border-[rgba(57,18,98,0.16)] bg-white/[0.18] px-5 py-3 text-sm text-[var(--theme-text)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Back one choice
                </button>
                <button
                  onClick={resetPicker}
                  className="rounded-full border border-[rgba(57,18,98,0.16)] bg-white/[0.18] px-5 py-3 text-sm text-[var(--theme-text)]"
                >
                  New picker
                </button>
              </div>
            </div>

            <SongCard
              track={currentChoice.left}
              buttonLabel="Select"
              onPick={() => setPickerState((current) => current ? chooseFavoritePickerSong(current, currentChoice.left.id, currentChoice.right.id) : current)}
            />

            <SongCard
              track={currentChoice.right}
              buttonLabel="Select"
              onPick={() => setPickerState((current) => current ? chooseFavoritePickerSong(current, currentChoice.right.id, currentChoice.left.id) : current)}
            />
          </div>

          {rankedTracks.length > 0 ? (
            <section className="glass-panel rounded-[32px] p-6 text-[var(--theme-text)]">
              <div className="flex items-center gap-3">
                <Trophy className="h-5 w-5 text-[var(--theme-highlight)]" />
                <div>
                  <p className="section-kicker">Favorites so far</p>
                  <h2 className="mt-1 font-display text-3xl uppercase tracking-[0.08em] text-[var(--theme-title)]">The ranking is taking shape</h2>
                </div>
              </div>

              <div className="mt-5 grid gap-4 lg:grid-cols-2">
                {rankedTracks.slice(0, 6).map((track, index) => (
                  <div key={track.id} className="desktop-card flex items-center gap-4 p-4">
                    <div className="flex h-14 w-14 items-center justify-center rounded-[18px] bg-[linear-gradient(135deg,rgba(255,214,243,0.95),rgba(255,94,201,0.95)_32%,rgba(110,130,255,0.95)_68%,rgba(122,247,255,0.95))] font-display text-xl text-[#170718]">
                      {index + 1}
                    </div>
                    <TargetArtwork imageUrl={track.imageUrl} label={track.name} />
                    <div className="min-w-0 flex-1">
                      <p className="font-display text-xl uppercase tracking-[0.08em] text-[var(--theme-title)]">{track.name}</p>
                      <p className="mt-1 text-sm text-[var(--theme-body)]">{track.artistLabel}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      ) : null}

      {phase === "done" && pickerState ? (
        <section className="space-y-6">
          <div className="glass-panel rounded-[34px] p-6 text-[var(--theme-text)]">
            <div className="flex items-center gap-3">
              <Trophy className="h-5 w-5 text-[var(--theme-highlight)]" />
              <div>
                <p className="section-kicker">All done</p>
                <h2 className="mt-1 font-display text-4xl uppercase tracking-[0.08em] text-[var(--theme-title)]">Your favorites are ranked.</h2>
              </div>
            </div>
            <p className="mt-4 max-w-3xl text-base leading-8 text-[var(--theme-body)]">
              This run ranked {rankedTracks.length} songs across {selectedTargets.length} selected Spotify targets.
            </p>
            <div className="mt-5 flex gap-3">
              <button onClick={resetPicker} className="neon-outline inline-flex items-center justify-center rounded-full px-5 py-3 text-sm font-medium uppercase tracking-[0.18em] text-[#170718]">
                Build another picker
              </button>
            </div>
          </div>

          <div className="grid gap-4">
            {rankedTracks.map((track, index) => (
              <div key={track.id} className="glass-panel rounded-[30px] p-5 text-[var(--theme-text)]">
                <div className="flex flex-col gap-4 md:flex-row md:items-center">
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[22px] bg-[linear-gradient(135deg,rgba(255,214,243,0.95),rgba(255,94,201,0.95)_32%,rgba(110,130,255,0.95)_68%,rgba(122,247,255,0.95))] font-display text-2xl text-[#170718]">
                    {index + 1}
                  </div>
                  <TargetArtwork imageUrl={track.imageUrl} label={track.name} />
                  <div className="min-w-0 flex-1">
                    <p className="font-display text-2xl uppercase tracking-[0.08em] text-[var(--theme-title)]">{track.name}</p>
                    <p className="mt-1 text-sm text-[var(--theme-body)]">{track.artistLabel}</p>
                    <p className="mt-1 font-mono text-xs uppercase tracking-[0.16em] text-[var(--theme-muted)]">{track.albumName}</p>
                    <p className="mt-2 text-sm leading-6 text-[var(--theme-body)]">{track.sourceLabels.join(" / ")}</p>
                  </div>
                  <div className="flex gap-3">
                    {track.spotifyUrl ? (
                      <a
                        href={track.spotifyUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="pixel-chip inline-flex items-center justify-center px-4 text-[var(--theme-text)] transition hover:text-[#2d0d46]"
                      >
                        Listen
                      </a>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {phase === "pick" && pickerState && !currentChoice ? (
        <div className="glass-panel rounded-[32px] p-6 text-[var(--theme-text)]">
          <p className="section-kicker">Finishing up</p>
          <h2 className="mt-2 font-display text-3xl uppercase tracking-[0.08em] text-[var(--theme-title)]">One more moment while the final ranking settles.</h2>
        </div>
      ) : null}
    </div>
  );
}
