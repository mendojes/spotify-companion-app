import { NextRequest, NextResponse } from "next/server";
import { buildSession, consumeAuthStateCookie, setSessionCookie } from "@/lib/auth";
import { upsertConnectedUser } from "@/lib/connected-users";
import { exchangeSpotifyCode, getAppUrl, getSpotifyProfile } from "@/lib/spotify";

export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  console.log("[spotify-callback] start", { hasCode: Boolean(code), hasState: Boolean(state), error });

  if (error) {
    console.log("[spotify-callback] spotify returned error", { error, ms: Date.now() - startedAt });
    return NextResponse.redirect(getAppUrl(`/login?error=${encodeURIComponent(error)}`, request));
  }

  if (!code || !state) {
    console.log("[spotify-callback] missing code or state", { ms: Date.now() - startedAt });
    return NextResponse.redirect(getAppUrl("/login?error=missing_code", request));
  }

  console.log("[spotify-callback] validating state");
  const isValidState = await consumeAuthStateCookie(state);

  if (!isValidState) {
    console.log("[spotify-callback] invalid state", { ms: Date.now() - startedAt });
    return NextResponse.redirect(getAppUrl("/login?error=invalid_state", request));
  }

  try {
    console.log("[spotify-callback] exchanging code");
    const tokens = await exchangeSpotifyCode(code, request);
    console.log("[spotify-callback] token exchange complete", { hasRefreshToken: Boolean(tokens.refresh_token), ms: Date.now() - startedAt });

    if (!tokens.refresh_token) {
      console.log("[spotify-callback] missing refresh token", { ms: Date.now() - startedAt });
      return NextResponse.redirect(getAppUrl("/login?error=missing_refresh_token", request));
    }

    console.log("[spotify-callback] fetching profile");
    const profile = await getSpotifyProfile(tokens.access_token);
    console.log("[spotify-callback] profile fetch complete", { spotifyUserId: profile.id, ms: Date.now() - startedAt });

    const session = buildSession(profile, tokens.access_token, tokens.refresh_token, tokens.expires_in);
    await upsertConnectedUser({
      spotifyUserId: session.spotifyUserId,
      displayName: session.displayName,
      email: session.email,
      imageUrl: session.imageUrl,
      refreshToken: session.refreshToken,
    });

    console.log("[spotify-callback] setting session cookie");
    await setSessionCookie(session);

    console.log("[spotify-callback] redirecting to dashboard", { ms: Date.now() - startedAt });
    return NextResponse.redirect(getAppUrl("/dashboard", request));
  } catch (caughtError) {
    const message = caughtError instanceof Error ? caughtError.message : String(caughtError);
    const errorCode = message.includes("429") ? "spotify_rate_limited" : "spotify_exchange_failed";
    console.log("[spotify-callback] failed", { message, errorCode, ms: Date.now() - startedAt });
    return NextResponse.redirect(getAppUrl("/login?error=" + errorCode, request));
  }
}
