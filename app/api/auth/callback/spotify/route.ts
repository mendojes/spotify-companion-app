import { NextRequest, NextResponse } from "next/server";
import { buildSession, consumeAuthStateCookie, setSessionCookie } from "@/lib/auth";
import { exchangeSpotifyCode, getAppUrl, getSpotifyProfile } from "@/lib/spotify";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  if (error) {
    return NextResponse.redirect(getAppUrl(`/login?error=${encodeURIComponent(error)}`));
  }

  if (!code || !state) {
    return NextResponse.redirect(getAppUrl("/login?error=missing_code"));
  }

  const isValidState = await consumeAuthStateCookie(state);

  if (!isValidState) {
    return NextResponse.redirect(getAppUrl("/login?error=invalid_state"));
  }

  try {
    const tokens = await exchangeSpotifyCode(code);

    if (!tokens.refresh_token) {
      return NextResponse.redirect(getAppUrl("/login?error=missing_refresh_token"));
    }

    const profile = await getSpotifyProfile(tokens.access_token);
    const session = buildSession(profile, tokens.access_token, tokens.refresh_token, tokens.expires_in);
    await setSessionCookie(session);

    return NextResponse.redirect(getAppUrl("/dashboard"));
  } catch {
    return NextResponse.redirect(getAppUrl("/login?error=spotify_exchange_failed"));
  }
}
