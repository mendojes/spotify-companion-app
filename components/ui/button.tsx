import { ArrowUpRight } from "lucide-react";
import { clsx } from "clsx";
import Link from "next/link";

type ButtonProps = {
  href?: string;
  children: React.ReactNode;
  variant?: "primary" | "ghost";
  className?: string;
};

export function Button({ href, children, variant = "primary", className }: ButtonProps) {
  const classes = clsx(
    "inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-medium uppercase tracking-[0.22em] transition duration-300 hover:-translate-y-0.5",
    variant === "primary"
      ? "neon-outline bg-[linear-gradient(135deg,rgba(255,214,243,0.95),rgba(255,94,201,0.95)_32%,rgba(110,130,255,0.95)_68%,rgba(122,247,255,0.95))] text-[#170718]"
      : "chrome-line bg-white/[0.06] text-ink backdrop-blur-sm hover:border-cyan/50 hover:bg-cobalt/20 hover:text-white",
    className,
  );

  if (href) {
    if (href.startsWith("/api/")) {
      return (
        <a href={href} className={classes}>
          {children}
          <ArrowUpRight className="h-4 w-4" />
        </a>
      );
    }

    return (
      <Link href={href} className={classes}>
        {children}
        <ArrowUpRight className="h-4 w-4" />
      </Link>
    );
  }

  return <button className={classes}>{children}</button>;
}
