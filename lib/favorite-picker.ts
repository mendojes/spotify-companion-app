export type FavoritePickerTargetType = "playlist" | "album" | "artist";

export type FavoritePickerTargetSummary = {
  id: string;
  type: FavoritePickerTargetType;
  name: string;
  subtitle: string;
  imageUrl?: string;
  spotifyUrl?: string;
  trackCount?: number;
};

export type FavoritePickerTrack = {
  id: string;
  spotifyId?: string;
  name: string;
  artists: string[];
  artistLabel: string;
  albumName: string;
  imageUrl?: string;
  spotifyUrl?: string;
  sourceTargetIds: string[];
  sourceLabels: string[];
};

type FavoritePickerSongState = FavoritePickerTrack & {
  eliminated: boolean;
  eliminators: string[];
};

export type FavoritePickerHistoryEntry = {
  snapshot: Omit<FavoritePickerState, "history">;
};

export type FavoritePickerState = {
  songs: FavoritePickerSongState[];
  activeSongIds: string[];
  rankedSongIds: string[];
  pairIndex: number;
  eliminationCountdown: number;
  currentFavoriteId?: string;
  history: FavoritePickerHistoryEntry[];
};

export type FavoritePickerChoice = {
  left: FavoritePickerTrack;
  right: FavoritePickerTrack;
};

function shuffle<T>(items: T[]) {
  const next = [...items];

  for (let index = next.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[randomIndex]] = [next[randomIndex], next[index]];
  }

  return next;
}

function getSongMap(state: FavoritePickerState) {
  return new Map(state.songs.map((song) => [song.id, song]));
}

function getAliveSongIds(state: FavoritePickerState) {
  const songMap = getSongMap(state);
  return state.activeSongIds.filter((songId) => !songMap.get(songId)?.eliminated);
}

function getSongById(state: FavoritePickerState, songId: string) {
  return state.songs.find((song) => song.id === songId);
}

function getNextAliveSongId(state: FavoritePickerState, startIndex: number) {
  const songMap = getSongMap(state);

  for (let index = startIndex; index < state.activeSongIds.length; index += 1) {
    const songId = state.activeSongIds[index];
    if (!songMap.get(songId)?.eliminated) {
      return { songId, nextIndex: index + 1 };
    }
  }

  return null;
}

function getChoiceDescriptor(state: FavoritePickerState) {
  if (state.activeSongIds.length <= 1) {
    return null;
  }

  let first = getNextAliveSongId(state, state.pairIndex);
  if (!first) {
    first = getNextAliveSongId(state, 0);
  }

  if (!first) {
    return null;
  }

  let second = getNextAliveSongId(state, first.nextIndex);
  if (!second) {
    second = getNextAliveSongId(state, 0);
  }

  if (!second || second.songId === first.songId) {
    return null;
  }

  const left = getSongById(state, first.songId);
  const right = getSongById(state, second.songId);

  if (!left || !right) {
    return null;
  }

  return {
    left,
    right,
    nextPairIndex: second.nextIndex,
  };
}

