import Link from "next/link";
import { LogOut, Settings2, Sparkles, Users } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { DashboardSectionNav } from "@/components/dashboard-section-nav";
import { RefreshSnapshotLink } from "@/components/refresh-snapshot-link";
import { getSession, hasSpotifyConnection, isAdminSession } from "@/lib/auth";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const spotifyConnected = hasSpotifyConnection(session);
  const adminSession = isAdminSession(session);

  return (
    <div className="city-pop-shell relative min-h-screen overflow-hidden pb-10">
      <nav className="sticky top-0 z-40 border-b-[3px] border-[rgba(44,12,70,0.9)] bg-[rgba(255,240,253,0.74)] px-4 py-4 backdrop-blur-2xl sm:px-6 md:px-10">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 md:flex-row md:flex-wrap md:items-center md:justify-between">
          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            <div className="neon-outline flex h-12 w-12 shrink-0 items-center justify-center rounded-[18px] border-[3px] border-[rgba(44,12,70,0.9)] bg-[linear-gradient(135deg,#fff8ff,#ff97e8_44%,#87f2ff)] font-display text-base font-bold uppercase tracking-[0.18em] text-[#2d0d46] sm:h-14 sm:w-14 sm:rounded-[20px] sm:text-lg">
              LL
            </div>
            <div className="min-w-0">
              <p className="truncate font-display text-xl uppercase tracking-[0.12em] text-[var(--theme-title)] sm:text-2xl md:text-3xl">Listening Lore</p>
              <p className="text-sm uppercase tracking-[0.16em] text-[var(--theme-muted)] sm:font-mono sm:text-base md:text-lg md:tracking-[0.24em]">pastel listening desktop</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 md:justify-end md:gap-3">
            <ThemeToggle />
            {adminSession ? (
              <Link href="/admin" className="pixel-chip inline-flex min-h-11 items-center gap-2 px-3 text-xs text-[var(--theme-text)] transition hover:text-[#2d0d46] sm:px-4 sm:text-sm">
                Admin
              </Link>
            ) : null}
            <Link href="/settings" className="pixel-chip inline-flex min-h-11 items-center gap-2 px-3 text-xs text-[var(--theme-text)] transition hover:text-[#2d0d46] sm:px-4 sm:text-sm">
              <Settings2 className="h-4 w-4" /> Settings
            </Link>
            {spotifyConnected ? (
              <>
                <Link href="/social" className="pixel-chip inline-flex min-h-11 items-center gap-2 px-3 text-xs text-[var(--theme-text)] transition hover:text-[#2d0d46] sm:px-4 sm:text-sm">
                  <Users className="h-4 w-4" /> Social
                </Link>
                <Link href="/privacy" className="pixel-chip inline-flex min-h-11 items-center gap-2 px-3 text-xs text-[var(--theme-text)] transition hover:text-[#2d0d46] sm:px-4 sm:text-sm">
                  <Sparkles className="h-4 w-4" /> Privacy
                </Link>
                <RefreshSnapshotLink href="/api/dashboard/refresh?range=week" />
              </>
            ) : null}
            {session?.displayName ? (
              <div className="hidden desktop-card px-4 py-2 text-right xl:block">
                <p className="text-sm text-[var(--theme-title)]">{session.displayName}</p>
              </div>
            ) : null}
            <a href="/api/auth/logout" className="pixel-chip inline-flex min-h-11 items-center gap-2 px-3 text-xs text-[var(--theme-text)] transition hover:text-[#2d0d46] sm:px-4 sm:text-sm">
              <LogOut className="h-4 w-4" /> Log out
            </a>
          </div>
        </div>
      </nav>

      <div className="px-4 pt-5 sm:px-6 md:px-10">
        <div className="mx-auto max-w-7xl space-y-4">
          {spotifyConnected ? (
            <>
              <DashboardSectionNav spotifyConnected />
            </>
          ) : (
            <>
              <div className="rounded-[24px] border-[3px] border-[rgba(44,12,70,0.9)] bg-[rgba(255,247,224,0.86)] px-5 py-4 text-sm text-[var(--theme-text)] shadow-glow">
                Public-profile dashboard mode is active. Listening Lore is showing only the Spotify data that is available from the public profile link on your account.
              </div>
              <DashboardSectionNav spotifyConnected={false} />
            </>
          )}
        </div>
      </div>

      {children}
    </div>
  );
}
