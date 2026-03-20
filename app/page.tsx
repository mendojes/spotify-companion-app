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
    <main className="relative overflow-hidden">
      <nav className="sticky top-0 z-40 border-b border-white/10 bg-night/70 px-6 py-4 backdrop-blur-xl md:px-10">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <div>
            <p className="font-display text-xl text-white">SoundScope</p>
            <p className="text-xs uppercase tracking-[0.24em] text-ink/50">Spotify analytics companion</p>
          </div>
          <div className="hidden items-center gap-6 text-sm text-ink/75 md:flex">
            <a href="#dashboard">Preview</a>
            <a href="#roadmap">Roadmap</a>
            <a href={session ? "/dashboard" : "/login"}>{session ? "Open dashboard" : "Connect Spotify"}</a>
          </div>
        </div>
      </nav>
      {authError ? (
        <div className="px-6 pt-6 md:px-10">
          <div className="mx-auto max-w-7xl rounded-[24px] border border-coral/30 bg-coral/10 px-5 py-4 text-sm text-ink/85">
            Spotify authentication did not complete: {authError.replaceAll("_", " ")}.
          </div>
        </div>
      ) : null}
      <Hero isAuthenticated={Boolean(session)} />
      <DashboardView mode="preview" />
    </main>
  );
}
