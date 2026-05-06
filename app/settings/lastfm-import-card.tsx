"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState, useTransition } from "react";

type ImportSummary = {
  totalRows: number;
  parsedRows: number;
  importedCount: number;
  duplicateCount: number;
  skippedRows: number;
  batchCount: number;
};

export function LastFmImportCard() {
  const router = useRouter();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPending, startTransition] = useTransition();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedFile) {
      setError("Choose your exported Last.fm CSV first.");
      return;
    }

    setError(null);
    setSummary(null);
    setIsSubmitting(true);

    const formData = new FormData();
    formData.set("lastfmCsv", selectedFile);

    try {
      const response = await fetch("/api/settings/lastfm-import", {
        method: "POST",
        body: formData,
      });
      const payload = await response.json();

      if (!response.ok) {
        setError(typeof payload?.error === "string" ? payload.error : "Could not import your Last.fm history.");
        setIsSubmitting(false);
        return;
      }

      setSummary(payload as ImportSummary);
      setSelectedFile(null);
      startTransition(() => {
        router.refresh();
      });
    } catch {
      setError("Could not upload the CSV right now. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="desktop-card space-y-4 p-5">
      <div className="space-y-2">
        <p className="font-display text-2xl uppercase tracking-[0.08em] text-[var(--theme-title)]">Import Last.fm scrobbles</p>
        <p className="max-w-3xl text-sm leading-7 text-[var(--theme-body)]">
          Upload a Last.fm CSV export to backfill your stored listening history. Listening Lore skips duplicate plays by matching timestamps against track ids when available, or track and artist names when they are not.
        </p>
        <p className="max-w-3xl text-sm leading-7 text-[var(--theme-body)]">
          Imports run in batches and then rebuild the cached dashboard stats and analysis from the updated history.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <label className="block">
          <span className="mb-2 block font-mono text-xs uppercase tracking-[0.18em] text-[var(--theme-body)]">Last.fm CSV export</span>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => {
              const nextFile = event.target.files?.[0] ?? null;
              setSelectedFile(nextFile);
              setError(null);
            }}
            className="w-full rounded-[20px] border-[2px] border-[rgba(44,12,70,0.28)] bg-white/[0.72] px-4 py-3 text-sm text-[var(--theme-text)]"
          />
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={isSubmitting || isPending || !selectedFile}
            className="rounded-full border-[3px] border-[rgba(44,12,70,0.85)] bg-[rgba(255,236,245,0.9)] px-5 py-3 font-mono text-sm uppercase tracking-[0.16em] text-[var(--theme-text)] transition enabled:hover:bg-[rgba(255,225,239,0.96)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting || isPending ? "Importing..." : "Import history"}
          </button>
          {selectedFile ? (
            <p className="text-sm text-[var(--theme-body)]">{selectedFile.name}</p>
          ) : null}
        </div>
      </form>

      {error ? (
        <div className="rounded-[24px] border-[2px] border-[rgba(140,26,26,0.3)] bg-[rgba(255,120,120,0.12)] px-4 py-4 text-sm leading-7 text-[var(--theme-text)]">
          {error}
        </div>
      ) : null}

      {summary ? (
        <div className="rounded-[24px] border-[3px] border-[rgba(44,12,70,0.18)] bg-white/[0.42] px-4 py-4 text-sm leading-7 text-[var(--theme-body)]">
          Imported {summary.importedCount} plays from {summary.parsedRows} parsed rows. Skipped {summary.duplicateCount} duplicates and {summary.skippedRows} incomplete rows across {summary.batchCount} batch{summary.batchCount === 1 ? "" : "es"}.
        </div>
      ) : null}
    </section>
  );
}
