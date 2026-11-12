import React, { useCallback, useEffect, useState } from 'react';
import classnames from 'classnames/bind';
import { Button, FormControlLabel, FormField, Input, Select, Switch } from '@la-jarre-a-son/ui';

import { useSettings } from 'renderer/contexts/Settings';
import { Icon } from 'renderer/components';
import { ImportedSong, SpotifyStatus, SpotifyTrack } from 'main/types';
import { estimateFirstChordMs } from 'renderer/helpers';
import { COMPUTER_SOUND, getSoundInputs } from 'renderer/helpers/audioSync';

import styles from '../ChordQuizSettings/ChordQuizSettings.module.scss';

const cx = classnames.bind(styles);

const SYNCED_BY = {
  estimate: 'estimated, corrected as you play',
  tap: 'set by hand',
  playing: 'from your playing',
  listening: 'by listening to it',
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
  const listenSync = game.listenSync !== false;
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

  const disconnect = async () => {
    await window.app.spotify.logout();
    refresh();
  };

  return (
    <div className={cx('group')}>
      <div className={cx('groupTitle')}>
        <Icon name="music" />
        Spotify
      </div>
      <div className={cx('groupHint')}>
        Play imported songs on Spotify in time with the game. Once:
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
        Then link a song to Spotify in the list of imported songs, and sync it once (tap on its
        first chord). Starting the song from the game needs Spotify Premium; without it, press play
        in Spotify and the game follows.
      </div>

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
        label="Sync With Spotify"
        hint="Songs linked to Spotify play there, and the game follows them (at the song's tempo: no slow down or wait on a miss)"
        reverse
      >
        <Switch
          checked={!!game.spotifySync}
          onChange={(value) => updateSetting('rhythmGame.spotifySync', value)}
        />
      </FormControlLabel>

      <FormControlLabel
        label="Sync By Listening"
        hint="While a song plays on Spotify, the game listens to it and moves the sync to match (its own sound is off for a few seconds meanwhile)"
        reverse
      >
        <Switch
          checked={listenSync}
          onChange={(value) => updateSetting('rhythmGame.listenSync', value)}
        />
      </FormControlLabel>

      {listenSync && (
        <FormField
          label="Listen To"
          hint="The sound of the computer hears Spotify best (Linux, with PipeWire or PulseAudio); a microphone near the speakers works too"
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
    </div>
  );
};

/**
 * The Spotify link of an imported song: find it on Spotify, and adjust where its first chord is
 */
export const SpotifySongLink: React.FC<{
  song: ImportedSong;
  onChange: (spotify: ImportedSong['spotify'] | undefined) => void;
}> = ({ song, onChange }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // a linked track is synced right away: where the first chord is, estimated
  const link = async (track: SpotifyTrack) => {
    const bars = await window.app.spotify.bars(track.uri).catch(() => null);
    const firstChordMs = estimateFirstChordMs(song, track.durationMs, bars) ?? undefined;
    onChange({
      uri: track.uri,
      name: `${track.name} (${track.artists})`,
      durationMs: track.durationMs,
      firstChordMs,
      syncedBy: firstChordMs !== undefined ? 'estimate' : undefined,
    });
  };

  const find = async () => {
    setBusy(true);
    setError('');
    try {
      // the song name without "by", then the one playing in Spotify if nothing is found
      const query = song.title.replace(/\s+by\s+/i, ' ');
      const track =
        (await window.app.spotify.search(query)) ?? (await window.app.spotify.player())?.track;
      if (!track) throw new Error('Not found on Spotify');
      await link(track);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

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

  const nudge = (ms: number) =>
    song.spotify &&
    onChange({
      ...song.spotify,
      firstChordMs: Math.max(0, (song.spotify.firstChordMs ?? 0) + ms),
      syncedBy: 'tap',
    });

  if (!song.spotify) {
    return (
      <div className={cx('spotifySong')}>
        <Button size="sm" intent="neutral" onClick={find} disabled={busy}>
          {busy ? 'Searching...' : 'Find on Spotify'}
        </Button>
        <Button size="sm" variant="ghost" intent="neutral" onClick={useCurrent}>
          Use the one playing
        </Button>
        {error && <span className={cx('importMessage', 'importMessage--error')}>{error}</span>}
      </div>
    );
  }

  return (
    <div className={cx('spotifySong')}>
      <span className={cx('spotifyName')} title={song.spotify.uri}>
        Spotify: {song.spotify.name}
      </span>
      {song.spotify.firstChordMs === undefined ? (
        <span className={cx('spotifyHint')}>not synced yet (Sync in the game)</span>
      ) : (
        <span className={cx('spotifyOffset')} title="Where the first chord is in the recording">
          first chord at {(song.spotify.firstChordMs / 1000).toFixed(2)} s
          {song.spotify.syncedBy && ` (${SYNCED_BY[song.spotify.syncedBy]})`}
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
        title="Unlink from Spotify"
      >
        Unlink
      </button>
    </div>
  );
};
