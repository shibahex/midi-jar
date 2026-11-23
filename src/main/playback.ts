import { SpotifyPlayer } from './types/Spotify';
import * as spotify from './spotify';
import * as spotifyApp from './spotifyApp';
import * as youtube from './youtube';

/**
 * Where songs play: Spotify, or YouTube in the browser (links "youtube:<id>"). The game asks one
 * player for all: a song plays where its link is from, and only that one is asked about it (a
 * song on Spotify is never judged by a video in the browser, nor a video by Spotify). Asked
 * without a song: the last one used first, then the other one when it plays nothing.
 * Spotify is asked to its app on this computer first (no limit of calls, no Premium needed),
 * else to the Web API (Spotify playing on another device).
 */

type Source = 'spotify' | 'youtube';

let active: Source = 'spotify';

/** Spotify: its app on this computer, else the Web API (when connected) */
async function askSpotify(): Promise<SpotifyPlayer | null> {
  const local = await spotifyApp.getPlayer().catch(() => null);
  if (local) return local;
  // not connected to Spotify (only YouTube is used): nothing plays
  return spotify.isConnected() ? spotify.getPlayer() : null;
}

const ask = (source: Source): Promise<SpotifyPlayer | null> =>
  source === 'youtube' ? youtube.getPlayer() : askSpotify();

/** Where a song's link is from */
const sourceOf = (uri: string): Source => (youtube.isYouTubeUri(uri) ? 'youtube' : 'spotify');

export async function getPlayer(wantedUri?: string) {
  // a song: only where its link is from is asked
  if (wantedUri) return ask(sourceOf(wantedUri));
  const player = await ask(active);
  if (player?.isPlaying) return player;
  const other = await ask(active === 'youtube' ? 'spotify' : 'youtube').catch(() => null);
  return other?.isPlaying ? other : player;
}

/** Everything playing, or paused, on Spotify and in the browsers (to pick one) */
export async function listPlayers() {
  const [spotifyPlayer, videos] = await Promise.all([
    askSpotify().catch(() => null),
    youtube.listPlayers().catch(() => [] as SpotifyPlayer[]),
  ]);
  return [...(spotifyPlayer ? [spotifyPlayer] : []), ...videos];
}

/** Follows what was picked (where it plays is asked first from now on) */
export async function select(uri: string) {
  active = youtube.isYouTubeUri(uri) ? 'youtube' : 'spotify';
  if (active === 'youtube') await youtube.select(uri);
}

const spotifyPause = async () => {
  if (!(await spotifyApp.pause().catch(() => false))) await spotify.pause();
};

/** Plays a song where its link is from (the other one is paused, not to hear both) */
export async function play(uri: string, positionMs: number) {
  const source: Source = youtube.isYouTubeUri(uri) ? 'youtube' : 'spotify';
  if (source !== active) {
    if (source === 'youtube') await spotifyPause().catch(() => {});
    if (source === 'spotify') await youtube.pause().catch(() => {});
  }
  active = source;
  if (source === 'youtube') return youtube.play(uri, positionMs);
  if (await spotifyApp.play(uri, positionMs).catch(() => false)) return undefined;
  return spotify.play(uri, positionMs);
}

export const pause = () => (active === 'youtube' ? youtube.pause() : spotifyPause());

export async function seek(positionMs: number) {
  if (active === 'youtube') return youtube.seek(positionMs);
  if (await spotifyApp.seek(positionMs).catch(() => false)) return undefined;
  return spotify.seek(positionMs);
}

export async function setVolume(percent: number) {
  if (active === 'youtube') return youtube.setVolume(percent);
  if (await spotifyApp.setVolume(percent).catch(() => false)) return undefined;
  return spotify.setVolume(percent);
}

/**
 * Sets the speed of what plays (1: the real speed). Only YouTube, through the browser extension,
 * can be slowed down (Spotify has no speed): false when it cannot.
 */
export async function setRate(rate: number) {
  if (active !== 'youtube') return false;
  return youtube.setRate(rate);
}

/** Where the bars start (Spotify only: YouTube does not tell) */
export const getBars = (uri: string) =>
  youtube.isYouTubeUri(uri) ? Promise.resolve(null) : spotify.getBars(uri);
