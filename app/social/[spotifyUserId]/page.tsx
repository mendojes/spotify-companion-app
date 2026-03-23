import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { DashboardView } from "@/components/dashboard-view";
import { requireSession } from "@/lib/auth";
import { getCommunityUserProfile } from "@/lib/connected-users";
import { getDashboardInsightsFromHistory } from "@/lib/spotify-dashboard";
import { getSpotifyTopListsFromHistory } from "@/lib/spotify-toplists";
import { DashboardRange, TopListRange } from "@/lib/types";

type SocialProfilePageProps = {
  params: Promise<{ spotifyUserId: string }>;
  searchParams: Promise<{ range?: string; topRange?: string; topFrom?: string; topTo?: string }>;
};

function normalizeRange(value?: string): DashboardRange {
  if (value === "month" || value === "all") return value;
  return "week";
}

function normalizeTopRange(value?: string): TopListRange {
  if (value === "week" || value === "month" || value === "year" || value === "all" || value === "custom") return value;
  return "month";
}

function normalizeDate(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  return value;
}

export default async function SocialProfilePage({ params, searchParams }: SocialProfilePageProps) {
  const session = await requireSession();
  if (!session) redirect("/login");

  const { spotifyUserId } = await params;
  const { range, topRange, topFrom, topTo } = await searchParams;
  const selectedRange = normalizeRange(range);
  const selectedTopRange = normalizeTopRange(topRange);
  const selectedTopFrom = normalizeDate(topFrom);
  const selectedTopTo = normalizeDate(topTo);

  const [profile, insights, topLists, heroTopLists] = await Promise.all([
    getCommunityUserProfile(spotifyUserId),
    getDashboardInsightsFromHistory(spotifyUserId, selectedRange),
    getSpotifyTopListsFromHistory(spotifyUserId, selectedTopRange, undefined, selectedTopFrom, selectedTopTo),
    getSpotifyTopListsFromHistory(spotifyUserId, selectedRange === "month" ? "month" : selectedRange === "all" ? "all" : "week"),
  ]);

  if (!profile) notFound();

  return (
    <main className="city-pop-shell relative overflow-hidden pb-10">
      <div className="px-6 py-8 md:px-10">
        <div className="mx-auto max-w-7xl space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-[28px] border-[3px] border-[rgba(44,12,70,0.9)] bg-[rgba(255,240,253,0.74)] px-6 py-5 backdrop-blur-xl">
            <div className="flex items-center gap-4">
              {profile.imageUrl ? (
                <div className="relative h-20 w-20 overflow-hidden rounded-[24px] border border-white/10 bg-white/5">
                  <Image src={profile.imageUrl} alt={profile.displayName} fill sizes="80px" className="object-cover" />
                </div>
              ) : null}
              <div>
                <p className="text-sm uppercase tracking-[0.24em] text-[var(--theme-muted)]">Community profile</p>
                <h1 className="font-display text-4xl text-[var(--theme-title)]">{profile.displayName}</h1>
                <p className="mt-2 text-sm text-[var(--theme-body)]">Read-only dashboard built from shared SoundScope snapshots.</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href={`/social/${spotifyUserId}/compare`} className="pixel-chip text-[var(--theme-text)] transition hover:text-[#2d0d46]">Compare with me</Link>
              <Link href="/social" className="pixel-chip text-[var(--theme-text)] transition hover:text-[#2d0d46]">Back to community</Link>
            </div>
          </div>
        </div>
      </div>

      <DashboardView
        mode="authenticated"
        insights={insights ?? undefined}
        selectedRange={selectedRange}
        topLists={topLists ?? undefined}
        heroTopLists={heroTopLists ?? undefined}
        selectedTopRange={selectedTopRange}
        selectedTopFrom={selectedTopFrom}
        selectedTopTo={selectedTopTo}
        dashboardBasePath={`/social/${spotifyUserId}`}
        analysisBasePath={null}
        topListsPagePath={null}
        playlistsPagePath={null}
      />
    </main>
  );
}
