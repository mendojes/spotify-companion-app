import Link from "next/link";
import { hasSpotifyConnection, requireSession } from "@/lib/auth";
import { getConnectedUser, getDefaultPrivacySettings } from "@/lib/connected-users";

type SettingsPageProps = {
  searchParams: Promise<{ saved?: string }>;
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
  const { saved } = await searchParams;
  const spotifyConnected = hasSpotifyConnection(session);

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
              <p className="text-sm text-[var(--theme-body)]">{session.email}</p>
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

          <div className="flex flex-wrap gap-3">
            <button type="submit" className="rounded-full border-[3px] border-[rgba(44,12,70,0.85)] bg-[rgba(255,236,245,0.9)] px-5 py-3 font-mono text-sm uppercase tracking-[0.16em] text-[var(--theme-text)] transition hover:bg-[rgba(255,225,239,0.96)]">
              Save settings
            </button>
            <Link href="/social" className="pixel-chip text-[var(--theme-text)] transition hover:text-[#2d0d46]">
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </main>
  );
}
