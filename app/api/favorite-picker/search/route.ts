import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getFavoritePickerSearchResults } from "@/lib/spotify-picker";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q") ?? "";
    const session = await getSession();
    const results = await getFavoritePickerSearchResults(session, query);
    return NextResponse.json({ results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not search Spotify.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
