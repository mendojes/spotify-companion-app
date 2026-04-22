import { requireSession, hasSpotifyConnection } from "@/lib/auth";
import { FavoritePickerView } from "./favorite-picker-view";

export default async function FavoritePickerPage() {
  const session = await requireSession();

  return (
    <main className="relative min-h-screen overflow-hidden px-6 py-10 md:px-10">
      <div className="mx-auto max-w-7xl">
        <FavoritePickerView
          spotifyConnected={hasSpotifyConnection(session)}
          displayName={session.displayName}
          userId={session.userId}
        />
      </div>
    </main>
  );
}
