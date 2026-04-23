import Link from "next/link";
import { Disc3, LayoutGrid, Settings2, Sparkles, Users } from "lucide-react";
import { DashboardView } from "@/components/dashboard-view";
import { Hero } from "@/components/hero";
import { SpotifyComplianceNote } from "@/components/spotify-compliance-note";
import { ThemeToggle } from "@/components/theme-toggle";
import { getSession, hasSpotifyConnection } from "@/lib/auth";

type HomeProps = {
  searchParams: Promise<{ auth_error?: string }>;
};

export default async function Home({ searchParams }: HomeProps) {
  const session = await getSession();
  const { auth_error: authError } = await searchParams;
  const spotifyConnected = hasSpotifyConnection(session);
  const navLinks = [
    { href: "#dashboard", label: "Preview", icon: LayoutGrid, show: true },
    {
      href: session ? "/dashboard" : "/login",
      label: session ? (spotifyConnected ? "Open dashboard" : "Open limited mode") : "Sign in",
      icon: Sparkles,
      show: true,
    },
    { href: "/social", label: "Social", icon: Users, show: spotifyConnected },
    { href: "/settings", label: spotifyConnected ? "Settings" : "Account", icon: Settings2, show: Boolean(session) },
    { href: "/api/auth/logout", label: "Log out", icon: Disc3, show: Boolean(session) },
    { href: "/privacy", label: "Privacy", icon: Disc3, show: true },
  ].filter((link) => link.show);

  return (
    <main className="city-pop-shell relative overflow-hidden pb-12">
      <nav className="sticky top-0 z-40 border-b-[3px] border-[rgba(44,12,70,0.9)] bg-[rgba(255,240,253,0.72)] px-4 py-4 backdrop-blur-2xl sm:px-6 md:px-10">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 md:flex-row md:flex-wrap md:items-center md:justify-between">
          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            <div className="neon-outline flex h-12 w-12 shrink-0 items-center justify-center rounded-[18px] border-[3px] border-[rgba(44,12,70,0.9)] bg-[linear-gradient(135deg,#fff8ff,#ff97e8_44%,#87f2ff)] font-display text-base font-bold uppercase tracking-[0.18em] text-[#2d0d46] sm:h-14 sm:w-14 sm:rounded-[20px] sm:text-lg">
              LL
            </div>
            <div className="min-w-0">
              <p className="truncate font-display text-xl uppercase tracking-[0.12em] text-[var(--theme-title)] sm:text-2xl md:text-3xl">Listening Lore</p>
              <p className="text-sm uppercase tracking-[0.16em] text-[var(--theme-muted)] sm:font-mono sm:text-base md:text-lg md:tracking-[0.22em]">spotify listening insights dashboard</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 md:justify-end">
            <ThemeToggle />
            <div className="flex w-full flex-wrap items-center gap-2 md:w-auto md:justify-end md:gap-3">
              {navLinks.map((link) => {
                const Icon = link.icon;
                const isAnchor = link.href.startsWith("#") || link.href.startsWith("/api/");

                if (isAnchor) {
                  return (
                    <a key={link.href} className="pixel-chip inline-flex min-h-11 items-center gap-2 px-3 text-xs text-[#5b2a86] transition hover:text-[#2d0d46] sm:px-4 sm:text-sm" href={link.href}>
                      <Icon className="h-4 w-4" /> {link.label}
                    </a>
                  );
                }

                return (
                  <Link key={link.href} className="pixel-chip inline-flex min-h-11 items-center gap-2 px-3 text-xs text-[#5b2a86] transition hover:text-[#2d0d46] sm:px-4 sm:text-sm" href={link.href}>
                    <Icon className="h-4 w-4" /> {link.label}
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      </nav>
      {authError ? (
        <div className="px-4 pt-6 sm:px-6 md:px-10">
          <div className="mx-auto max-w-7xl rounded-[24px] border-[3px] border-[rgba(44,12,70,0.9)] bg-[rgba(255,233,246,0.86)] px-5 py-4 text-sm text-[var(--theme-text)] shadow-glow">
            <div className="inline-flex items-center gap-2 font-mono uppercase tracking-[0.16em]">
              <Disc3 className="h-4 w-4 text-[var(--theme-accent)]" /> Spotify authentication did not complete: {authError.replaceAll("_", " ")}.
            </div>
          </div>
        </div>
      ) : null}
      <Hero isAuthenticated={Boolean(session)} />
      <div className="px-4 pt-4 sm:px-6 md:px-10">
        <div className="mx-auto max-w-7xl">
          <SpotifyComplianceNote compact />
        </div>
      </div>
      <DashboardView mode="preview" />
    </main>
  );
}

