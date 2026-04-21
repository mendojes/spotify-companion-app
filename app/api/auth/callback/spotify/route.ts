import { NextRequest, NextResponse } from "next/server";
import { applyAuthEventCookie, applySessionCookie, buildSession, consumeAuthStateCookie } from "@/lib/auth";
import { upsertConnectedUser } from "@/lib/connected-users";
import { exchangeSpotifyCode, getAppUrl, getSpotifyProfile } from "@/lib/spotify";
import { getPlaylistLibraryStatus, invalidatePlaylistInsightsCache, syncPlaylistLibrary } from "@/lib/spotify-playlists";

const LOGIN_PLAYLIST_SYNC_TTL_MS = 1000 * 60 * 60 * 24;

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

    console.log("[spotify-callback] preparing redirect with session cookie");
    const response = NextResponse.redirect(getAppUrl("/dashboard", request));
    applySessionCookie(response, session);
    applyAuthEventCookie(response, "callback_session_set", `user:${session.spotifyUserId}`);

    try {
      await upsertConnectedUser({
        spotifyUserId: session.spotifyUserId,
        displayName: session.displayName,
        email: session.email,
        imageUrl: session.imageUrl,
        refreshToken: session.refreshToken,
      });
    } catch (persistenceError) {
      const message = persistenceError instanceof Error ? persistenceError.message : String(persistenceError);
      console.log("[spotify-callback] connected user persistence failed", { message, ms: Date.now() - startedAt });
    }

    try {
      const playlistLibraryStatus = await getPlaylistLibraryStatus(session.spotifyUserId);
      const shouldSyncPlaylists =
        playlistLibraryStatus.playlistCount === 0 ||
        !playlistLibraryStatus.lastSyncedAt ||
        Date.now() - new Date(playlistLibraryStatus.lastSyncedAt).getTime() >= LOGIN_PLAYLIST_SYNC_TTL_MS;

      if (shouldSyncPlaylists) {
        console.log("[spotify-callback] syncing playlist library", {
          spotifyUserId: session.spotifyUserId,
          playlistCount: playlistLibraryStatus.playlistCount,
          lastSyncedAt: playlistLibraryStatus.lastSyncedAt,
          ms: Date.now() - startedAt,
        });
        await syncPlaylistLibrary(session.accessToken, session.spotifyUserId).catch(() => []);
        invalidatePlaylistInsightsCache(session.spotifyUserId);
      }
    } catch (playlistSyncError) {
      const message = playlistSyncError instanceof Error ? playlistSyncError.message : String(playlistSyncError);
      console.log("[spotify-callback] playlist library sync failed", { message, ms: Date.now() - startedAt });
    }

    console.log("[spotify-callback] redirecting to dashboard", { ms: Date.now() - startedAt });
    return response;
  } catch (caughtError) {
    const message = caughtError instanceof Error ? caughtError.message : String(caughtError);
    const errorCode = message.includes("429") ? "spotify_rate_limited" : "spotify_exchange_failed";
    console.log("[spotify-callback] failed", { message, errorCode, ms: Date.now() - startedAt });
    return NextResponse.redirect(getAppUrl("/login?error=" + errorCode, request));
  }
}


