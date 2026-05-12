import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getStoredPlaylistLibrary } from "@/lib/spotify-playlists";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.spotifyUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (query.length < 2) {
    return NextResponse.json({ items: [] });
  }

  const normalizedQuery = query.toLocaleLowerCase();
  const playlists = await getStoredPlaylistLibrary(session.spotifyUserId).catch(() => []);

  const items = playlists
    .filter((playlist) => playlist.name.toLocaleLowerCase().includes(normalizedQuery))
    .sort((left, right) => {
      const leftStarts = left.name.toLocaleLowerCase().startsWith(normalizedQuery) ? 1 : 0;
      const rightStarts = right.name.toLocaleLowerCase().startsWith(normalizedQuery) ? 1 : 0;
      if (leftStarts !== rightStarts) {
        return rightStarts - leftStarts;
      }

      return (right.tracks?.total ?? 0) - (left.tracks?.total ?? 0);
    })
    .slice(0, 12)
    .map((playlist) => ({
      id: playlist.id,
      name: playlist.name,
      imageUrl: playlist.images?.[0]?.url ?? null,
      trackCount: playlist.tracks?.total ?? 0,
      ownerName: playlist.owner?.display_name ?? null,
    }));

  return NextResponse.json({ items });
}
