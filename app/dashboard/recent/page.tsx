import { RecentTracksPageView } from "@/components/recent-tracks-page-view";
import { requireSpotifySession } from "@/lib/auth";

export default async function RecentTracksPage() {
  await requireSpotifySession("/dashboard/recent");

  return (
    <main className="relative overflow-hidden">
      <RecentTracksPageView />
    </main>
  );
}