function finalizeRounds(state: FavoritePickerState): FavoritePickerState {
  let nextState = state;

  while (true) {
    if (nextState.activeSongIds.length === 0) {
      return {
        ...nextState,
        pairIndex: 0,
        eliminationCountdown: 0,
      };
    }

    if (nextState.activeSongIds.length === 1) {
      return {
        ...nextState,
        rankedSongIds: [...nextState.rankedSongIds, nextState.activeSongIds[0]],
        activeSongIds: [],
        currentFavoriteId: nextState.activeSongIds[0],
        eliminationCountdown: 0,
      };
    }

    const aliveSongIds = getAliveSongIds(nextState);

    if (aliveSongIds.length > 1) {
      return nextState;
    }

    const currentFavoriteId = aliveSongIds[0];
    if (!currentFavoriteId) {
      return nextState;
    }

    const nextSongs = nextState.songs.map((song) => {
      if (song.id === currentFavoriteId) {
        return song;
      }

      if (song.eliminators.at(-1) === currentFavoriteId) {
        return {
          ...song,
          eliminated: false,
        };
      }

      return song;
    });

    nextState = {
      ...nextState,
      songs: nextSongs,
      rankedSongIds: [...nextState.rankedSongIds, currentFavoriteId],
      activeSongIds: nextState.activeSongIds.filter((songId) => songId !== currentFavoriteId),
      currentFavoriteId,
      pairIndex: 0,
      eliminationCountdown: 0,
    };

    const remainingSongs = nextState.activeSongIds
      .map((songId) => getSongById(nextState, songId))
      .filter((song): song is FavoritePickerSongState => Boolean(song));
    const resumedRoundSongCount = remainingSongs.filter((song) => song.eliminators.at(-1) === currentFavoriteId).length;

    if (resumedRoundSongCount >= 2) {
      nextState = {
        ...nextState,
        pairIndex: 0,
        eliminationCountdown: resumedRoundSongCount - 1,
      };
    }
  }
}

export function createFavoritePickerState(tracks: FavoritePickerTrack[]) {
  const songs = tracks.map((track) => ({
    ...track,
    eliminated: false,
    eliminators: [],
  }));

  return finalizeRounds({
    songs,
    activeSongIds: shuffle(songs.map((song) => song.id)),
    rankedSongIds: [],
    pairIndex: 0,
    eliminationCountdown: Math.max(0, songs.length - 1),
    history: [],
  });
}

export function getFavoritePickerChoice(state: FavoritePickerState): FavoritePickerChoice | null {
  const descriptor = getChoiceDescriptor(state);

  if (!descriptor) {
    return null;
  }

  return {
    left: descriptor.left,
    right: descriptor.right,
  };
}

export function chooseFavoritePickerSong(
  state: FavoritePickerState,
  winnerId: string,
  loserId: string,
) {
  const choice = getChoiceDescriptor(state);

  if (!choice) {
    return state;
  }

  const nextSongs = state.songs.map((song) => {
    if (song.id !== loserId) {
      return song;
    }

    return {
      ...song,
      eliminated: true,
      eliminators: [...song.eliminators, winnerId],
    };
  });

  const nextState: FavoritePickerState = {
    ...state,
    songs: nextSongs,
    pairIndex: choice.nextPairIndex,
    eliminationCountdown: Math.max(0, state.eliminationCountdown - 1),
    history: [
      ...state.history,
      {
        snapshot: {
          songs: state.songs.map((song) => ({
            ...song,
            eliminators: [...song.eliminators],
            artists: [...song.artists],
            sourceTargetIds: [...song.sourceTargetIds],
            sourceLabels: [...song.sourceLabels],
          })),
          activeSongIds: [...state.activeSongIds],
          rankedSongIds: [...state.rankedSongIds],
          pairIndex: state.pairIndex,
          eliminationCountdown: state.eliminationCountdown,
          currentFavoriteId: state.currentFavoriteId,
        },
      },
    ],
  };

  return finalizeRounds(nextState);
}

export function skipFavoritePickerChoice(state: FavoritePickerState) {
  return {
    ...state,
    activeSongIds: shuffle(state.activeSongIds),
    pairIndex: 0,
  };
}

export function goBackFavoritePickerChoice(state: FavoritePickerState) {
  const previous = state.history.at(-1);

  if (!previous) {
    return state;
  }

  return {
    ...previous.snapshot,
    history: state.history.slice(0, -1),
  };
}

export function isFavoritePickerComplete(state: FavoritePickerState) {
  return state.activeSongIds.length === 0;
}

export function getFavoritePickerRankedTracks(state: FavoritePickerState) {
  return state.rankedSongIds.reduce<FavoritePickerTrack[]>((results, songId) => {
    const song = getSongById(state, songId);

    if (song) {
      results.push(song);
    }

    return results;
  }, []);
}
