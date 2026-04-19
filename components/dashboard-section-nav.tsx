"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const sections = [
  { href: "/dashboard", label: "Overview", match: (pathname: string) => pathname === "/dashboard" },
  { href: "/dashboard/analysis", label: "Analysis", match: (pathname: string) => pathname.startsWith("/dashboard/analysis") },
  { href: "/dashboard/top-lists", label: "Top Lists", match: (pathname: string) => pathname.startsWith("/dashboard/top-lists") },
  { href: "/dashboard/rediscovery", label: "Rediscovery", match: (pathname: string) => pathname.startsWith("/dashboard/rediscovery") },
  { href: "/dashboard/playlists", label: "Playlists", match: (pathname: string) => pathname.startsWith("/dashboard/playlists") },
  { href: "/dashboard/recent", label: "Recent", match: (pathname: string) => pathname.startsWith("/dashboard/recent") },
];

export function DashboardSectionNav() {
  const pathname = usePathname();

  return (
    <div className="flex flex-wrap gap-3">
      {sections.map((section) => {
        const active = section.match(pathname);

        return (
          <Link
            key={section.href}
            href={section.href}
            className={`rounded-full px-4 py-2 font-mono text-sm uppercase tracking-[0.16em] transition ${
              active
                ? "neon-outline bg-[linear-gradient(135deg,rgba(255,214,243,0.95),rgba(255,94,201,0.95)_32%,rgba(110,130,255,0.95)_68%,rgba(122,247,255,0.95))] text-[#170718]"
                : "chrome-line bg-white/[0.05] text-ink/82 hover:border-cyan/40 hover:text-white"
            }`}
          >
            {section.label}
          </Link>
        );
      })}
    </div>
  );
}
