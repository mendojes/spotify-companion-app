"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import { Sparkles, Waves, Music4, RadioTower, Stars, Disc3, Headphones, HeartPulse } from "lucide-react";
import { heroStats, playlistInsights, previewTopLists } from "@/lib/mock-data";
import { Button } from "@/components/ui/button";

type HeroProps = {
  isAuthenticated?: boolean;
};

const collageCards = [
  previewTopLists.tracks[0],
  previewTopLists.tracks[1],
  previewTopLists.tracks[2],
  playlistInsights[0],
];

export function Hero({ isAuthenticated = false }: HeroProps) {
  return (
    <section className="relative overflow-hidden px-6 pb-16 pt-10 md:px-10 md:pb-24 md:pt-12">
      <div className="dashboard-mesh" />
      <div className="orbital-orb left-[8%] top-32 h-28 w-28 bg-coral/30" />
      <div className="orbital-orb right-[10%] top-40 h-32 w-32 bg-cyan/30" />
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="marquee-strip rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 font-mono text-lg uppercase tracking-[0.22em] text-ink/80">
          <div>
            <span>Y2K signal online</span>
            <span>chrome widgets</span>
            <span>playlist dreamscape</span>
            <span>spotify memory palace</span>
            <span>neon archive mode</span>
            <span>Y2K signal online</span>
            <span>chrome widgets</span>
            <span>playlist dreamscape</span>
            <span>spotify memory palace</span>
            <span>neon archive mode</span>
          </div>
        </div>

        <div className="glass-panel scan-lines rounded-[40px] px-6 py-8 md:px-10 md:py-10 xl:px-12">
          <div className="absolute inset-x-0 top-0 h-20 bg-[linear-gradient(180deg,rgba(255,255,255,0.22),transparent)]" />
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="grid gap-10 xl:grid-cols-[1.02fr_0.98fr]"
          >
            <div className="relative z-10 space-y-8">
              <div className="flex flex-wrap gap-3">
                <div className="holo-badge inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm text-ink/90">
                  <Sparkles className="h-4 w-4 text-gold" />
                  Hyperpop dashboards for Spotify obsessives
                </div>
                <div className="holo-badge inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm text-cyan">
                  <Stars className="h-4 w-4" />
                  Retro web magazine energy
                </div>
              </div>

              <div className="space-y-5">
                <p className="section-kicker">Future nostalgia interface</p>
                <h1 className="max-w-4xl font-display text-5xl font-black uppercase leading-[0.9] tracking-[0.08em] text-white md:text-7xl xl:text-[5.6rem]">
                  Your listening history deserves a <span className="gradient-text">mall-soft dream machine</span>.
                </h1>
                <p className="max-w-2xl text-lg leading-8 text-ink/78 md:text-xl">
                  SoundScope turns stats into a shiny collage of album art, chrome widgets, floating tags, and club-night color.
                  It should feel like opening a saved internet shrine, not a dashboard template.
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
                {heroStats.map((stat, index) => {
                  const icons = [Headphones, Disc3, HeartPulse];
                  const Icon = icons[index % icons.length];

                  return (
                    <div key={stat.label} className="window-panel p-5 pt-14">
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-mono text-lg uppercase tracking-[0.18em] text-ink/70">{stat.label}</p>
                        <Icon className="h-5 w-5 text-cyan" />
                      </div>
                      <p className="mt-4 font-display text-2xl uppercase tracking-[0.06em] text-white md:text-3xl">{stat.value}</p>
                      <p className="mt-2 text-sm text-peach">{stat.delta}</p>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="relative min-h-[560px]">
              <div className="absolute -left-6 top-8 rounded-full border border-white/20 bg-white/10 px-4 py-2 font-mono text-lg uppercase tracking-[0.2em] text-white backdrop-blur-md">
                archived glow
              </div>
              <div className="absolute right-0 top-0 rounded-full border border-cyan/30 bg-cyan/10 px-4 py-2 font-mono text-lg uppercase tracking-[0.2em] text-cyan backdrop-blur-md">
                playlist magazine
              </div>

              <div className="grid h-full gap-4 md:grid-cols-[1.05fr_0.95fr]">
                <div className="space-y-4">
                  <div className="media-frame relative h-[260px] p-2">
                    <Image
                      src={collageCards[0].imageUrl ?? collageCards[1].imageUrl ?? previewTopLists.tracks[0].imageUrl!}
                      alt={previewTopLists.tracks[0].title}
                      fill
                      sizes="(max-width: 1280px) 100vw, 420px"
                      className="object-cover p-2 rounded-[20px]"
                    />
                    <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent,rgba(11,4,18,0.1)_35%,rgba(11,4,18,0.8))]" />
                    <div className="absolute bottom-6 left-6 right-6 rounded-[22px] border border-white/20 bg-black/25 p-4 backdrop-blur-md">
                      <p className="section-kicker">Spotlight track</p>
                      <p className="mt-2 font-display text-3xl uppercase tracking-[0.08em] text-white">{previewTopLists.tracks[0].title}</p>
                      <p className="mt-1 text-sm uppercase tracking-[0.22em] text-ink/80">{previewTopLists.tracks[0].artist}</p>
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    {collageCards.slice(1, 3).map((item, index) => (
                      <div key={item.id} className="media-frame relative h-[180px] p-2">
                        <Image
                          src={item.imageUrl ?? previewTopLists.tracks[index + 1].imageUrl!}
                          alt={"title" in item ? item.title : item.name}
                          fill
                          sizes="(max-width: 1280px) 50vw, 240px"
                          className="object-cover p-2 rounded-[20px]"
                        />
                        <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent,rgba(11,4,18,0.78))]" />
                        <div className="absolute bottom-5 left-5 right-5">
                          <p className="font-display text-xl uppercase tracking-[0.08em] text-white">{"title" in item ? item.title : item.name}</p>
                          <p className="mt-1 font-mono text-lg uppercase tracking-[0.16em] text-cyan/90">{"artist" in item ? item.artist : item.mood}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-4 pt-10 md:pt-16">
                  <motion.div
                    animate={{ y: [0, -10, 0] }}
                    transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
                    className="window-panel p-5 pt-14"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="section-kicker">Radio capsule</p>
                        <h2 className="mt-2 font-display text-3xl uppercase tracking-[0.08em] text-white">Friday night drive</h2>
                      </div>
                      <div className="rounded-full border border-cyan/25 bg-cyan/10 p-3 text-cyan">
                        <Waves className="h-5 w-5" />
                      </div>
                    </div>
                    <div className="mt-5 space-y-4">
                      <div className="rounded-[24px] border border-white/12 bg-white/[0.05] p-4">
                        <p className="font-mono text-lg uppercase tracking-[0.18em] text-ink/70">Dominant vibe</p>
                        <p className="mt-2 font-display text-3xl uppercase tracking-[0.08em] text-white">Ocean glow</p>
                        <p className="mt-2 text-sm leading-7 text-ink/78">
                          Sleek synth sheen, reflective vocals, and a brighter late-night pulse than last week.
                        </p>
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="rounded-[24px] border border-coral/20 bg-coral/10 p-4">
                          <p className="font-mono text-lg uppercase tracking-[0.16em] text-coral/90">Genre stack</p>
                          <p className="mt-2 text-white">City pop / disco / dream pop</p>
                        </div>
                        <div className="rounded-[24px] border border-gold/20 bg-gold/10 p-4">
                          <p className="font-mono text-lg uppercase tracking-[0.16em] text-gold/90">Rediscovery cue</p>
                          <p className="mt-2 text-white">5 buried favorites ready</p>
                        </div>
                      </div>
                    </div>
                  </motion.div>

                  <div className="glass-panel rounded-[30px] p-5">
                    <div className="flex items-center gap-3">
                      <Music4 className="h-8 w-8 rounded-2xl border border-white/15 bg-white/10 p-2 text-cyan" />
                      <div>
                        <p className="section-kicker">On deck</p>
                        <p className="font-display text-2xl uppercase tracking-[0.08em] text-white">Ribs - Lorde</p>
                      </div>
                    </div>
                    <div className="mt-5 grid grid-cols-10 items-end gap-2">
                      {[42, 96, 58, 84, 68, 112, 76, 88, 64, 106].map((height, index) => (
                        <div
                          key={`${height}-${index}`}
                          className="rounded-t-[999px] bg-[linear-gradient(180deg,rgba(255,214,243,0.95),rgba(255,94,201,0.92)_25%,rgba(110,130,255,0.92)_72%,rgba(122,247,255,0.92))]"
                          style={{ height: `${height}px` }}
                        />
                      ))}
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <div className="holo-badge flex items-center gap-2 rounded-full px-4 py-2 text-sm uppercase tracking-[0.2em] text-ink/90">
                      <RadioTower className="h-4 w-4 text-gold" />
                      streaming memory archive
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
