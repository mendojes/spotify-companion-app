import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getStoredPlaylistLibrary, getStoredPlaylistTrackDiagnostics } from "@/lib/spotify-playlists";

type RouteContext = {
  params: Promise<{ playlistId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const session = await getSession();

  if (!session?.spotifyUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { playlistId } = await context.params;

  try {
    const storedPlaylists = await getStoredPlaylistLibrary(session.spotifyUserId).catch(() => []);
    const totalItems = storedPlaylists.find((playlist) => playlist.id === playlistId)?.tracks?.total ?? 0;
    const diagnostics = await getStoredPlaylistTrackDiagnostics(session.spotifyUserId, playlistId, totalItems);
    return NextResponse.json(diagnostics);
  } catch {
    return NextResponse.json({ error: "Could not load playlist diagnostics." }, { status: 500 });
  }
}
