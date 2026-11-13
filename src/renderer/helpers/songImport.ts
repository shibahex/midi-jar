import { ImportedSong, SpotifyTrack } from 'main/types';

import { parseSongPage } from './songs';
import {
  getSongsterrSearchUrl,
  getSongsterrTracks,
  isSongsterrUrl,
  readSongsterrPage,
  readSongsterrSearch,
  readSongsterrTrack,
  songFromSongsterr,
} from './songsterr';
import { estimateFirstChordMs } from './spotifySync';

/**
 * A song from the web: a web address (Songsterr, Ultimate Guitar, chord sites), or a song
 * name found on Songsterr. Throws when nothing could be read.
 */
export async function importSongFromWeb(text: string): Promise<Omit<ImportedSong, 'id'>> {
  const address = text.trim();
  const isAddress = /^https?:\/\//i.test(address) || /^[^\s]+\.[a-z]{2,}(\/|$)/i.test(address);
  let fullAddress = /^https?:\/\//i.test(address) ? address : `https://${address}`;
  if (!isAddress) {
    const found = readSongsterrSearch(await window.app.fetchPage(getSongsterrSearchUrl(address)));
    if (!found) throw new Error(`no Songsterr song found for "${address}"`);
    fullAddress = found;
  }
  const page = await window.app.fetchPage(fullAddress);
  const songsterr = isSongsterrUrl(fullAddress) ? readSongsterrPage(page) : null;
  let result: ReturnType<typeof parseSongPage>;
  if (songsterr) {
    // Songsterr: the notes of the rhythm guitar, bass, lead and melody, with their timing
    const tracks = await Promise.all(
      getSongsterrTracks(songsterr).map(async ({ role, name, url }) => ({
        role,
        name,
        track: readSongsterrTrack(await window.app.fetchPage(url)),
      }))
    );
    result = songFromSongsterr(songsterr, tracks, fullAddress);
  } else {
    result = parseSongPage(page, fullAddress);
  }
  if ('error' in result) throw new Error(result.error);
  return { ...result, url: fullAddress };
}

/** Where a song's link plays: "YouTube" ("youtube:<id>") or "Spotify" */
export const sourceName = (uri?: string) => (uri?.startsWith('youtube:') ? 'YouTube' : 'Spotify');

/** A song's Spotify (or YouTube) link to a track: where its first chord is, estimated */
export async function spotifyLinkFor(
  song: ImportedSong,
  track: SpotifyTrack
): Promise<NonNullable<ImportedSong['spotify']>> {
  const bars = await window.app.spotify.bars(track.uri).catch(() => null);
  const firstChordMs = estimateFirstChordMs(song, track.durationMs, bars) ?? undefined;
  return {
    uri: track.uri,
    name: `${track.name} (${track.artists})`,
    durationMs: track.durationMs,
    imageUrl: track.imageUrl,
    firstChordMs,
    syncedBy: firstChordMs !== undefined ? 'estimate' : undefined,
  };
}

/**
 * Spotify plays the linked song: the same track, or another release of it (Spotify may play
 * a single instead of the album's track, with another uri)
 */
export function isLinkedSong(
  track: SpotifyTrack,
  link?: { uri: string; name: string; durationMs?: number }
) {
  if (!link) return false;
  if (track.uri === link.uri || track.linkedFromUri === link.uri) return true;
  // the same name and artists (as linked), and about as long
  const sameName = `${track.name} (${track.artists})`.toLowerCase() === link.name.toLowerCase();
  const sameLength =
    link.durationMs === undefined || Math.abs(track.durationMs - link.durationMs) < 3000;
  return sameName && sameLength;
}

/** A name to compare: lower case, without what is in brackets or after " - " */
const simple = (name: string) =>
  name
    .toLowerCase()
    .replace(/\s*[([][^)\]]*[)\]]/g, '')
    .replace(/\s+-\s+.*$/, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/**
 * The imported song Spotify plays: the one linked to it, or one with its name (and its
 * artist, when the song's title has one: "Name by Artist")
 */
export function findSongForTrack(songs: ImportedSong[], track: SpotifyTrack) {
  const linked = songs.find((song) => isLinkedSong(track, song.spotify));
  if (linked) return linked;
  const name = simple(track.name);
  const artists = track.artists.split(',').map(simple);
  return songs.find((song) => {
    const [title, artist] = song.title.split(/\s+by\s+/i);
    if (simple(title) !== name) return false;
    return !artist || artists.some((a) => a && simple(artist).includes(a));
  });
}

/**
 * One of the songs, by a name typed ("creep", "Creep Radiohead"): the one whose title (without
 * its artist) is in it, the longest title first. Null when none is.
 */
export function findSongByName(songs: ImportedSong[], name: string) {
  const typed = ` ${simple(name)} `;
  const titled = songs
    .map((song) => {
      const [title, artist] = song.title.split(/\s+by\s+/i);
      return { song, title: simple(title), artist: artist ? simple(artist) : '' };
    })
    .filter(({ title }) => title && typed.includes(` ${title} `))
    // (the artist typed too: that one first)
    .sort(
      (a, b) =>
        Number(!!b.artist && typed.includes(` ${b.artist} `)) -
          Number(!!a.artist && typed.includes(` ${a.artist} `)) || b.title.length - a.title.length
    );
  return titled[0]?.song ?? null;
}
