export function hasSpotifyAuthConfig() {
  return Boolean(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET && process.env.AUTH_SECRET);
}
