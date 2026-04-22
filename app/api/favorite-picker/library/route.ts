import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getFavoritePickerPlaylistLibrary } from "@/lib/spotify-picker";

export async function GET() {
  try {
    const session = await getSession();
    const results = await getFavoritePickerPlaylistLibrary(session);
    return NextResponse.json({ results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load your Spotify playlists.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
