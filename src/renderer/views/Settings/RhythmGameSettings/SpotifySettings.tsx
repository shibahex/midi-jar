import React, { useCallback, useEffect, useState } from 'react';
import classnames from 'classnames/bind';
import { Button, FormControlLabel, FormField, Input, Select, Switch } from '@la-jarre-a-son/ui';

import { useSettings } from 'renderer/contexts/Settings';
import { Icon } from 'renderer/components';
import { ImportedSong, SpotifyStatus, SpotifyTrack } from 'main/types';
import { sourceName, spotifyLinkFor } from 'renderer/helpers';
import { COMPUTER_SOUND, getSoundInputs } from 'renderer/helpers/audioSync';

import styles from '../ChordQuizSettings/ChordQuizSettings.module.scss';

const cx = classnames.bind(styles);

const SYNCED_BY = {
  estimate: 'estimated, corrected as you play',
  tap: 'set by hand',
  playing: 'from your playing',
  listening: 'by listening to it',
  parts: 'by listening to parts of it',
};

/** Messages of the main process: "Error invoking remote method ...: Error: message" */
const errorText = (e: unknown) =>
  e instanceof Error ? e.message.replace(/^.*Error: /, '') : String(e);

/**
 * Spotify: the user's own Spotify app (Client ID), the login, and syncing the game with it
 */
