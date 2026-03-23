import { Disc3, LayoutGrid, Sparkles, Stars } from "lucide-react";
import { DashboardView } from "@/components/dashboard-view";
import { Hero } from "@/components/hero";
import { SpotifyComplianceNote } from "@/components/spotify-compliance-note";
import { ThemeToggle } from "@/components/theme-toggle";
import { getSession } from "@/lib/auth";

type HomeProps = {
  searchParams: Promise<{ auth_error?: string }>;
};

export default async function Home({ searchParams }: HomeProps) {
  const session = await getSession();
  const { auth_error: authError } = await searchParams;

  return (
    <main className="city-pop-shell relative overflow-hidden pb-12">
      <nav className="sticky top-0 z-40 border-b-[3px] border-[rgba(44,12,70,0.9)] bg-[rgba(255,240,253,0.72)] px-6 py-4 backdrop-blur-2xl md:px-10">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="neon-outline flex h-14 w-14 items-center justify-center rounded-[20px] border-[3px] border-[rgba(44,12,70,0.9)] bg-[linear-gradient(135deg,#fff8ff,#ff97e8_44%,#87f2ff)] font-display text-lg font-bold uppercase tracking-[0.18em] text-[#2d0d46]">
              SS
            </div>
            <div>
              <p className="font-display text-2xl uppercase tracking-[0.14em] text-[var(--theme-title)] md:text-3xl">SoundScope</p>
              <p className="font-mono text-lg uppercase tracking-[0.22em] text-[var(--theme-muted)]">cute spotify desktop companion</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <div className="hidden items-center gap-3 md:flex">
              <a className="pixel-chip inline-flex items-center gap-2 text-[#5b2a86] transition hover:text-[#2d0d46]" href="#dashboard">
                <LayoutGrid className="h-4 w-4" /> Preview
              </a>
              <a className="pixel-chip inline-flex items-center gap-2 text-[#5b2a86] transition hover:text-[#2d0d46]" href="#roadmap">
                <Stars className="h-4 w-4" /> Roadmap
              </a>
              <a className="pixel-chip inline-flex items-center gap-2 text-[#5b2a86] transition hover:text-[#2d0d46]" href={session ? "/dashboard" : "/login"}>
                <Sparkles className="h-4 w-4" /> {session ? "Open dashboard" : "Connect Spotify"}
              </a>
              <a className="pixel-chip inline-flex items-center gap-2 text-[#5b2a86] transition hover:text-[#2d0d46]" href="/privacy">
                <Disc3 className="h-4 w-4" /> Privacy
              </a>
            </div>
          </div>
        </div>
      </nav>
      {authError ? (
        <div className="px-6 pt-6 md:px-10">
          <div className="mx-auto max-w-7xl rounded-[24px] border-[3px] border-[rgba(44,12,70,0.9)] bg-[rgba(255,233,246,0.86)] px-5 py-4 text-sm text-[var(--theme-text)] shadow-glow">
            <div className="inline-flex items-center gap-2 font-mono uppercase tracking-[0.16em]">
              <Disc3 className="h-4 w-4 text-[var(--theme-accent)]" /> Spotify authentication did not complete: {authError.replaceAll("_", " ")}.
            </div>
          </div>
        </div>
      ) : null}
      <Hero isAuthenticated={Boolean(session)} />
      <div className="px-6 pt-4 md:px-10">
        <div className="mx-auto max-w-7xl">
          <SpotifyComplianceNote compact />
        </div>
      </div>
      <DashboardView mode="preview" />
    </main>
  );
}

