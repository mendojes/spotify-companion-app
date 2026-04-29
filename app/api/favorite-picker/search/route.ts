import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getFavoritePickerSearchResultsPage } from "@/lib/spotify-picker";

export const dynamic = "force-dynamic";

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Search failed.";
}

export async function GET(request: NextRequest) {
  const session = await requireSession();
  const query = request.nextUrl.searchParams.get("q") ?? "";
  const type = (request.nextUrl.searchParams.get("type") ?? "playlist") as "playlist" | "album" | "artist";
  const page = Number(request.nextUrl.searchParams.get("page") ?? "1");

  try {
    const result = await getFavoritePickerSearchResultsPage(session, query, type, page);

    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = getErrorMessage(error);

    if (message.includes("429")) {
      return NextResponse.json(
        {
          error: "Spotify search is temporarily rate-limited. Please wait a moment and try again.",
        },
        { status: 429 },
      );
    }

    return NextResponse.json(
      {
        error: message,
      },
      { status: 500 },
    );
  }
}