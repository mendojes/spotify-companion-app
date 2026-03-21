import { DashboardView } from "@/components/dashboard-view";
import { Hero } from "@/components/hero";
import { getSession } from "@/lib/auth";

type HomeProps = {
  searchParams: Promise<{ auth_error?: string }>;
};

export default async function Home({ searchParams }: HomeProps) {
  const session = await getSession();
  const { auth_error: authError } = await searchParams;

  return (
    <main className="city-pop-shell relative overflow-hidden pb-12">
      <nav className="sticky top-0 z-40 border-b border-white/10 bg-night/60 px-6 py-4 backdrop-blur-2xl md:px-10">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="neon-outline flex h-14 w-14 items-center justify-center rounded-[20px] bg-[linear-gradient(135deg,rgba(255,214,243,0.95),rgba(255,94,201,0.95)_32%,rgba(110,130,255,0.95)_68%,rgba(122,247,255,0.95))] font-display text-lg font-bold uppercase tracking-[0.18em] text-[#170718]">
              SS
            </div>
            <div>
              <p className="font-display text-2xl uppercase tracking-[0.14em] text-white md:text-3xl">SoundScope</p>
              <p className="font-mono text-lg uppercase tracking-[0.28em] text-ink/55">vaporwave spotify companion</p>
            </div>
          </div>
          <div className="hidden items-center gap-3 md:flex">
            <a className="pixel-chip text-cyan transition hover:text-white" href="#dashboard">Preview</a>
            <a className="pixel-chip text-coral transition hover:text-white" href="#roadmap">Roadmap</a>
            <a className="pixel-chip text-gold transition hover:text-white" href={session ? "/dashboard" : "/login"}>
              {session ? "Open dashboard" : "Connect Spotify"}
            </a>
          </div>
        </div>
      </nav>
      {authError ? (
        <div className="px-6 pt-6 md:px-10">
          <div className="mx-auto max-w-7xl rounded-[24px] border border-coral/40 bg-coral/10 px-5 py-4 text-sm text-ink/90 shadow-glow">
            Spotify authentication did not complete: {authError.replaceAll("_", " ")}.
          </div>
        </div>
      ) : null}
      <Hero isAuthenticated={Boolean(session)} />
      <DashboardView mode="preview" />
    </main>
  );
}
