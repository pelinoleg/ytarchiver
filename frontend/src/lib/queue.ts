/** Tiny sessionStorage-backed queue shared between MusicPage / PlaylistPage
 *  and WatchPage.
 *
 *  Two shapes share the file:
 *    - "music" queue (one global)        — key `music.queue`
 *    - per-playlist shuffled queue       — key `playlist.queue.<id>`
 *
 *  WatchPage navigation is driven entirely by URL params (`?source=music` or
 *  `?playlist=N&shuffle=1`) — these helpers just provide the ordered ids. */

export type QueueRecord = {
  ids:      string[];
  shuffled: boolean;
};

const MUSIC_KEY = "music.queue";
const playlistKey = (id: number) => `playlist.queue.${id}`;

export function setMusicQueue(ids: string[], shuffled: boolean): void {
  sessionStorage.setItem(MUSIC_KEY, JSON.stringify({ ids, shuffled } satisfies QueueRecord));
}

export function getMusicQueue(): QueueRecord | null {
  return readQueue(MUSIC_KEY);
}

export function clearMusicQueue(): void {
  sessionStorage.removeItem(MUSIC_KEY);
}

export function setPlaylistQueue(playlistId: number, ids: string[], shuffled: boolean): void {
  sessionStorage.setItem(
    playlistKey(playlistId),
    JSON.stringify({ ids, shuffled } satisfies QueueRecord),
  );
}

export function getPlaylistQueue(playlistId: number): QueueRecord | null {
  return readQueue(playlistKey(playlistId));
}

export function clearPlaylistQueue(playlistId: number): void {
  sessionStorage.removeItem(playlistKey(playlistId));
}

function readQueue(key: string): QueueRecord | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!Array.isArray(data?.ids)) return null;
    return { ids: data.ids.filter((x: unknown): x is string => typeof x === "string"),
             shuffled: !!data.shuffled };
  } catch {
    return null;
  }
}

/** Fisher-Yates shuffle. Pure: returns a new array. */
export function shuffleArray<T>(arr: T[]): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
