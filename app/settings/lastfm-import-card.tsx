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

const CLIENT_IMPORT_CHUNK_SIZE = 100;

function parseJsonSafely(rawText: string) {
  if (!rawText) {
    return null;
  }

  try {
    return JSON.parse(rawText) as Partial<ImportSummary> & { error?: string };
  } catch {
    return null;
  }
}

function splitFileIntoCsvChunks(csvText: string) {
  const lines = csvText.split(/\r?\n/);
  const header = lines[0] ?? "";
  const dataLines = lines.slice(1).filter((line) => line.trim().length > 0);

  if (!header.trim()) {
    return [] as string[];
  }

  const chunks: string[] = [];

  for (let start = 0; start < dataLines.length; start += CLIENT_IMPORT_CHUNK_SIZE) {
    const chunkLines = dataLines.slice(start, start + CLIENT_IMPORT_CHUNK_SIZE);
    chunks.push([header, ...chunkLines].join("\n"));
  }

  return chunks;
}

export function LastFmImportCard() {
  const router = useRouter();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [isPending, startTransition] = useTransition();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedFile) {
      setError("Choose your exported Last.fm CSV first.");
      return;
    }

    setError(null);
    setSummary(null);
    setProgressLabel("Preparing import...");
    setIsSubmitting(true);

    try {
      const csvText = await selectedFile.text();
      const chunks = splitFileIntoCsvChunks(csvText);

      if (chunks.length === 0) {
        setError("The uploaded CSV file was empty.");
        setProgressLabel(null);
        return;
      }

      const totals: ImportSummary = {
        totalRows: 0,
        parsedRows: 0,
        importedCount: 0,
        duplicateCount: 0,
        skippedRows: 0,
        batchCount: 0,
      };

      for (let index = 0; index < chunks.length; index += 1) {
        setProgressLabel(`Importing batch ${index + 1} of ${chunks.length}...`);

        const response = await fetch("/api/settings/lastfm-import", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            csvChunk: chunks[index],
            finalize: index === chunks.length - 1,
          }),
        });

        const rawText = await response.text();
        const payload = parseJsonSafely(rawText);

        if (!response.ok) {
          setError(
            typeof payload?.error === "string"
              ? payload.error
              : `Could not import your Last.fm history. Request failed with status ${response.status}.`,
          );
          setProgressLabel(null);
          return;
        }

        totals.totalRows += Number(payload?.totalRows ?? 0);
        totals.parsedRows += Number(payload?.parsedRows ?? 0);
        totals.importedCount += Number(payload?.importedCount ?? 0);
        totals.duplicateCount += Number(payload?.duplicateCount ?? 0);
        totals.skippedRows += Number(payload?.skippedRows ?? 0);
        totals.batchCount += Number(payload?.batchCount ?? 0);
      }

      setSummary(totals);
      setSelectedFile(null);
      setProgressLabel(null);
      startTransition(() => {
        router.refresh();
      });
    } catch {
      setError("Could not upload the CSV right now. Please try again.");
      setProgressLabel(null);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRemoveImportedHistory() {
    setError(null);
    setSummary(null);
    setProgressLabel("Removing imported Last.fm plays...");
    setIsRemoving(true);

    try {
      const response = await fetch("/api/settings/lastfm-import", {
        method: "DELETE",
      });
      const rawText = await response.text();
      const payload = parseJsonSafely(rawText);

      if (!response.ok) {
        setError(
          typeof payload?.error === "string"
            ? payload.error
            : `Could not remove imported Last.fm history. Request failed with status ${response.status}.`,
        );
        setProgressLabel(null);
        return;
      }

      setProgressLabel(null);
      startTransition(() => {
        router.refresh();
      });
    } catch {
      setError("Could not remove the imported Last.fm history right now. Please try again.");
      setProgressLabel(null);
    } finally {
      setIsRemoving(false);
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
            disabled={isSubmitting || isRemoving || isPending || !selectedFile}
            className="rounded-full border-[3px] border-[rgba(44,12,70,0.85)] bg-[rgba(255,236,245,0.9)] px-5 py-3 font-mono text-sm uppercase tracking-[0.16em] text-[var(--theme-text)] transition enabled:hover:bg-[rgba(255,225,239,0.96)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting || isPending ? "Importing..." : "Import history"}
          </button>
          <button
            type="button"
            onClick={() => {
              void handleRemoveImportedHistory();
            }}
            disabled={isSubmitting || isRemoving || isPending}
            className="rounded-full border-[2px] border-[rgba(140,26,26,0.35)] bg-[rgba(255,120,120,0.12)] px-5 py-3 font-mono text-sm uppercase tracking-[0.16em] text-[var(--theme-text)] transition enabled:hover:bg-[rgba(255,120,120,0.18)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isRemoving ? "Removing..." : "Remove imported plays"}
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

      {progressLabel ? (
        <div className="rounded-[24px] border-[2px] border-[rgba(44,12,70,0.18)] bg-white/[0.36] px-4 py-4 text-sm leading-7 text-[var(--theme-body)]">
          {progressLabel}
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
