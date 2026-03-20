import { NextRequest, NextResponse } from "next/server";
import { createOauthState, setAuthStateCookie } from "@/lib/auth";
import { hasSpotifyAuthConfig } from "@/lib/env";
import { getSpotifyLoginUrl } from "@/lib/spotify";

export async function GET(request: NextRequest) {
  if (!hasSpotifyAuthConfig()) {
    return NextResponse.redirect(new URL("/login?error=missing_config", request.url));
  }

  const state = createOauthState();
  await setAuthStateCookie(state);
  return NextResponse.redirect(getSpotifyLoginUrl(state));
}
