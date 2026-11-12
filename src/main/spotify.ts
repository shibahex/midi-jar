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

/** A call to the Web API: JSON or null (no content) */
async function api(path: string, init: RequestInit = {}) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${await getToken()}`, 'Content-Type': 'application/json' },
  });
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
};

const toTrack = (track: ApiTrack): SpotifyTrack => ({
  uri: track.uri,
  name: track.name,
  artists: (track.artists ?? []).map((a) => a.name).join(', '),
  durationMs: track.duration_ms,
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
export async function getPlayer(): Promise<SpotifyPlayer | null> {
  const asked = Date.now();
  const data = await api('/me/player');
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

/** Plays a track from a position (ms) */
export const play = (uri: string, positionMs: number) =>
  api('/me/player/play', {
    method: 'PUT',
    body: JSON.stringify({ uris: [uri], position_ms: Math.max(0, Math.round(positionMs)) }),
  });

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
export async function search(query: string): Promise<SpotifyTrack | null> {
  const data = await api(`/search?type=track&limit=1&q=${encodeURIComponent(query)}`);
  const track = data?.tracks?.items?.[0];
  return track ? toTrack(track) : null;
}
