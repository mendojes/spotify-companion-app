import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { listCommunityUsers } from "@/lib/connected-users";

export default async function SocialPage() {
  const session = await requireSession();

  if (!session) {
    redirect("/login");
  }

  const users = (await listCommunityUsers(24)).filter((user) => user.spotifyUserId !== session.spotifyUserId);

  return (
    <main className="relative overflow-hidden px-6 py-10 md:px-10">
      <div className="mx-auto max-w-7xl space-y-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-3xl space-y-3">
            <p className="text-sm uppercase tracking-[0.3em] text-gold/75">Community</p>
            <h1 className="font-display text-5xl text-[var(--theme-title)] md:text-6xl">See how other listeners shape their SoundScope.</h1>
            <p className="text-base leading-7 text-ink/80">Browse public SoundScope profiles from other connected users, open a read-only dashboard, and compare your listening fingerprints side by side.</p>
          </div>
          <Link href="/dashboard" className="rounded-full border border-ink/15 bg-white/5 px-4 py-2 text-sm text-ink transition hover:border-gold/25 hover:text-gold">
            Back to dashboard
          </Link>
        </div>

        {users.length === 0 ? (
          <div className="glass-panel rounded-[34px] p-10 text-center text-ink/70">No other active community profiles are available yet.</div>
        ) : (
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {users.map((user) => (
              <div key={user.spotifyUserId} className="glass-panel rounded-[32px] p-6 text-[var(--theme-text)]">
                <div className="flex items-start gap-4">
                  {user.imageUrl ? (
                    <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-[26px] border border-white/10 bg-white/5">
                      <Image src={user.imageUrl} alt={user.displayName} fill sizes="96px" className="object-cover" />
                    </div>
                  ) : (
                    <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-[26px] border border-dashed border-white/15 text-xs uppercase tracking-[0.18em] text-ink/50">User</div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-display text-3xl text-[var(--theme-title)]">{user.displayName}</p>
                    <p className="mt-2 text-sm uppercase tracking-[0.16em] text-[var(--theme-muted)]">Last seen {new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(user.lastSeenAt))}</p>
                    <p className="mt-2 text-sm text-[var(--theme-body)]">{user.lastSnapshotAt ? `Snapshot refreshed ${new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(user.lastSnapshotAt))}` : "Waiting on first public snapshot"}</p>
                  </div>
                </div>
                <div className="mt-6 flex flex-wrap gap-3">
                  <Link href={`/social/${user.spotifyUserId}`} className="pixel-chip text-[var(--theme-text)] transition hover:text-[#2d0d46]">Open dashboard</Link>
                  <Link href={`/social/${user.spotifyUserId}/compare`} className="pixel-chip text-[var(--theme-text)] transition hover:text-[#2d0d46]">Compare with me</Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
