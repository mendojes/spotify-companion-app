import Image from "next/image";
import Link from "next/link";

type SpotifyComplianceNoteProps = {
  compact?: boolean;
};

export function SpotifyComplianceNote({ compact = false }: SpotifyComplianceNoteProps) {
  const logoWidth = compact ? 154 : 182;
  const logoHeight = compact ? 47 : 56;

  return (
    <div className={`rounded-[24px] border-[3px] border-[rgba(44,12,70,0.9)] bg-[rgba(255,247,224,0.82)] text-[var(--theme-text)] shadow-glow ${compact ? "px-4 py-3 text-sm" : "px-5 py-4 text-sm leading-7"}`}>
      <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center">
        <div
          className={`flex w-full items-center justify-center rounded-[18px] bg-white/80 ring-1 ring-[rgba(44,12,70,0.08)] sm:w-auto ${compact ? "min-h-[70px] px-4 py-3 sm:min-w-[198px] sm:px-5" : "min-h-[82px] px-5 py-4 sm:min-w-[228px] sm:px-6"}`}
          aria-label="Spotify attribution logo"
        >
          <Image
            src="/spotify-full-logo-black-rgb.svg"
            alt="Spotify"
            width={logoWidth}
            height={logoHeight}
            className="h-auto w-auto max-w-full"
            priority={false}
          />
        </div>
        <p className="max-w-3xl">
          Artwork and metadata are provided by Spotify. Listening Lore displays Spotify visual content in its original form and is an independent app, not affiliated with or endorsed by Spotify.
        </p>
      </div>
      <p className={compact ? "mt-2 leading-6" : "mt-3 leading-7"}>
        <Link href="/privacy" className="font-medium underline underline-offset-4">
          Privacy and data controls
        </Link>
        {" · "}
        <a
          href="https://developer.spotify.com/terms"
          target="_blank"
          rel="noreferrer"
          className="font-medium underline underline-offset-4"
        >
          Spotify Developer Terms
        </a>
        {" · "}
        <a
          href="https://developer.spotify.com/documentation/design"
          target="_blank"
          rel="noreferrer"
          className="font-medium underline underline-offset-4"
        >
          Spotify Design Guidelines
        </a>
      </p>
    </div>
  );
}
