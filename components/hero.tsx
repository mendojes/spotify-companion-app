"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import { ArrowRight, Heart, ImageIcon, Music4, Play, Search, SmilePlus, Sparkles, Star, Waves, Zap } from "lucide-react";
import { heroStats, playlistInsights, previewTopLists } from "@/lib/mock-data";
import { Button } from "@/components/ui/button";

type HeroProps = {
  isAuthenticated?: boolean;
};

const featuredTracks = previewTopLists.tracks.slice(0, 3);
const featuredPlaylist = playlistInsights[0];
const desktopShortcuts = [
  { label: "mood map", icon: Heart },
  { label: "cover wall", icon: ImageIcon },
  { label: "play now", icon: Play },
  { label: "search", icon: Search },
];

export function Hero({ isAuthenticated = false }: HeroProps) {
  return (
    <section className="relative overflow-hidden px-6 pb-18 pt-10 md:px-10 md:pb-24 md:pt-12">
      <div className="dashboard-mesh" />
      <div className="orbital-orb left-[5%] top-24 h-36 w-36 bg-[#ff9be9]" />
      <div className="orbital-orb right-[8%] top-32 h-40 w-40 bg-[#9af2ff]" />
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="marquee-strip rounded-full px-4 py-2 font-mono text-lg uppercase tracking-[0.18em] text-[#572282]">
          <div>
            <span>pastel desktop pop</span>
            <span>spotify scrapbook</span>
            <span>album-art collage</span>
            <span>playlist toybox</span>
            <span>retro browser energy</span>
            <span>pastel desktop pop</span>
            <span>spotify scrapbook</span>
            <span>album-art collage</span>
          </div>
        </div>

        <div className="glass-panel scan-lines rounded-[42px] px-6 py-8 md:px-10 md:py-10 xl:px-12">
          <div className="grid gap-10 xl:grid-cols-[1.02fr_0.98fr]">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease: "easeOut" }}
              className="relative z-10 space-y-8"
            >
              <div className="flex flex-wrap gap-3">
                <div className="holo-badge inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm text-[var(--theme-text)]">
                  <SmilePlus className="h-4 w-4 text-[var(--theme-accent)]" />
                  pastel web shrine for your spotify life
                </div>
                <div className="holo-badge inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm text-[var(--theme-text)]">
                  <Star className="h-4 w-4 text-[var(--theme-highlight)]" />
                  cute chrome windows and image walls
                </div>
              </div>

              <div className="space-y-5">
                <p className="section-kicker">Desktop fantasy mode</p>
                <h1 className="max-w-4xl font-display text-5xl font-black uppercase leading-[0.9] tracking-[0.08em] text-[var(--theme-title)] md:text-7xl xl:text-[5.5rem]">
                  Turn your listening history into a <span className="gradient-text">pink little internet bedroom</span>.
                </h1>
                <p className="max-w-2xl text-lg leading-8 text-[var(--theme-body)] md:text-xl">
                  SoundScope now leans into floating browser windows, giant cover art, playful controls, and collectible widgets so the whole app feels more like a saved Tumblr desktop than a stats report.
                </p>
              </div>

              <div className="flex flex-wrap gap-4">
                <Button href={isAuthenticated ? "/dashboard" : "/login"}>{isAuthenticated ? "Open your dashboard" : "Connect Spotify"}</Button>
                <Button href="#dashboard" variant="ghost">
                  Explore the preview
                </Button>
              </div>

              <div className="grid gap-4 md:grid-cols-[1.15fr_0.85fr]">
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
                      <p className="mt-2 text-sm leading-7 text-[var(--theme-body)]">big art, soft chrome, dreamy listening notes, and a little fake-operating-system drama.</p>
                    </div>
                    <div className="sticker-badge inline-flex items-center gap-2 px-4 py-3 font-mono text-sm uppercase tracking-[0.18em] text-[var(--theme-badge)]">
                      <Zap className="h-4 w-4 text-[var(--theme-highlight)]" />
                      fresh cache
                    </div>
                  </div>
                </div>

                <div className="grid gap-4">
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

            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: "easeOut", delay: 0.12 }}
              className="relative min-h-[620px]"
            >
              <div className="absolute -left-2 top-6 sticker-badge rotate-[-8deg] px-4 py-2 font-mono text-sm uppercase tracking-[0.2em] text-[var(--theme-badge)]">
                hello playlist!
              </div>
              <div className="absolute right-2 top-2 sticker-badge rotate-[6deg] px-4 py-2 font-mono text-sm uppercase tracking-[0.2em] text-[var(--theme-badge)]">
                cover overload
              </div>

              <div className="grid gap-4 lg:grid-cols-[1.08fr_0.92fr]">
                <div className="space-y-4 pt-10">
                  <div className="window-panel p-4 pt-14">
                    <div className="mb-4 flex items-center justify-between gap-3 text-[var(--theme-text)]">
                      <div className="flex items-center gap-2 rounded-full border-2 border-[rgba(57,18,98,0.26)] bg-white/60 px-3 py-1.5 font-mono text-sm uppercase tracking-[0.14em]">
                        <Search className="h-4 w-4 text-[var(--theme-highlight)]" />
                        search your moodboard
                      </div>
                      <div className="icon-bubble h-10 w-10 text-[var(--theme-accent)]">
                        <Sparkles className="h-4 w-4" />
                      </div>
                    </div>
                    <div className="media-frame relative h-[300px] p-2">
                      <Image src={featuredTracks[0].imageUrl!} alt={featuredTracks[0].title} fill sizes="(max-width: 1280px) 100vw, 420px" className="rounded-[18px] object-cover p-1.5" />
                      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(58,19,89,0.14)_40%,rgba(58,19,89,0.74))]" />
                      <div className="absolute bottom-5 left-5 right-5 rounded-[22px] border-2 border-white/35 bg-[rgba(255,245,255,0.72)] p-4 text-[#441a68] backdrop-blur-sm">
                        <p className="section-kicker">featured now</p>
                        <p className="mt-2 font-display text-3xl uppercase tracking-[0.08em] text-[var(--theme-title)]">{featuredTracks[0].title}</p>
                        <p className="mt-1 font-mono text-base uppercase tracking-[0.16em] text-[var(--theme-muted)]">{featuredTracks[0].artist}</p>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    {featuredTracks.slice(1).map((track) => (
                      <div key={track.id} className="desktop-card overflow-hidden p-3 text-[var(--theme-text)]">
                        <div className="media-frame relative h-40 p-1.5">
                          <Image src={track.imageUrl!} alt={track.title} fill sizes="(max-width: 1280px) 50vw, 220px" className="rounded-[16px] object-cover p-1" />
                        </div>
                        <div className="mt-3 flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-display text-xl uppercase tracking-[0.08em] text-[var(--theme-title)]">{track.title}</p>
                            <p className="mt-1 text-sm uppercase tracking-[0.16em] text-[var(--theme-muted)]">{track.artist}</p>
                          </div>
                          <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-[var(--theme-accent)]" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
                    {desktopShortcuts.map((item, index) => (
                      <div key={item.label} className={`desktop-card flex items-center gap-3 p-4 text-[var(--theme-text)] ${index % 2 === 0 ? "rotate-[-2deg]" : "rotate-[2deg]"}`}>
                        <div className="icon-bubble h-12 w-12 text-[var(--theme-accent)]">
                          <item.icon className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="font-display text-lg uppercase tracking-[0.08em] text-[var(--theme-title)]">{item.label}</p>
                          <p className="text-xs uppercase tracking-[0.16em] text-[var(--theme-muted)]">open widget</p>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="window-panel p-5 pt-14 text-[var(--theme-text)]">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="section-kicker">Playlist window</p>
                        <h3 className="mt-1 font-display text-3xl uppercase tracking-[0.08em] text-[var(--theme-title)]">{featuredPlaylist.name}</h3>
                      </div>
                      <div className="icon-bubble h-11 w-11 text-[var(--theme-highlight)]">
                        <Music4 className="h-5 w-5" />
                      </div>
                    </div>
                    <div className="mt-5 grid gap-4">
                      <div className="media-frame relative h-44 p-2">
                        <Image src={featuredPlaylist.imageUrl!} alt={featuredPlaylist.name} fill sizes="(max-width: 1280px) 100vw, 300px" className="rounded-[18px] object-cover p-1.5" />
                      </div>
                      <div className="grid gap-3">
                        <div className="soft-panel rounded-[20px] px-4 py-3">
                          <p className="font-mono text-sm uppercase tracking-[0.16em] text-[var(--theme-muted)]">mood</p>
                          <p className="mt-1 text-[var(--theme-title)]">{featuredPlaylist.mood}</p>
                        </div>
                        <div className="soft-panel rounded-[20px] px-4 py-3">
                          <p className="font-mono text-sm uppercase tracking-[0.16em] text-[var(--theme-muted)]">diversity</p>
                          <p className="mt-1 text-[var(--theme-title)]">{featuredPlaylist.diversity}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  );
}
