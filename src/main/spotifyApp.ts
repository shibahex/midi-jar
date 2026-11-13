import {
  listSessions,
  MediaSession,
  openInSession,
  pauseSession,
  playSession,
  seekSession,
  setSessionVolume,
} from './mediaSessions';
import { SpotifyPlayer, SpotifyTrack } from './types/Spotify';

/**
 * Spotify on this computer: the app tells the system what it plays (MPRIS on Linux, the media
 * controls on Windows). Followed and controlled there first: no calls to the Web API (it allows
 * few), and no Premium needed to play, pause or move in a song. Spotify playing on another
 * device: the Web API.
 */

/** Apps playing Spotify (the official app, or other clients of it) */
export const SPOTIFY_APP = /spotify|spotifast|librespot|ncspot|psst/i;

/**
 * The link of the track ("spotify:track:<id>"): told by the app ("xesam:url", or in its track
 * id: "/com/spotify/track/<id>", or the link written in hexadecimal), else unknown
 */
export function spotifyUriOf(session: MediaSession) {
  const fromUrl = session.url?.match(/(?:spotify:track:|open\.spotify\.com\/track\/)(\w{22})/);
  if (fromUrl) return `spotify:track:${fromUrl[1]}`;
  const trackId = session.trackId ?? '';
  const fromPath = trackId.match(/\/track\/(\w{22})$/);
  if (fromPath) return `spotify:track:${fromPath[1]}`;
  const hex = trackId.match(/\/t((?:[0-9a-f]{2})+)$/i)?.[1];
  const decoded = hex ? Buffer.from(hex, 'hex').toString('utf8') : '';
  return /^spotify:track:\w{22}$/.test(decoded) ? decoded : null;
}

const toTrack = (session: MediaSession, uri: string): SpotifyTrack => ({
  uri,
  name: session.title,
  artists: session.artist,
  durationMs: session.durationMs,
  imageUrl: session.artUrl?.startsWith('https://') ? session.artUrl : undefined,
});

type AppMedia = { session: MediaSession; player: SpotifyPlayer };

/** What the Spotify apps play (the ones that tell which track it is), the one playing first */
async function readApps(): Promise<AppMedia[]> {
  const sessions = await listSessions().catch(() => [] as MediaSession[]);
  return sessions
    .filter((session) => SPOTIFY_APP.test(session.app) || SPOTIFY_APP.test(session.id))
    .map((session) => {
      const uri = spotifyUriOf(session);
      return (
        uri && {
          session,
          player: {
            isPlaying: session.isPlaying,
            progressMs: session.positionMs,
            measuredAt: session.measuredAt,
            volumePercent: session.volume,
            track: toTrack(session, uri),
          },
        }
      );
    })
    .filter((media): media is AppMedia => !!media)
    .sort((a, b) => Number(b.session.isPlaying) - Number(a.session.isPlaying));
}

/** What Spotify plays on this computer (the app playing first), or null */
export async function getPlayer() {
  return (await readApps())[0]?.player ?? null;
}

/** The app with a track (the one playing it first), or null */
async function appWith(uri: string) {
  return (await readApps()).find((media) => media.player.track.uri === uri) ?? null;
}

/**
 * Plays a track from a position (ms) in the app: the one it has, else opened there (Linux).
 * False when no app can play it.
 */
export async function play(uri: string, positionMs: number) {
  let media = await appWith(uri);
  if (!media) {
    const app = (await readApps())[0];
    if (!app) return false;
    try {
      await openInSession(app.session, uri);
    } catch (e) {
      return false;
    }
    // (the app gives it a moment)
    for (let i = 0; i < 20 && !media; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => {
        setTimeout(resolve, 250);
      });
      // eslint-disable-next-line no-await-in-loop
      media = await appWith(uri);
    }
    if (!media) return false;
  }
  await seekSession(media.session, positionMs);
  if (!media.session.isPlaying) await playSession(media.session);
  return true;
}

/** Pauses (every app playing), moves in or sets the volume of the app: false when there is none */
export async function pause() {
  const apps = await readApps();
  if (!apps.length) return false;
  await Promise.all(
    apps.filter((media) => media.session.isPlaying).map((media) => pauseSession(media.session))
  );
  return true;
}

export async function seek(positionMs: number) {
  const media = (await readApps())[0];
  if (!media) return false;
  await seekSession(media.session, positionMs);
  return true;
}

export async function setVolume(percent: number) {
  const media = (await readApps())[0];
  if (!media || media.session.volume === null) return false;
  await setSessionVolume(media.session, percent);
  return true;
}
