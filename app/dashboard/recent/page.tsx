import { redirect } from "next/navigation";
import { RecentTracksPageView } from "@/components/recent-tracks-page-view";
import { requireSession } from "@/lib/auth";

export default async function RecentTracksPage() {
  const session = await requireSession();

  if (!session) {
    redirect("/login");
  }

  return (
    <main className="relative overflow-hidden">
      <RecentTracksPageView />
    </main>
  );
}
