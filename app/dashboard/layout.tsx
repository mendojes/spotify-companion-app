import Link from "next/link";
import { LogOut, RefreshCcw, Settings2, Sparkles, Users } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { DashboardSectionNav } from "@/components/dashboard-section-nav";
import { getSession, hasSpotifyConnection } from "@/lib/auth";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const spotifyConnected = hasSpotifyConnection(session);

  return (
    <div className="city-pop-shell relative min-h-screen overflow-hidden pb-10">
      <nav className="sticky top-0 z-40 border-b-[3px] border-[rgba(44,12,70,0.9)] bg-[rgba(255,240,253,0.74)] px-6 py-4 backdrop-blur-2xl md:px-10">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="neon-outline flex h-14 w-14 items-center justify-center rounded-[20px] border-[3px] border-[rgba(44,12,70,0.9)] bg-[linear-gradient(135deg,#fff8ff,#ff97e8_44%,#87f2ff)] font-display text-lg font-bold uppercase tracking-[0.18em] text-[#2d0d46]">
              SS
            </div>
            <div>
              <p className="font-display text-2xl uppercase tracking-[0.14em] text-[var(--theme-title)] md:text-3xl">SoundScope</p>
              <p className="font-mono text-lg uppercase tracking-[0.24em] text-[var(--theme-muted)]">pastel listening desktop</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <ThemeToggle />
            <Link href="/settings" className="pixel-chip inline-flex items-center gap-2 text-[var(--theme-text)] transition hover:text-[#2d0d46]">
              <Settings2 className="h-4 w-4" /> Settings
            </Link>
            {spotifyConnected ? (
              <>
                <Link href="/social" className="pixel-chip inline-flex items-center gap-2 text-[var(--theme-text)] transition hover:text-[#2d0d46]">
                  <Users className="h-4 w-4" /> Social
                </Link>
                <Link href="/privacy" className="pixel-chip inline-flex items-center gap-2 text-[var(--theme-text)] transition hover:text-[#2d0d46]">
                  <Sparkles className="h-4 w-4" /> Privacy
                </Link>
                <a href="/api/dashboard/refresh?range=week" className="pixel-chip inline-flex items-center gap-2 text-[var(--theme-text)] transition hover:text-[#2d0d46]">
                  <RefreshCcw className="h-4 w-4" /> Refresh snapshot
                </a>
              </>
            ) : null}
            {session?.displayName ? (
              <div className="hidden desktop-card px-4 py-2 text-right md:block">
                <p className="text-sm text-[var(--theme-title)]">{session.displayName}</p>
              </div>
            ) : null}
            <a href="/api/auth/logout" className="pixel-chip inline-flex items-center gap-2 text-[var(--theme-text)] transition hover:text-[#2d0d46]">
              <LogOut className="h-4 w-4" /> Log out
            </a>
          </div>
        </div>
      </nav>

      <div className="px-6 pt-5 md:px-10">
        <div className="mx-auto max-w-7xl space-y-4">
          {spotifyConnected ? (
            <>
              <div className="flex flex-wrap items-center gap-3 text-[var(--theme-text)]">
                <div className="sticker-badge inline-flex items-center gap-2 px-4 py-2 font-mono text-sm uppercase tracking-[0.16em]">
                  <Sparkles className="h-4 w-4 text-[var(--theme-highlight)]" /> sectioned dashboard
                </div>
                <div className="sticker-badge inline-flex items-center gap-2 px-4 py-2 font-mono text-sm uppercase tracking-[0.16em]">
                  <RefreshCcw className="h-4 w-4 text-[var(--theme-accent)]" /> one section at a time
                </div>
              </div>
              <DashboardSectionNav spotifyConnected />
            </>
          ) : (
            <>
              <div className="rounded-[24px] border-[3px] border-[rgba(44,12,70,0.9)] bg-[rgba(255,247,224,0.86)] px-5 py-4 text-sm text-[var(--theme-text)] shadow-glow">
                Public-profile dashboard mode is active. SoundScope is showing only the Spotify data that is available from the public profile link on your account.
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
