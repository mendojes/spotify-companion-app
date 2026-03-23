import Link from "next/link";
import { requireSession } from "@/lib/auth";

export default async function SocialPage() {
  await requireSession();

  return (
    <main className="relative overflow-hidden px-6 py-10 md:px-10">
      <div className="mx-auto max-w-7xl space-y-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-3xl space-y-3">
            <p className="text-sm uppercase tracking-[0.3em] text-gold/75">Community</p>
            <h1 className="font-display text-5xl text-[var(--theme-title)] md:text-6xl">Public profile sharing is currently disabled.</h1>
            <p className="text-base leading-7 text-ink/80">SoundScope no longer exposes other listeners&apos; cached Spotify dashboards by default. This keeps the app closer to Spotify&apos;s data-minimization expectations while an explicit opt-in sharing flow is designed.</p>
          </div>
          <Link href="/dashboard" className="rounded-full border border-ink/15 bg-white/5 px-4 py-2 text-sm text-ink transition hover:border-gold/25 hover:text-gold">
            Back to dashboard
          </Link>
        </div>

        <div className="glass-panel rounded-[34px] p-10 text-center text-ink/70">
          Use your private dashboard and the privacy page to manage Spotify-connected data for your own account.
        </div>
      </div>
    </main>
  );
}

