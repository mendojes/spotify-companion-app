"use client";

import { motion } from "framer-motion";
import { Sparkles, Waves, Music4 } from "lucide-react";
import { heroStats } from "@/lib/mock-data";
import { Button } from "@/components/ui/button";

type HeroProps = {
  isAuthenticated?: boolean;
};

export function Hero({ isAuthenticated = false }: HeroProps) {
  return (
    <section className="relative overflow-hidden px-6 pb-20 pt-8 md:px-10 md:pb-28">
      <div className="mx-auto max-w-7xl">
        <div className="glass-panel relative overflow-hidden rounded-[32px] px-6 py-8 md:px-10 md:py-12">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan/60 to-transparent" />
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="grid gap-10 lg:grid-cols-[1.15fr_0.85fr]"
          >
            <div className="space-y-8">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-ink/80">
                <Sparkles className="h-4 w-4 text-gold" />
                On-demand listening intelligence for Spotify power users
              </div>
              <div className="space-y-5">
                <h1 className="max-w-4xl font-display text-5xl font-semibold tracking-tight text-white md:text-7xl">
                  Your Spotify history deserves more than a once-a-year slideshow.
                </h1>
                <p className="max-w-2xl text-lg leading-8 text-ink/80 md:text-xl">
                  SoundScope transforms recent plays, top tracks, and buried favorites into a vivid
                  control room for moods, genres, and rediscovery.
                </p>
              </div>
              <div className="flex flex-wrap gap-4">
                <Button href={isAuthenticated ? "/dashboard" : "/login"}>
                  {isAuthenticated ? "Open your dashboard" : "Connect Spotify"}
                </Button>
                <Button href="#dashboard" variant="ghost">
                  Explore the preview
                </Button>
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                {heroStats.map((stat) => (
                  <div
                    key={stat.label}
                    className="rounded-3xl border border-white/10 bg-white/[0.03] p-4"
                  >
                    <p className="text-sm text-ink/60">{stat.label}</p>
                    <p className="mt-3 font-display text-2xl text-white">{stat.value}</p>
                    <p className="mt-1 text-sm text-mint">{stat.delta}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="relative flex min-h-[420px] items-center justify-center">
              <div className="data-ring absolute h-[320px] w-[320px] rounded-full opacity-80 blur-[1px]" />
              <motion.div
                animate={{ y: [0, -14, 0] }}
                transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
                className="glass-panel relative w-full max-w-md rounded-[30px] p-6 shadow-glow"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm uppercase tracking-[0.28em] text-cyan/70">Live vibe</p>
                    <h2 className="mt-2 font-display text-2xl text-white">Friday pulse check</h2>
                  </div>
                  <div className="rounded-full border border-white/10 bg-white/5 p-3">
                    <Waves className="h-5 w-5 text-cyan" />
                  </div>
                </div>
                <div className="mt-8 grid gap-4">
                  <div className="rounded-3xl border border-cyan/20 bg-cyan/10 p-4">
                    <p className="text-sm text-cyan/80">Dominant mood</p>
                    <p className="mt-2 font-display text-3xl text-white">Energetic bloom</p>
                    <p className="mt-1 text-sm text-ink/70">Tempo up 14%, danceability up 9%</p>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
                      <p className="text-sm text-ink/60">Genre spread</p>
                      <p className="mt-2 font-display text-xl text-white">Alt-pop / Neo-soul</p>
                    </div>
                    <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
                      <p className="text-sm text-ink/60">Forgotten pull</p>
                      <p className="mt-2 font-display text-xl text-white">4 tracks resurfaced</p>
                    </div>
                  </div>
                </div>
                <div className="mt-8 flex items-center gap-3 rounded-3xl border border-white/10 bg-white/[0.04] p-4">
                  <Music4 className="h-10 w-10 rounded-2xl bg-coral/15 p-2 text-coral" />
                  <div>
                    <p className="text-sm text-ink/70">Next up in your rediscovery queue</p>
                    <p className="font-medium text-white">Ribs - Lorde</p>
                  </div>
                </div>
              </motion.div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
