"use client";

import { Fragment } from "react";
import Image from "next/image";
import { motion } from "framer-motion";
import { Heart, Music4, SmilePlus, Star, Waves, Zap } from "lucide-react";
import { heroStats } from "@/lib/mock-data";
import { Button } from "@/components/ui/button";

type HeroProps = {
  isAuthenticated?: boolean;
};

export function Hero({ isAuthenticated = false }: HeroProps) {
  return (
    <section className="relative overflow-hidden px-6 pb-18 pt-10 md:px-10 md:pb-24 md:pt-12">
      <div className="dashboard-mesh" />
      <div className="orbital-orb left-[5%] top-24 h-36 w-36 bg-[#ff9be9]" />
      <div className="orbital-orb right-[8%] top-32 h-40 w-40 bg-[#9af2ff]" />
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="marquee-strip rounded-full px-4 py-2 font-mono text-lg uppercase tracking-[0.18em] text-[#572282]">
          <div className="marquee-track">
            {[0, 1].map((group) => (
              <div key={group} className="marquee-group" aria-hidden={group === 1}>
                {['spotify insights dashboard', 'recent plays tracking', 'top lists and playlists', 'public profile mode', 'listening history analysis'].map((item) => (
                  <Fragment key={`${group}-${item}`}>
                    <span className="marquee-item">{item}</span>
                    <span className="marquee-separator" aria-hidden="true" />
                  </Fragment>
                ))}
              </div>
            ))}
          </div>
        </div>

        <div className="glass-panel scan-lines rounded-[42px] px-6 py-8 md:px-10 md:py-10 xl:px-12">
          <div>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease: "easeOut" }}
              className="relative z-10 space-y-8"
            >
              <div className="flex flex-wrap gap-3">
                <div className="holo-badge inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm text-[var(--theme-text)]">
                  <SmilePlus className="h-4 w-4 text-[var(--theme-accent)]" />
                  Spotify listening insights
                </div>
                <div className="holo-badge inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm text-[var(--theme-text)]">
                  <Star className="h-4 w-4 text-[var(--theme-highlight)]" />
                  dashboard, playlists, and rediscovery tools
                </div>
              </div>

              <div className="space-y-5">
                <p className="section-kicker">Listening dashboard</p>
                <h1 className="max-w-[72rem] font-display text-5xl font-black uppercase leading-[0.9] tracking-[0.08em] text-[var(--theme-title)] md:text-7xl xl:text-[6.25rem]">
                  Turn your listening history into a <span className="gradient-text">clear Spotify dashboard</span>.
                </h1>
                <p className="max-w-3xl text-lg leading-8 text-[var(--theme-body)] md:text-xl">
                  Sign in to view recent plays, top lists, playlist breakdowns, and rediscovery insights in one place.
                </p>
              </div>

              <div className="flex flex-wrap gap-4">
                <Button href={isAuthenticated ? "/dashboard" : "/login"}>{isAuthenticated ? "Open your dashboard" : "Sign in"}</Button>
                <Button href="#dashboard" variant="ghost">
                  Explore the preview
                </Button>
              </div>

              <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
                <div className="window-panel p-5 pt-14 text-[#441a68]">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="section-kicker">Mood browser</p>
                      <h2 className="mt-1 font-display text-3xl uppercase tracking-[0.08em] text-[var(--theme-title)]">sunset player</h2>
                    </div>
                    <div className="icon-bubble h-11 w-11 text-[var(--theme-accent)]">
                      <Waves className="h-5 w-5" />
                    </div>
                  </div>
                  <div className="mt-5 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
                    <div className="rounded-[24px] border-2 border-[rgba(57,18,98,0.22)] bg-white/50 p-4">
                      <p className="font-mono text-base uppercase tracking-[0.16em] text-[var(--theme-muted)]">currently glowing</p>
                      <p className="mt-2 font-display text-3xl uppercase tracking-[0.08em] text-[var(--theme-title)]">city pop / dreamwave</p>
                      <p className="mt-2 text-sm leading-7 text-[var(--theme-body)]">Recent listening, top lists, and saved favorites.</p>
                    </div>
                    <div className="sticker-badge inline-flex items-center gap-2 px-4 py-3 font-mono text-sm uppercase tracking-[0.18em] text-[var(--theme-badge)]">
                      <Zap className="h-4 w-4 text-[var(--theme-highlight)]" />
                      fresh cache
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  {heroStats.slice(0, 2).map((stat, index) => {
                    const Icon = index === 0 ? Music4 : Heart;
                    return (
                      <div key={stat.label} className="desktop-card p-4 text-[var(--theme-text)]">
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-mono text-base uppercase tracking-[0.16em]">{stat.label}</p>
                          <div className="icon-bubble h-10 w-10 text-[var(--theme-accent)]">
                            <Icon className="h-4 w-4" />
                          </div>
                        </div>
                        <p className="mt-4 font-display text-3xl uppercase tracking-[0.08em] text-[var(--theme-title)]">{stat.value}</p>
                        <p className="mt-2 text-sm text-[var(--theme-muted)]">{stat.delta}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  );
}
