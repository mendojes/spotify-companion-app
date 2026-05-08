import { listMaintenanceHistory } from "@/lib/dashboard-maintenance";

function formatTimestamp(value?: string) {
  if (!value) {
    return "not recorded";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatAction(action: string) {
  return action.replace(/-/g, " ");
}

export async function DashboardMaintenanceHistory({ spotifyUserId }: { spotifyUserId: string }) {
  const history = await listMaintenanceHistory(spotifyUserId).catch(() => []);

  return (
    <section className="rounded-[24px] border-[3px] border-[rgba(44,12,70,0.9)] bg-[rgba(244,251,255,0.82)] px-5 py-5 shadow-glow">
      <div>
        <p className="font-display text-lg uppercase tracking-[0.12em] text-[var(--theme-title)]">Maintenance History</p>
        <p className="text-sm text-[var(--theme-muted)]">The last recorded result for each maintenance action lives here even when the live status banner is gone.</p>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {history.length === 0 ? (
          <div className="rounded-[18px] border border-[rgba(44,12,70,0.14)] bg-white/65 px-4 py-4 text-sm text-[var(--theme-muted)]">
            No maintenance runs have been recorded yet.
          </div>
        ) : history.map((entry) => (
          <article
            key={entry.action}
            className="rounded-[18px] border border-[rgba(44,12,70,0.14)] bg-white/65 px-4 py-4"
          >
            <div className="flex items-start justify-between gap-3">
              <p className="font-display text-sm uppercase tracking-[0.14em] text-[var(--theme-title)]">{formatAction(entry.action)}</p>
              <span className="rounded-full border border-[rgba(44,12,70,0.14)] px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-[var(--theme-text)]">
                {entry.partial ? `${entry.status} partial` : entry.status}
              </span>
            </div>
            <p className="mt-2 text-sm text-[var(--theme-text)]">{entry.detail}</p>
            <p className="mt-3 text-xs uppercase tracking-[0.12em] text-[var(--theme-muted)]">
              Started: {formatTimestamp(entry.startedAt)}
            </p>
            <p className="mt-1 text-xs uppercase tracking-[0.12em] text-[var(--theme-muted)]">
              Finished: {formatTimestamp(entry.finishedAt)}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
