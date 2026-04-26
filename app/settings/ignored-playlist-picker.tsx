"use client";

import Image from "next/image";
import { useDeferredValue, useMemo, useState } from "react";

type IgnoredPlaylistPickerItem = {
  id: string;
  name: string;
  imageUrl?: string;
  trackCount: number;
};

type IgnoredPlaylistPickerProps = {
  playlists: IgnoredPlaylistPickerItem[];
  initiallyIgnoredPlaylistIds: string[];
};

const PAGE_SIZE = 8;

function normalizeSearchValue(value: string) {
  return value.trim().toLowerCase();
}

export function IgnoredPlaylistPicker({
  playlists,
  initiallyIgnoredPlaylistIds,
}: IgnoredPlaylistPickerProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const normalizedSearchQuery = normalizeSearchValue(deferredSearchQuery);
  const [page, setPage] = useState(1);
  const initiallyIgnoredSet = useMemo(() => new Set(initiallyIgnoredPlaylistIds), [initiallyIgnoredPlaylistIds]);

  const filteredPlaylists = useMemo(() => {
    if (!normalizedSearchQuery) {
      return playlists;
    }

    return playlists.filter((playlist) => normalizeSearchValue(playlist.name).includes(normalizedSearchQuery));
  }, [normalizedSearchQuery, playlists]);

  const totalPages = Math.max(1, Math.ceil(filteredPlaylists.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visiblePlaylists = filteredPlaylists.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <section className="desktop-card space-y-4 p-5">
      <div className="space-y-2">
        <p className="font-display text-2xl uppercase tracking-[0.08em] text-[var(--theme-title)]">Ignore specific playlists</p>
        <p className="max-w-3xl text-sm leading-7 text-[var(--theme-body)]">
          Ignored playlists stop contributing to recent-play-driven analysis. Existing stored plays from these playlists are removed when you save, so this change intentionally rewrites cached dashboard history around that choice.
        </p>
      </div>

      {playlists.length > 0 ? (
        <>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <label className="flex-1">
              <span className="mb-2 block font-mono text-xs uppercase tracking-[0.18em] text-[var(--theme-body)]">Search playlists</span>
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => {
                  setSearchQuery(event.target.value);
                  setPage(1);
                }}
                placeholder="Find a playlist by name"
                className="w-full rounded-[20px] border-[2px] border-[rgba(44,12,70,0.28)] bg-white/[0.72] px-4 py-3 text-sm text-[var(--theme-text)] outline-none transition focus:border-[rgba(44,12,70,0.72)]"
              />
            </label>
            <div className="rounded-[20px] border-[2px] border-[rgba(44,12,70,0.16)] bg-white/[0.42] px-4 py-3 font-mono text-xs uppercase tracking-[0.16em] text-[var(--theme-body)]">
              {filteredPlaylists.length} playlist{filteredPlaylists.length === 1 ? "" : "s"}
            </div>
          </div>

          {visiblePlaylists.length > 0 ? (
            <>
              <div className="grid gap-3 md:grid-cols-2">
                {visiblePlaylists.map((playlist) => (
                  <label
                    key={playlist.id}
                    className="flex min-h-[7.5rem] cursor-pointer items-start gap-3 rounded-[24px] border-[2px] border-[rgba(44,12,70,0.24)] bg-white/[0.42] px-4 py-3"
                  >
                    <input
                      type="checkbox"
                      name="ignoredPlaylistIds"
                      value={playlist.id}
                      defaultChecked={initiallyIgnoredSet.has(playlist.id)}
                      className="mt-1 h-5 w-5 shrink-0 rounded border-[rgba(44,12,70,0.6)] text-[var(--theme-accent)]"
                    />
                    <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-[20px] border border-[rgba(44,12,70,0.18)] bg-white/[0.5]">
                      {playlist.imageUrl ? (
                        <Image
                          src={playlist.imageUrl}
                          alt={`${playlist.name} artwork`}
                          fill
                          sizes="80px"
                          className="object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center p-3 font-mono text-xs uppercase tracking-[0.16em] text-ink/60">
                          Art
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 space-y-2">
                      <p className="font-display text-base uppercase leading-tight tracking-[0.08em] text-[var(--theme-title)] [overflow-wrap:anywhere]">
                        {playlist.name}
                      </p>
                      <p className="text-xs uppercase tracking-[0.14em] text-[var(--theme-body)]">
                        {playlist.trackCount} tracks
                      </p>
                    </div>
                  </label>
                ))}
              </div>

              {totalPages > 1 ? (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-[20px] border-[2px] border-[rgba(44,12,70,0.16)] bg-white/[0.36] px-4 py-3">
                  <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--theme-body)]">
                    Page {safePage} of {totalPages}
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setPage((current) => Math.max(1, current - 1))}
                      disabled={safePage <= 1}
                      className="rounded-full border-[2px] border-[rgba(44,12,70,0.55)] bg-white/[0.76] px-4 py-2 font-mono text-xs uppercase tracking-[0.16em] text-[var(--theme-text)] transition enabled:hover:bg-white disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      Prev
                    </button>
                    <button
                      type="button"
                      onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                      disabled={safePage >= totalPages}
                      className="rounded-full border-[2px] border-[rgba(44,12,70,0.55)] bg-white/[0.76] px-4 py-2 font-mono text-xs uppercase tracking-[0.16em] text-[var(--theme-text)] transition enabled:hover:bg-white disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      Next
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <div className="rounded-[24px] border-[2px] border-dashed border-[rgba(44,12,70,0.24)] bg-white/[0.32] px-4 py-4 text-sm leading-7 text-[var(--theme-body)]">
              No playlists matched that search.
            </div>
          )}
        </>
      ) : (
        <div className="rounded-[24px] border-[2px] border-dashed border-[rgba(44,12,70,0.24)] bg-white/[0.32] px-4 py-4 text-sm leading-7 text-[var(--theme-body)]">
          No stored playlist library was available yet. Open the Playlists tab or run a playlist refresh first, then come back here to pick ignored playlists.
        </div>
      )}
    </section>
  );
}
