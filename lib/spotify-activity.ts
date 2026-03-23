import { getDatabase, hasMongoConfig } from "@/lib/mongodb";
import { spotifyFetch, spotifyFetchOptional } from "@/lib/spotify";
import {
  NowPlayingState,
  SpotifyCurrentlyPlayingResponse,
  SpotifyRecentlyPlayedItem,
  SpotifyRecentlyPlayedResponse,
  StoredRecentPlay,
} from "@/lib/types";

const RECENT_PLAYS_COLLECTION = "spotify_recent_plays";
const RECENT_PLAY_LOOKBACK_LIMIT = 500;

function getPlaylistIdFromContext(context?: SpotifyRecentlyPlayedItem["context"] | SpotifyCurrentlyPlayingResponse["context"]) {
  if (!context?.uri || context.type !== "playlist") {
    return undefined;
  }

  const match = context.uri.match(/^spotify:playlist:(.+)$/);
  return match?.[1];
}

export async function getPlayingFrom(accessToken: string, response: SpotifyCurrentlyPlayingResponse) {
  const playlistId = getPlaylistIdFromContext(response.context);

  if (playlistId) {
    try {
      const playlist = await spotifyFetch<{ id: string; name: string; images?: Array<{ url: string }> }>(`/playlists/${playlistId}?fields=id,name,images`, accessToken);
      return {
        type: "playlist",
        label: playlist.name,
        playlistId: playlist.id,
        imageUrl: playlist.images?.[0]?.url ?? response.item?.album.images?.[0]?.url,
      };
    } catch {
      return {
        type: "playlist",
        label: "Spotify playlist",
        playlistId,
        imageUrl: response.item?.album.images?.[0]?.url,
      };
    }
  }

  if (response.context?.type === "album" || response.context?.type === "artist" || !response.context?.type) {
    return {
      type: response.context?.type ?? "album",
      label: response.item?.album.name ?? "Unknown release",
      imageUrl: response.item?.album.images?.[0]?.url,
    };
  }

  if (response.context?.type === "collection") {
    return {
      type: "collection",
      label: "Your library",
      imageUrl: response.item?.album.images?.[0]?.url,
    };
  }

  return {
    type: response.context?.type ?? "unknown",
    label: response.item?.album.name ?? "Unknown source",
    imageUrl: response.item?.album.images?.[0]?.url,
  };
}

export async function getCurrentPlaybackSource(accessToken: string) {
  const response = await spotifyFetchOptional<SpotifyCurrentlyPlayingResponse>("/me/player/currently-playing", accessToken);

  if (!response?.item) {
    return undefined;
  }

  return getPlayingFrom(accessToken, response);
}

function toStoredRecentPlay(spotifyUserId: string, item: SpotifyRecentlyPlayedItem): StoredRecentPlay {
  const playlistId = getPlaylistIdFromContext(item.context);

  return {
    spotifyUserId,
    trackId: item.track.id,
    playedAt: item.played_at,
    trackName: item.track.name,
    artistName: item.track.artists.map((artist) => artist.name).join(", "),
    albumName: item.track.album.name,
    imageUrl: item.track.album.images?.[0]?.url,
    playlistId,
    sourceType: item.context?.type,
  };
}

export async function ensureRecentPlayIndexes() {
  if (!hasMongoConfig()) {
    return;
  }

  const db = await getDatabase();
  if (!db) {
    return;
  }

  await db.collection<StoredRecentPlay>(RECENT_PLAYS_COLLECTION).createIndex(
    { spotifyUserId: 1, playedAt: -1, trackId: 1 },
    { unique: true },
  );
  await db.collection<StoredRecentPlay>(RECENT_PLAYS_COLLECTION).createIndex({ spotifyUserId: 1, playlistId: 1, playedAt: -1 });
}

export async function syncRecentPlays(accessToken: string, spotifyUserId: string) {
  const response = await spotifyFetch<SpotifyRecentlyPlayedResponse>("/me/player/recently-played?limit=50", accessToken);
  const recentPlays = response.items.map((item) => toStoredRecentPlay(spotifyUserId, item));

  if (!hasMongoConfig()) {
    return recentPlays;
  }

  const db = await getDatabase();
  if (!db) {
    return recentPlays;
  }

  await ensureRecentPlayIndexes();

  if (recentPlays.length > 0) {
    await db.collection<StoredRecentPlay>(RECENT_PLAYS_COLLECTION).bulkWrite(
      recentPlays.map((play) => ({
        updateOne: {
          filter: {
            spotifyUserId: play.spotifyUserId,
            playedAt: play.playedAt,
            trackId: play.trackId,
          },
          update: { $set: play },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  }

  return recentPlays;
}

export async function getStoredRecentPlays(spotifyUserId: string, limit = RECENT_PLAY_LOOKBACK_LIMIT) {
  if (!hasMongoConfig()) {
    return [] as StoredRecentPlay[];
  }

  const db = await getDatabase();
  if (!db) {
    return [] as StoredRecentPlay[];
  }

  return db
    .collection<StoredRecentPlay>(RECENT_PLAYS_COLLECTION)
    .find({ spotifyUserId })
    .sort({ playedAt: -1 })
    .limit(limit)
    .toArray();
}

export async function getNowPlaying(accessToken: string): Promise<NowPlayingState> {
  const response = await spotifyFetchOptional<SpotifyCurrentlyPlayingResponse>("/me/player/currently-playing", accessToken);

  if (!response?.item) {
    return { isPlaying: false };
  }

  return {
    isPlaying: response.is_playing,
    progressMs: response.progress_ms,
    track: {
      id: response.item.id,
      title: response.item.name,
      artist: response.item.artists.map((artist) => artist.name).join(", "),
      album: response.item.album.name,
      imageUrl: response.item.album.images?.[0]?.url,
      durationMs: response.item.duration_ms,
    },
    playingFrom: await getPlayingFrom(accessToken, response),
  };
}
