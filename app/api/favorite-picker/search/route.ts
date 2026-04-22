import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { FavoritePickerSearchType, getFavoritePickerSearchResultsPage } from "@/lib/spotify-picker";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q") ?? "";
    const typeParam = searchParams.get("type");
    const pageParam = Number(searchParams.get("page"));
    const type: FavoritePickerSearchType = typeParam === "album" || typeParam === "artist" || typeParam === "playlist"
      ? typeParam
      : "playlist";
    const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;
    const session = await getSession();
    const results = await getFavoritePickerSearchResultsPage(session, query, type, page);
    return NextResponse.json(results);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not search Spotify.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
