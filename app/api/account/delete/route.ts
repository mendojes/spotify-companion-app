import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookie, getSession } from "@/lib/auth";
import { deleteSpotifyUserData } from "@/lib/account-data";
import { getAppUrl } from "@/lib/spotify";

export async function POST(request: NextRequest) {
  const session = await getSession();

  if (session) {
    await deleteSpotifyUserData(session.spotifyUserId);
  }

  await clearSessionCookie();

  return NextResponse.redirect(getAppUrl("/login?deleted=1", request));
}

