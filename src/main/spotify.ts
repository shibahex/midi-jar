import http from 'http';
import crypto from 'crypto';
import { shell } from 'electron';

import { store } from './store';
import { SpotifyAuth, SpotifyPlayer, SpotifyTrack } from './types/Spotify';

/**
 * Spotify Web API: log in with the user's own Spotify app (PKCE, no secret), follow and
 * control the playback. Tokens stay in the main process (never sent to the overlay).
 */

/** The address Spotify sends the login back to: to add to the Spotify app's Redirect URIs */
export const SPOTIFY_REDIRECT_PORT = 43821;
export const SPOTIFY_REDIRECT_URI = `http://127.0.0.1:${SPOTIFY_REDIRECT_PORT}/callback`;

const SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
].join(' ');

const API = 'https://api.spotify.com/v1';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';

const base64url = (buffer: Buffer) =>
  buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const getAuth = () => store.get('spotifyAuth') as SpotifyAuth | undefined;
const setAuth = (auth: SpotifyAuth | undefined) => {
  if (auth) store.set('spotifyAuth', auth);
  else store.delete('spotifyAuth');
};

/** Tokens from Spotify's token endpoint */
async function requestToken(params: Record<string, string>, clientId: string) {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...params, client_id: clientId }).toString(),
  });
  const data = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error_description?: string;
    error?: string;
  };
  if (!response.ok || !data.access_token) {
    throw new Error(
      data.error_description || data.error || `Spotify login failed (${response.status})`
    );
  }
  const previous = getAuth();
  const auth: SpotifyAuth = {
    clientId,
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? previous?.refreshToken ?? '',
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 - 60000,
  };
  setAuth(auth);
  return auth;
}

let pendingLogin: http.Server | null = null;

/**
 * Logs in: opens Spotify's login page in the browser, and waits for it to come back
 * to the local address (2 minutes at most)
 */
export function login(clientId: string): Promise<void> {
  if (!/^[0-9a-f]{32}$/i.test(clientId.trim())) {
    return Promise.reject(
      new Error('The Client ID is 32 letters and digits, from the Spotify app')
    );
  }
  const id = clientId.trim();
  const verifier = base64url(crypto.randomBytes(48));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  const state = base64url(crypto.randomBytes(16));

  pendingLogin?.close();
  return new Promise((resolve, reject) => {
    // set once the server exists: the login is given up after 2 minutes
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const server = http.createServer(async (request, response) => {
      const url = new URL(request.url ?? '/', SPOTIFY_REDIRECT_URI);
      if (url.pathname !== '/callback') {
        response.writeHead(404).end();
        return;
      }
      const finish = (ok: boolean, message: string) => {
        response.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(
          `<html><body style="font-family:sans-serif;background:#222;color:#eee;text-align:center;padding:3em">` +
            `<h2>${
              ok ? 'Connected to Spotify' : 'Spotify login failed'
            }</h2><p>${message}</p></body></html>`
        );
        clearTimeout(timeout);
        server.close();
        pendingLogin = null;
      };
      const error = url.searchParams.get('error');
      if (error || url.searchParams.get('state') !== state) {
        finish(false, error ?? 'The login did not match, try again.');
        reject(new Error(error ? `Spotify: ${error}` : 'The Spotify login did not match'));
        return;
      }
      try {
        await requestToken(
          {
            grant_type: 'authorization_code',
            code: url.searchParams.get('code') ?? '',
            redirect_uri: SPOTIFY_REDIRECT_URI,
            code_verifier: verifier,
          },
          id
        );
        finish(true, 'You can close this tab and go back to MIDI Jar.');
        resolve();
      } catch (e) {
        finish(false, (e as Error).message);
        reject(e);
      }
    });
    timeout = setTimeout(() => {
      server.close();
      pendingLogin = null;
      reject(new Error('The Spotify login took too long'));
    }, 120000);
    pendingLogin = server;
    server.on('error', (e) => {
      clearTimeout(timeout);
      reject(new Error(`The login address could not be opened: ${e.message}`));
    });
    server.listen(SPOTIFY_REDIRECT_PORT, '127.0.0.1', () => {
      const authorize = new URL('https://accounts.spotify.com/authorize');
      authorize.search = new URLSearchParams({
        client_id: id,
        response_type: 'code',
        redirect_uri: SPOTIFY_REDIRECT_URI,
        code_challenge_method: 'S256',
        code_challenge: challenge,
        scope: SCOPES,
        state,
      }).toString();
      shell.openExternal(authorize.toString()).catch(reject);
    });
  });
}