export const SpotifySettings: React.FC = () => {
  const { settings, updateSetting } = useSettings();
  const game = settings.rhythmGame;
  const [clientId, setClientId] = useState(game.spotifyClientId ?? '');
  const [status, setStatus] = useState<SpotifyStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [redirectUri, setRedirectUri] = useState('');

  const refresh = useCallback(() => {
    window.app.spotify
      .status()
      .then(setStatus)
      .catch((e) => setError(errorText(e)));
  }, []);

  useEffect(() => {
    refresh();
    window.app.spotify
      .redirectUri()
      .then(setRedirectUri)
      .catch(() => {});
  }, [refresh]);

  const connect = async () => {
    setBusy(true);
    setError('');
    try {
      await updateSetting('rhythmGame.spotifyClientId', clientId.trim());
      await window.app.spotify.login(clientId.trim());
      refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  // sound inputs to listen to the song (named once allowed to listen)
  const listenSync = !!game.spotifySync;
  const [inputs, setInputs] = useState<{ id: string; label: string }[]>([]);
  useEffect(() => {
    if (!listenSync) return;
    navigator.mediaDevices
      ?.getUserMedia({ audio: true })
      .then((stream) => stream.getTracks().forEach((track) => track.stop()))
      .catch(() => {})
      .then(getSoundInputs)
      .then(setInputs)
      .catch(() => setInputs([]));
  }, [listenSync]);

  // MIDI Jar's browser extension: every YouTube tab, not only the one the browser tells
  const [extension, setExtension] = useState<{ path: string; connected: boolean } | null>(null);
  useEffect(() => {
    const check = () =>
      window.app.youtube
        .extension()
        .then(setExtension)
        .catch(() => {});
    check();
    const timer = setInterval(check, 3000);
    return () => clearInterval(timer);
  }, []);

  const disconnect = async () => {
    await window.app.spotify.logout();
    refresh();
  };

  return (
    <div className={cx('group')}>
      <div className={cx('groupTitle')}>
        <Icon name="music" />
        Spotify &amp; YouTube
      </div>
      <div className={cx('groupHint')}>
        Play your songs with the real recording, in time with the game. YouTube needs no account:
        play the video in your browser and the game follows it (Linux and Windows).
      </div>
      {!status?.connected && (
        <div className={cx('groupHint')}>
          To connect, once:
          <ol className={cx('steps')}>
            <li>
              Create an app on{' '}
              <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer">
                developer.spotify.com/dashboard
              </a>{' '}
              (any name, &quot;Web API&quot; checked)
            </li>
            <li>
              Add this Redirect URI to it: <code className={cx('code')}>{redirectUri}</code>
            </li>
            <li>Paste its Client ID below and connect</li>
          </ol>
          Starting songs from the game needs Spotify Premium; without it, play them in Spotify and
          the game follows. For YouTube alone, skip this.
        </div>
      )}

      <div className={cx('spotifyLogin')}>
        <Input
          value={clientId}
          onChange={setClientId}
          placeholder="Client ID"
          aria-label="Spotify Client ID"
          block
        />
        {status?.connected ? (
          <Button intent="neutral" onClick={disconnect}>
            Disconnect
          </Button>
        ) : (
          <Button intent="primary" onClick={connect} disabled={busy || !clientId.trim()}>
            {busy ? 'Waiting for the browser...' : 'Connect'}
          </Button>
        )}
      </div>
      <div className={cx('importMessage', { 'importMessage--error': !!error })}>
        {error ||
          (status?.connected && `Connected to Spotify${status.user ? ` as ${status.user}` : ''}`) ||
          (status && !status.connected && (status.error ?? 'Not connected'))}
      </div>

      <FormControlLabel
        label="Play With The Recording"
        hint="Your songs play on Spotify or YouTube and the game follows the recording (no slowing down or waiting on a miss)"
        reverse
      >
        <Switch
          checked={!!game.spotifySync}
          onChange={(value) => updateSetting('rhythmGame.spotifySync', value)}
        />
      </FormControlLabel>

      {game.spotifySync && (
        <FormField
          label="Listen To"
          hint="To sync songs, the game listens to the recording: the sound of the computer hears it best (PipeWire or PulseAudio on Linux, or Windows); a microphone near the speakers works too"
        >
          <Select
            aria-label="Sound input"
            options={[
              { value: COMPUTER_SOUND, label: 'The sound of the computer' },
              ...inputs
                .filter((input) => input.id)
                .map((input) => ({
                  value: input.id,
                  label: input.id === 'default' ? 'The default input (microphone)' : input.label,
                })),
            ]}
            value={game.syncInput || COMPUTER_SOUND}
            onChange={(value) => updateSetting('rhythmGame.syncInput', value)}
          />
        </FormField>
      )}

      <FormField
        label="Browser Extension"
        hint="To see every YouTube video playing (not only the last one of each browser), and play, pause or move the very tab: add it to your browser once"
      >
        <div className={cx('groupHint')}>
          {extension?.connected ? (
            <strong>Connected: every YouTube tab is seen</strong>
          ) : (
            <ol className={cx('steps')}>
              <li>
                Chrome, Chromium, Edge, Brave: open{' '}
                <code className={cx('code')}>chrome://extensions</code>, turn on Developer mode,
                then &quot;Load unpacked&quot; and pick this folder
              </li>
              <li>
                Firefox: open{' '}
                <code className={cx('code')}>about:debugging#/runtime/this-firefox</code>,
                &quot;Load Temporary Add-on&quot;, and pick{' '}
                <code className={cx('code')}>manifest.json</code> in this folder
              </li>
            </ol>
          )}
          <code className={cx('code')}>{extension?.path}</code>{' '}
          <Button
            size="sm"
            variant="ghost"
            intent="neutral"
            onClick={() => window.app.youtube.openExtension()}
          >
            Open the folder
          </Button>
        </div>
      </FormField>

      {game.spotifySync && (
        <FormControlLabel
          label="Sync Before Playing Along"
          hint="Playing along with a song not synced by listening yet: parts of it are heard first (about a minute), then the game joins it. Off: it joins at once, synced by its estimate (sync it later from the song's card)"
          reverse
        >
          <Switch
            checked={!!game.syncBeforeJoin}
            onChange={(value) => updateSetting('rhythmGame.syncBeforeJoin', value)}
          />
        </FormControlLabel>
      )}
    </div>
  );
};

/**
 * The Spotify (or YouTube) link of an imported song: find it on Spotify or YouTube, or paste
 * a YouTube link, and adjust where its first chord is
 */
export const SpotifySongLink: React.FC<{
  song: ImportedSong;
  onChange: (spotify: ImportedSong['spotify'] | undefined) => void;
}> = ({ song, onChange }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // a linked track is synced right away: where the first chord is, estimated
  const link = async (track: SpotifyTrack) => onChange(await spotifyLinkFor(song, track));

  // the song name without "by" (without what is between brackets, like "(AI)": not part of
  // the name on Spotify or YouTube)
  const query = song.title.replace(/\s*[([][^)\]]*[)\]]/g, '').replace(/\s+by\s+/i, ' ');

  /** Links the track found (busy meanwhile, an error shown when there is none) */
  const linkFound = async (findTrack: () => Promise<SpotifyTrack | null | undefined>) => {
    setBusy(true);
    setError('');
    try {
      const track = await findTrack();
      if (!track) throw new Error('Not found');
      await link(track);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  // then the one playing in Spotify if nothing is found
  const find = () =>
    linkFound(
      async () =>
        (await window.app.spotify.search(query)) ?? (await window.app.spotify.player())?.track
    );

  const findOnYouTube = () => linkFound(() => window.app.youtube.search(query));

  // a video's link pasted
  const [videoLink, setVideoLink] = useState('');
  const linkVideo = () => linkFound(() => window.app.youtube.video(videoLink));

  const useCurrent = async () => {
    setError('');
    try {
      const player = await window.app.spotify.player();
      if (!player) throw new Error('Nothing plays in Spotify');
      await link(player.track);
    } catch (e) {
      setError(errorText(e));
    }
  };

  // (the beats heard move with it: still synced by listening)
  const nudge = (ms: number) => {
    if (!song.spotify) return;
    const firstChordMs = Math.max(0, (song.spotify.firstChordMs ?? 0) + ms);
    const moved = firstChordMs - (song.spotify.firstChordMs ?? 0);
    onChange({
      ...song.spotify,
      firstChordMs,
      syncedBy: song.spotify.beatTimes ? song.spotify.syncedBy : 'tap',
      beatTimes: song.spotify.beatTimes?.map((beatMs) => beatMs + moved),
    });
  };

  if (!song.spotify) {
    return (
      <div className={cx('spotifySong')}>
        <Button size="sm" intent="neutral" onClick={find} disabled={busy}>
          {busy ? 'Searching...' : 'Find on Spotify'}
        </Button>
        <Button size="sm" intent="neutral" onClick={findOnYouTube} disabled={busy}>
          Find on YouTube
        </Button>
        <Button size="sm" variant="ghost" intent="neutral" onClick={useCurrent}>
          Use the one playing
        </Button>
        <Input
          size="sm"
          value={videoLink}
          onChange={setVideoLink}
          placeholder="or a YouTube link"
          aria-label="YouTube link"
        />
        {videoLink.trim() && (
          <Button size="sm" intent="neutral" onClick={linkVideo} disabled={busy}>
            Link
          </Button>
        )}
        {error && <span className={cx('importMessage', 'importMessage--error')}>{error}</span>}
      </div>
    );
  }

  return (
    <div className={cx('spotifySong')}>
      <span className={cx('spotifyName')} title={song.spotify.uri}>
        {sourceName(song.spotify.uri)}: {song.spotify.name}
      </span>
      {song.spotify.firstChordMs === undefined ? (
        <span className={cx('spotifyHint')}>not synced yet (Sync in the game)</span>
      ) : (
        <span className={cx('spotifyOffset')} title="Where the first chord is in the recording">
          first chord at {(song.spotify.firstChordMs / 1000).toFixed(2)} s
          {song.spotify.beatTimes && song.spotify.syncedBy !== 'parts'
            ? ' (every beat found by listening to the whole song)'
            : song.spotify.syncedBy && ` (${SYNCED_BY[song.spotify.syncedBy]})`}
          <button type="button" onClick={() => nudge(-50)} title="50 ms earlier">
            −
          </button>
          <button type="button" onClick={() => nudge(50)} title="50 ms later">
            +
          </button>
        </span>
      )}
      <button
        type="button"
        className={cx('spotifyUnlink')}
        onClick={() => onChange(undefined)}
        title={`Unlink from ${sourceName(song.spotify.uri)}`}
      >
        Unlink
      </button>
    </div>
  );
};
