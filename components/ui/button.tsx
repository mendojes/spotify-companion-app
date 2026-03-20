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
    "inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-medium transition-transform duration-300 hover:-translate-y-0.5",
    variant === "primary"
      ? "bg-white text-slate-950 shadow-[0_14px_50px_rgba(255,255,255,0.18)]"
      : "border border-white/15 bg-white/5 text-white backdrop-blur-sm",
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
