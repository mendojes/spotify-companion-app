import Link from "next/link";
import { hasSpotifyConnection, isAdminSession, requireSession } from "@/lib/auth";
import { getConnectedUser, getDefaultPrivacySettings, listAllConnectedUsers } from "@/lib/connected-users";
import { listUnresolvedImportedLastFmGroups } from "@/lib/lastfm-import";
import { listLocalAccounts } from "@/lib/local-accounts";
import { getStoredPlaylistLibrary } from "@/lib/spotify-playlists";
import { IgnoredPlaylistPicker } from "./ignored-playlist-picker";
import { LastFmImportCard } from "./lastfm-import-card";
import { LastFmUnresolvedCard } from "./lastfm-unresolved-card";

type SettingsPageProps = {
  searchParams: Promise<{ saved?: string; unresolvedPage?: string; unresolvedSearch?: string }>;
};

function ToggleRow({
  name,
  title,
  description,
  defaultChecked,
}: {
  name: string;
  title: string;
  description: string;
  defaultChecked: boolean;
}) {
  return (
    <label className="desktop-card flex cursor-pointer items-start justify-between gap-4 p-5">
      <div className="space-y-2">
        <p className="font-display text-2xl uppercase tracking-[0.08em] text-[var(--theme-title)]">{title}</p>
        <p className="max-w-2xl text-sm leading-7 text-[var(--theme-body)]">{description}</p>
      </div>
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="mt-2 h-5 w-5 rounded border-[rgba(44,12,70,0.6)] text-[var(--theme-accent)]"
      />
    </label>
  );
}

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const session = await requireSession();
  const { saved, unresolvedPage, unresolvedSearch } = await searchParams;
  const adminSession = isAdminSession(session);
  const spotifyConnected = hasSpotifyConnection(session);

  if (adminSession) {
    const [localAccounts, connectedUsers] = await Promise.all([
      listLocalAccounts().catch(() => []),
      listAllConnectedUsers().catch(() => []),
    ]);

    return (
      <main className="city-pop-shell min-h-screen px-6 py-10 md:px-10">
        <div className="mx-auto max-w-7xl space-y-8 text-[var(--theme-text)]">
          <section className="glass-panel rounded-[36px] p-8 md:p-10">
            <p className="section-kicker">Admin Settings</p>
            <h1 className="mt-4 font-display text-4xl uppercase tracking-[0.08em] text-[var(--theme-title)] md:text-5xl">
              Account management
            </h1>
            <p className="mt-5 max-w-3xl text-base leading-8 text-[var(--theme-body)]">
              This settings page is visible only to the admin user. From here you can review local accounts, inspect connected Spotify users, and delete account records.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/" className="pixel-chip text-[var(--theme-text)] transition hover:text-[#2d0d46]">
                Home
              </Link>
              <Link href="/dashboard" className="pixel-chip text-[var(--theme-text)] transition hover:text-[#2d0d46]">
                Dashboard
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
                  Listening Lore users
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

  if (!spotifyConnected) {
    return (
      <main className="city-pop-shell min-h-screen px-6 py-10 md:px-10">
        <div className="mx-auto max-w-5xl space-y-8 text-[var(--theme-text)]">
          <section className="glass-panel rounded-[36px] p-8 md:p-10">
            <p className="section-kicker">Account</p>
            <h1 className="mt-4 font-display text-4xl uppercase tracking-[0.08em] text-[var(--theme-title)] md:text-5xl">
              Public-profile account details
            </h1>
            <p className="mt-5 max-w-3xl text-base leading-8 text-[var(--theme-body)]">
              This account is using the public-profile dashboard path. Listening Lore reads from the Spotify profile link saved on your account and only shows sections that are publicly available from that profile.
            </p>
            <div className="mt-6 space-y-3 rounded-[28px] border-[3px] border-[rgba(44,12,70,0.2)] bg-white/[0.48] p-5">
              <p className="font-display text-2xl uppercase tracking-[0.08em] text-[var(--theme-title)]">{session.displayName}</p>
              <p className="text-sm leading-7 text-[var(--theme-body)]">Saved Spotify profile link: {session.spotifyProfileUrl ?? "Not available"}</p>
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/dashboard" className="pixel-chip text-[var(--theme-text)] transition hover:text-[#2d0d46]">
                Back to dashboard
              </Link>
            </div>
          </section>
        </div>
      </main>
    );
  }

  const connectedUser = await getConnectedUser(session.spotifyUserId);
  const privacy = connectedUser?.privacy ?? getDefaultPrivacySettings();
  const unresolvedGroups = await listUnresolvedImportedLastFmGroups(
    session.spotifyUserId,
    Number(unresolvedPage ?? "1") || 1,
    10,
    unresolvedSearch ?? "",
  );
  const initialModesByPlaylistId = Object.fromEntries(
    (connectedUser?.ignoredPlaylists ?? []).map((rule) => [rule.playlistId, rule.mode]),
  );
  const storedPlaylists = (await getStoredPlaylistLibrary(session.spotifyUserId))
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <main className="city-pop-shell min-h-screen px-6 py-10 md:px-10">
      <div className="mx-auto max-w-5xl space-y-8 text-[var(--theme-text)]">
        <section className="glass-panel rounded-[36px] p-8 md:p-10">
          <p className="section-kicker">Settings</p>
          <h1 className="mt-4 font-display text-4xl uppercase tracking-[0.08em] text-[var(--theme-title)] md:text-5xl">
            Social sharing controls
          </h1>
          <p className="mt-5 max-w-3xl text-base leading-8 text-[var(--theme-body)]">
            Choose exactly what other Listening Lore users can see. These controls affect only cached data already stored for the app and never trigger extra Spotify fetches for people viewing your profile.
          </p>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-[var(--theme-body)]">
            You can also tell Listening Lore to ignore specific playlists. Plays from ignored playlists are excluded from future recent-play syncs, removed from stored recent-play history, and left out of the dashboard analysis we rebuild from that history.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/social" className="pixel-chip text-[var(--theme-text)] transition hover:text-[#2d0d46]">
              Back to social
            </Link>
            <Link href="/privacy" className="pixel-chip text-[var(--theme-text)] transition hover:text-[#2d0d46]">
              Privacy details
            </Link>
            <Link href="/dashboard" className="pixel-chip text-[var(--theme-text)] transition hover:text-[#2d0d46]">
              Dashboard
            </Link>
          </div>
        </section>

        {saved ? (
          <div className="rounded-[24px] border-[3px] border-[rgba(44,12,70,0.9)] bg-[rgba(229,255,255,0.82)] px-5 py-4 text-sm shadow-glow">
            Your sharing settings were updated.
          </div>
        ) : null}

        <form action="/api/settings/privacy" method="post" className="space-y-5">
          <ToggleRow
            name="shareProfile"
            title="Show my profile in social"
            description="Lets other signed-in users find your public Listening Lore profile card in the social directory. If this is off, your profile stays hidden."
            defaultChecked={privacy.shareProfile}
          />
          <ToggleRow
            name="shareTopLists"
            title="Share my top artists and tracks"
            description="Allows your public profile and compare page to show cached top-list rankings from your stored Listening Lore history."
            defaultChecked={privacy.shareTopLists}
          />
          <ToggleRow
            name="shareListeningActivity"
            title="Share my listening patterns"
            description="Allows mood balance, genre pulse, and recent listening summaries from cached history to appear on your public profile and in friend comparisons."
            defaultChecked={privacy.shareListeningActivity}
          />

          <IgnoredPlaylistPicker
            playlists={storedPlaylists.map((playlist) => ({
              id: playlist.id,
              name: playlist.name,
              imageUrl: playlist.images?.[0]?.url,
              trackCount: playlist.tracks.total,
            }))}
            initialModesByPlaylistId={initialModesByPlaylistId}
          />

          <div className="flex flex-wrap gap-3">
            <button type="submit" className="rounded-full border-[3px] border-[rgba(44,12,70,0.85)] bg-[rgba(255,236,245,0.9)] px-5 py-3 font-mono text-sm uppercase tracking-[0.16em] text-[var(--theme-text)] transition hover:bg-[rgba(255,225,239,0.96)]">
              Save settings
            </button>
            <Link href="/social" className="pixel-chip text-[var(--theme-text)] transition hover:text-[#2d0d46]">
              Cancel
            </Link>
          </div>
        </form>

        <LastFmImportCard />
        <LastFmUnresolvedCard unresolvedGroups={unresolvedGroups} saved={saved} search={unresolvedSearch} />
      </div>
    </main>
  );
}
