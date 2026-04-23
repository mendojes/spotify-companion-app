"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function DashboardSectionNav({ spotifyConnected = true }: { spotifyConnected?: boolean }) {
  const pathname = usePathname();
  const sections = [
    { href: "/dashboard", label: "Overview", match: (value: string) => value === "/dashboard" },
    ...(spotifyConnected
      ? [
        { href: "/dashboard/top-lists", label: "Top Lists", match: (value: string) => value.startsWith("/dashboard/top-lists") },
        { href: "/dashboard/analysis", label: "Analysis", match: (value: string) => value.startsWith("/dashboard/analysis") },
      ]
      : []),
    { href: "/dashboard/playlists", label: "Playlists", match: (value: string) => value.startsWith("/dashboard/playlists") },
    ...(spotifyConnected
      ? [
        { href: "/dashboard/rediscovery", label: "Rediscovery", match: (value: string) => value.startsWith("/dashboard/rediscovery") },
      ]
      : []),
    { href: "/dashboard/favorite-picker", label: "Favorite Picker", match: (value: string) => value.startsWith("/dashboard/favorite-picker") },
    ...(spotifyConnected
      ? [
        { href: "/dashboard/recent", label: "Recent", match: (value: string) => value.startsWith("/dashboard/recent") },
      ]
      : []),
  ];

  return (
    <div className="flex flex-wrap gap-2 sm:gap-3">
      {sections.map((section) => {
        const active = section.match(pathname);

        return (
          <Link
            key={section.href}
            href={section.href}
            className={`rounded-full px-3 py-2 text-xs uppercase tracking-[0.14em] transition sm:px-4 sm:text-sm sm:tracking-[0.16em] ${
              active
                ? "neon-outline bg-[linear-gradient(135deg,rgba(255,214,243,0.95),rgba(255,94,201,0.95)_32%,rgba(110,130,255,0.95)_68%,rgba(122,247,255,0.95))] text-[#170718]"
                : "chrome-line bg-white/[0.18] text-[var(--theme-text)] hover:border-cyan/40 hover:text-[var(--theme-title)]"
            }`}
          >
            {section.label}
          </Link>
        );
      })}
    </div>
  );
}
