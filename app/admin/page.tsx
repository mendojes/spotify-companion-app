import Link from "next/link";
import { requireAdminSession } from "@/lib/auth";
import { listAllConnectedUsers } from "@/lib/connected-users";
import { listLocalAccounts } from "@/lib/local-accounts";

export default async function AdminPage() {
  const session = await requireAdminSession();
  const [localAccounts, connectedUsers] = await Promise.all([
    listLocalAccounts().catch(() => []),
    listAllConnectedUsers().catch(() => []),
  ]);

  return (
    <main className="city-pop-shell min-h-screen px-6 py-10 md:px-10">
      <div className="mx-auto max-w-7xl space-y-8 text-[var(--theme-text)]">
        <section className="glass-panel rounded-[36px] p-8 md:p-10">
          <p className="section-kicker">Admin</p>
          <h1 className="mt-4 font-display text-4xl uppercase tracking-[0.08em] text-[var(--theme-title)] md:text-5xl">
            User management
          </h1>
          <p className="mt-5 max-w-3xl text-base leading-8 text-[var(--theme-body)]">
            Signed in as {session.displayName}. This page can review local accounts, inspect connected Spotify users, and delete account records plus stored data.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/" className="pixel-chip text-[var(--theme-text)] transition hover:text-[#2d0d46]">
              Home
            </Link>
            <a href="/api/auth/logout" className="pixel-chip text-[var(--theme-text)] transition hover:text-[#2d0d46]">
              Log out
            </a>
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="section-kicker">Local accounts</p>
              <h2 className="mt-2 font-display text-3xl uppercase tracking-[0.08em] text-[var(--theme-title)]">
                Listening Lore accounts
              </h2>
            </div>
            <p className="text-sm text-[var(--theme-muted)]">{localAccounts.length} account{localAccounts.length === 1 ? "" : "s"}</p>
          </div>
          <div className="grid gap-4">
            {localAccounts.map((account) => (
              <div key={account.id} className="desktop-card flex flex-wrap items-start justify-between gap-4 p-5">
                <div className="space-y-2">
                  <p className="font-display text-2xl uppercase tracking-[0.08em] text-[var(--theme-title)]">
                    {account.displayName} {account.role === "admin" ? "(Admin)" : ""}
                  </p>
                  <p className="text-sm text-[var(--theme-body)]">Username: {account.username}</p>
                  <p className="text-sm text-[var(--theme-body)]">Spotify profile: {account.spotifyProfileUrl}</p>
                  <p className="text-sm text-[var(--theme-muted)]">Created: {account.createdAt}</p>
                </div>
                {account.role === "admin" ? (
                  <div className="rounded-full border border-[rgba(57,18,98,0.16)] bg-white/[0.2] px-4 py-2 text-sm text-[var(--theme-muted)]">
                    Protected
                  </div>
                ) : (
                  <form action="/api/admin/users/delete" method="post">
                    <input type="hidden" name="kind" value="local" />
                    <input type="hidden" name="id" value={account.id} />
                    <button type="submit" className="rounded-full border border-[rgba(140,26,26,0.3)] bg-[rgba(255,120,120,0.12)] px-4 py-2 text-sm text-[var(--theme-text)]">
                      Delete account
                    </button>
                  </form>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="section-kicker">Connected users</p>
              <h2 className="mt-2 font-display text-3xl uppercase tracking-[0.08em] text-[var(--theme-title)]">
                Spotify-connected profiles
              </h2>
            </div>
            <p className="text-sm text-[var(--theme-muted)]">{connectedUsers.length} user{connectedUsers.length === 1 ? "" : "s"}</p>
          </div>
          <div className="grid gap-4">
            {connectedUsers.map((user) => (
              <div key={user.spotifyUserId} className="desktop-card flex flex-wrap items-start justify-between gap-4 p-5">
                <div className="space-y-2">
                  <p className="font-display text-2xl uppercase tracking-[0.08em] text-[var(--theme-title)]">{user.displayName}</p>
                  <p className="text-sm text-[var(--theme-body)]">Spotify user id: {user.spotifyUserId}</p>
                  <p className="text-sm text-[var(--theme-body)]">Email: {user.email ?? "Not stored"}</p>
                  <p className="text-sm text-[var(--theme-muted)]">Last seen: {user.lastSeenAt}</p>
                </div>
                <form action="/api/admin/users/delete" method="post">
                  <input type="hidden" name="kind" value="spotify" />
                  <input type="hidden" name="id" value={user.spotifyUserId} />
                  <button type="submit" className="rounded-full border border-[rgba(140,26,26,0.3)] bg-[rgba(255,120,120,0.12)] px-4 py-2 text-sm text-[var(--theme-text)]">
                    Delete user data
                  </button>
                </form>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