export const logout = () => setAuth(undefined);

/** Logged in to Spotify (it may still need to log in again) */
export const isConnected = () => !!getAuth();

/** A valid access token (refreshed when it expired), or an error */
async function getToken() {
  const auth = getAuth();
  if (!auth) throw new Error('Not connected to Spotify');
  if (Date.now() < auth.expiresAt) return auth.accessToken;
  if (!auth.refreshToken) throw new Error('Connect to Spotify again');
  return (
    await requestToken(
      { grant_type: 'refresh_token', refresh_token: auth.refreshToken },
      auth.clientId
    )
  ).accessToken;
}

/** Spotify asked to wait until then (ms since 1970): no call is made before */
let waitUntil = 0;

/**
 * How long to wait, said simply ("45 s", "about 13 h 15 min, until 3:50 PM"); it ends with
 * the seconds ("(47724 s)") for the game to know when to try again
 */
function waitText(ms: number) {
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 120) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const length = hours ? `${hours} h ${minutes % 60} min` : `${minutes} min`;
  const until = new Date(Date.now() + ms).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
  return `about ${length}, until ${until} (${seconds} s)`;
}

/** A call to the Web API: JSON or null (no content) */
async function api(path: string, init: RequestInit = {}) {
  const waitMs = waitUntil - Date.now();
  if (waitMs > 0) {
    throw new Error(`Spotify asked to wait (too many requests): ${waitText(waitMs)}`);
  }
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${await getToken()}`, 'Content-Type': 'application/json' },
  });
  // too many calls: none until Spotify says (a minute when it does not)
  if (response.status === 429) {
    const seconds = Number(response.headers.get('Retry-After')) || 60;
    waitUntil = Date.now() + seconds * 1000;
    throw new Error(`Spotify asked to wait (too many requests): ${waitText(seconds * 1000)}`);
  }
  if (response.status === 204) return null;
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const reason = data?.error?.reason;
    if (reason === 'PREMIUM_REQUIRED') {
      throw new Error(
        'Spotify Premium is needed for MIDI Jar to start the song: play it in Spotify'
      );
    }
    if (reason === 'NO_ACTIVE_DEVICE' || response.status === 404) {
      throw new Error('No Spotify device is active: open Spotify and play something first');
    }
    throw new Error(data?.error?.message ?? `Spotify error ${response.status}`);
  }
  return data;
}

type ApiTrack = {
  uri: string;
  name: string;
  duration_ms: number;
  artists?: { name: string }[];
  /** the track asked for, when Spotify plays another release of it (relinking) */
  linked_from?: { uri: string };
  popularity?: number;
  album?: { name: string; album_type?: string; images?: { url: string; width?: number }[] };
};

const toTrack = (track: ApiTrack): SpotifyTrack => ({
  uri: track.uri,
  name: track.name,
  artists: (track.artists ?? []).map((a) => a.name).join(', '),
  durationMs: track.duration_ms,
  linkedFromUri: track.linked_from?.uri,
  // the cover, about 300 px wide (the largest one comes first)
  imageUrl: track.album?.images?.[1]?.url ?? track.album?.images?.[0]?.url,
});

/** Who is connected, or null */
export async function getStatus() {
  if (!getAuth()) return { connected: false as const };
  try {
    const me = await api('/me');
    return { connected: true as const, user: (me?.display_name as string) ?? '' };
  } catch (e) {
    return { connected: false as const, error: (e as Error).message };
  }
}

/** What Spotify plays now, and where */
async function askPlayer(): Promise<SpotifyPlayer | null> {
  const asked = Date.now();
  // with a market, Spotify tells which track it relinked from
  const data = await api('/me/player?market=from_token');
  if (!data?.item) return null;
  return {
    isPlaying: !!data.is_playing,
    progressMs: data.progress_ms ?? 0,
    // when Spotify measured the progress (ms): about halfway through the request
    measuredAt: asked + (Date.now() - asked) / 2,
    volumePercent: data.device?.volume_percent ?? null,
    track: toTrack(data.item),
  };
}

/** The last answer about what Spotify plays (asked again only after a moment) */
let lastPlayer: { at: number; player: Promise<SpotifyPlayer | null> } | null = null;
const PLAYER_FRESH_MS = 1000;

/** What Spotify plays now (the game asks from several places: asked once a moment) */
export function getPlayer(): Promise<SpotifyPlayer | null> {
  if (lastPlayer && Date.now() - lastPlayer.at < PLAYER_FRESH_MS) return lastPlayer.player;
  const player = askPlayer();
  lastPlayer = { at: Date.now(), player };
  // (a failure is not kept)
  player.catch(() => {
    lastPlayer = null;
  });
  return player;
}

/**
 * Plays a track from a position (ms). Spotify open but idle for a while is no longer "active":
 * then it is asked to play on one of the user's devices (this computer's first)
 */
export async function play(uri: string, positionMs: number) {
  const body = JSON.stringify({ uris: [uri], position_ms: Math.max(0, Math.round(positionMs)) });
  try {
    return await api('/me/player/play', { method: 'PUT', body });
  } catch (e) {
    if (!/No Spotify device is active/.test((e as Error).message)) throw e;
    const devices: { id: string; type: string; is_restricted: boolean }[] =
      (await api('/me/player/devices'))?.devices ?? [];
    const usable = devices.filter((d) => d.id && !d.is_restricted);
    const device = usable.find((d) => d.type === 'Computer') ?? usable[0];
    if (!device) throw e;
    return api(`/me/player/play?device_id=${encodeURIComponent(device.id)}`, {
      method: 'PUT',
      body,
    });
  }
}

export const pause = () => api('/me/player/pause', { method: 'PUT' });

/** Volume of the Spotify device (Premium) */
export const setVolume = (percent: number) =>
  api(`/me/player/volume?volume_percent=${Math.max(0, Math.min(100, Math.round(percent)))}`, {
    method: 'PUT',
  });

export const seek = (positionMs: number) =>
  api(`/me/player/seek?position_ms=${Math.max(0, Math.round(positionMs))}`, { method: 'PUT' });

/**
 * Where the bars start in a track (ms), from Spotify's audio analysis, or null: Spotify
 * no longer gives it to apps created after November 2024
 */
export async function getBars(uri: string): Promise<number[] | null> {
  try {
    const data = await api(`/audio-analysis/${uri.split(':').pop()}`);
    const bars = (data?.bars ?? []) as { start: number }[];
    return bars.length ? bars.map((bar) => Math.round(bar.start * 1000)) : null;
  } catch (e) {
    return null;
  }
}

/** The first track found for a song name, or null */
/** Words of versions other than the studio one (unless the song asked for is one of them) */
const OTHER_VERSIONS =
  /\b(live|acoustic|remix|demo|instrumental|karaoke|cover|session|unplugged|sped up|slowed|reverb)\b/i;

/**
 * The studio version of a song: its name first, then not a live (or remixed...) version,
 * then not from a compilation, then the most listened to
 */
export async function search(query: string): Promise<SpotifyTrack | null> {
  const data = await api(`/search?type=track&limit=10&q=${encodeURIComponent(query)}`);
  const tracks: ApiTrack[] = data?.tracks?.items ?? [];
  if (!tracks.length) return null;
  const words = query.toLowerCase();
  const wantsOther = OTHER_VERSIONS.test(query);
  const score = (track: ApiTrack) => {
    const name = track.name.toLowerCase().replace(/\s*[-(].*$/, '');
    const other =
      !wantsOther &&
      (OTHER_VERSIONS.test(track.name) || OTHER_VERSIONS.test(track.album?.name ?? ''));
    return (
      (name && words.includes(name) ? 1000 : 0) -
      (other ? 500 : 0) -
      (track.album?.album_type === 'compilation' ? 100 : 0) +
      (track.popularity ?? 0)
    );
  };
  const best = tracks.reduce((a, b) => (score(b) > score(a) ? b : a));
  return toTrack(best);
}
