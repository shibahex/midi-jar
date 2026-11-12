import React, { useRef, useState } from 'react';
import classnames from 'classnames/bind';
import {
  Button,
  Container,
  Switch,
  FormField,
  FormControlLabel,
  Input,
  Slider,
  Select,
  Toolbar,
} from '@la-jarre-a-son/ui';

import { useSettings } from 'renderer/contexts/Settings';
import { Icon, ScrollContainer } from 'renderer/components';
import {
  getAllSongs,
  getIncludedSongs,
  getSongsterrTrackUrls,
  isSongsterrUrl,
  parseChordSheet,
  parseSongPage,
  readSongsterrPage,
  songFromSongsterr,
} from 'renderer/helpers';
import { ImportedSong } from 'main/types';

import ToggleList, { useExcludedList } from '../ToggleList';
import { fields } from './constants';

import styles from '../ChordQuizSettings/ChordQuizSettings.module.scss';

const cx = classnames.bind(styles);

const NO_ITEMS: string[] = [];
const NO_SONGS: ImportedSong[] = [];

const SONG_FILES = '.cho,.chordpro,.chopro,.pro,.crd,.txt';

/**
 * Songs imported from chord sheets: a file is read and added, or removed from the list
 */
const ImportSongs: React.FC<{ songs: ImportedSong[] }> = ({ songs }) => {
  const { updateSetting } = useSettings();
  const input = useRef<HTMLInputElement>(null);
  const [messages, setMessages] = useState<{ text: string; error: boolean }[]>([]);

  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);

  const save = async (added: ImportedSong[], errors: string[]) => {
    if (added.length) {
      // a song imported again replaces the old one (and keeps its place in the game)
      const same = (a: ImportedSong, b: ImportedSong) =>
        (!!a.url && a.url === b.url) || a.title.toLowerCase() === b.title.toLowerCase();
      const replaced = songs.map((song) => {
        const update = added.find((a) => same(a, song));
        return update ? { ...update, id: song.id } : song;
      });
      const fresh = added.filter((a) => !songs.some((song) => same(a, song)));
      await updateSetting('rhythmGame.customSongs', [...replaced, ...fresh]);
    }
    setMessages([
      ...added.map((song) => ({
        text: `Imported ${song.title} (${song.chords.length} chords)`,
        error: false,
      })),
      ...errors.map((text) => ({ text, error: true })),
    ]);
  };

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const added: ImportedSong[] = [];
    const errors: string[] = [];
    await Promise.all(
      [...files].map(async (file, index) => {
        const result = parseChordSheet(await file.text(), file.name);
        if ('error' in result) errors.push(`${file.name}: ${result.error}`);
        else added.push({ id: `imported-${Date.now()}-${index}`, ...result });
      })
    );
    await save(added, errors);
    if (input.current) input.current.value = '';
  };

  const onUrl = async () => {
    const address = url.trim();
    if (!address || loading) return;
    setLoading(true);
    setMessages([]);
    try {
      const fullAddress = /^https?:\/\//i.test(address) ? address : `https://${address}`;
      const page = await window.app.fetchPage(fullAddress);
      let result: ReturnType<typeof parseSongPage>;
      const songsterr = isSongsterrUrl(fullAddress) ? readSongsterrPage(page) : null;
      if (songsterr) {
        // Songsterr: the notes of the rhythm guitar and the bass give the chords and timing
        const tracks = await Promise.all(
          getSongsterrTrackUrls(songsterr).map(async (trackUrl) =>
            JSON.parse(await window.app.fetchPage(trackUrl))
          )
        );
        result = songFromSongsterr(songsterr, tracks, fullAddress);
      } else {
        result = parseSongPage(page, fullAddress);
      }
      if ('error' in result) {
        await save([], [result.error]);
      } else {
        await save([{ id: `imported-${Date.now()}`, ...result, url: fullAddress }], []);
        setUrl('');
      }
    } catch (e) {
      // errors from the main process come as "Error invoking remote method ...: Error: message"
      const message = e instanceof Error ? e.message.replace(/^.*Error: /, '') : String(e);
      await save([], [`The page could not be loaded: ${message}`]);
    } finally {
      setLoading(false);
    }
  };

  // the tempo of a song, typed in (empty: no tempo of its own)
  const setTempo = (id: string, value: string) => {
    const bpm = Math.round(Number(value));
    updateSetting(
      'rhythmGame.customSongs',
      songs.map((song) => {
        if (song.id !== id) return song;
        const { bpm: _old, ...rest } = song;
        return value && bpm > 0 ? { ...rest, bpm: Math.min(300, bpm) } : rest;
      })
    );
  };

  const remove = (id: string) =>
    updateSetting(
      'rhythmGame.customSongs',
      songs.filter((song) => song.id !== id)
    );

  return (
    <div className={cx('import')}>
      <input
        ref={input}
        type="file"
        accept={SONG_FILES}
        multiple
        hidden
        onChange={(e) => onFiles(e.target.files)}
      />
      <Button intent="neutral" onClick={() => input.current?.click()}>
        <Icon name="plus" />
        Import song files
      </Button>
      <form
        className={cx('importUrl')}
        onSubmit={(e) => {
          e.preventDefault();
          onUrl();
        }}
      >
        <Input
          value={url}
          onChange={setUrl}
          placeholder="or paste a web address (Songsterr, Ultimate Guitar...)"
          aria-label="Web address of a song's chords"
          block
        />
        <Button type="submit" intent="primary" disabled={!url.trim() || loading}>
          {loading ? 'Loading...' : 'Import'}
        </Button>
      </form>
      {messages.map(({ text, error }) => (
        <div key={text} className={cx('importMessage', { 'importMessage--error': error })}>
          {text}
        </div>
      ))}
      {songs.length > 0 && (
        <ul className={cx('importedSongs')}>
          {songs.map((song) => (
            <li key={song.id}>
              <span>
                {song.title}{' '}
                <small>
                  ({song.chords.length} chords, key of {song.key}
                  {song.beatsPerBar && song.beatsPerBar !== 4 ? `, ${song.beatsPerBar}/4` : ''})
                </small>
              </span>
              <span className={cx('songTempo')} title="Tempo of this song (beats per minute)">
                <input
                  type="number"
                  min={30}
                  max={300}
                  placeholder="BPM?"
                  aria-label={`Tempo of ${song.title}`}
                  value={song.bpm ?? ''}
                  onChange={(e) => setTempo(song.id, e.target.value)}
                />
                BPM
              </span>
              <Button
                icon
                size="sm"
                variant="ghost"
                intent="danger"
                aria-label={`Remove ${song.title}`}
                title="Remove"
                onClick={() => remove(song.id)}
              >
                <Icon name="trash" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

const RhythmGameSettings: React.FC = () => {
  const { settings, updateSetting, resetSettings } = useSettings();
  const game = settings.rhythmGame;
  const importedSongs = game.customSongs ?? NO_SONGS;

  const [excludedSongs, toggleSong] = useExcludedList(
    game.excludedSongs ?? NO_ITEMS,
    'rhythmGame.excludedSongs'
  );

  return (
    <>
      <ScrollContainer pad="md">
        <Container size="md">
          <FormField label="Song" hint="Play one song, or random songs">
            <Select
              options={[
                { value: '', label: 'Random song' },
                ...getAllSongs(importedSongs).map((song) => ({
                  value: song.id,
                  label: song.title,
                })),
              ]}
              onChange={(value) => updateSetting('rhythmGame.song', value)}
              value={game.song ?? ''}
            />
          </FormField>

          <FormField label="Songs" hint="Choose which songs are played at random">
            <ToggleList
              items={getAllSongs(importedSongs).map((song) => ({ id: song.id, label: song.title }))}
              included={getIncludedSongs(excludedSongs, importedSongs).map((song) => song.id)}
              onToggle={toggleSong}
              hint="Click a song to leave it out or play it again"
            />
          </FormField>

          <FormField
            label="Import Songs"
            hint="ChordPro files (.cho, .chordpro, .pro...), chord sheets (.txt, chords above the lyrics, bar lines like | C G | Am | for how long chords last) or the web address of a song: Songsterr (the chords are read from the notes of the rhythm guitar and bass, with the real tempo, timing and sections), Ultimate Guitar chords or other chord sites. Played in the key of the song, a bar per chord unless bar lines tell otherwise. Importing a song again replaces it. Type a song's tempo if it has none (Ultimate Guitar only gives it with a strumming pattern, not on tab pages)."
          >
            <ImportSongs songs={importedSongs} />
          </FormField>

          <FormField label="Tempo" hint="Beats per minute">
            <Slider
              value={game.tempo}
              onChange={(value: number) => updateSetting('rhythmGame.tempo', value)}
              min={50}
              max={140}
              step={5}
              marks={[50, 80, 110, 140]}
              valueText={`${game.tempo}`}
            />
          </FormField>

          <FormControlLabel
            label="Song's Tempo"
            hint="Play imported songs at their own tempo when they have one (ChordPro {tempo}, Ultimate Guitar strumming), instead of the tempo above"
            reverse
          >
            <Switch
              onChange={(value) => updateSetting('rhythmGame.songTempo', value)}
              checked={!!game.songTempo}
            />
          </FormControlLabel>

          <FormField
            label="Pattern"
            hint="How often each chord is played: the song's own rhythm (how long each chord lasts, the strumming of Ultimate Guitar songs), or a fixed pattern. A chord is always played when it changes."
          >
            <Select
              options={fields.pattern.choices}
              onChange={(value) => updateSetting('rhythmGame.pattern', value)}
              value={game.pattern ?? 'song'}
            />
          </FormField>

          <div className={cx('group')}>
            <div className={cx('groupTitle')}>
              <Icon name="refresh" />
              Practice
            </div>
            <div className={cx('groupHint')}>
              On the game screen, switch to Practice to pick the sections of the song to play (click
              the first one, then the last one), the speed and the loop.
            </div>

            <FormField label="Practice Speed" hint="Speed of the song in practice, in percent">
              <Slider
                value={game.practiceSpeed ?? 100}
                onChange={(value: number) => updateSetting('rhythmGame.practiceSpeed', value)}
                min={50}
                max={150}
                step={5}
                marks={[50, 75, 100, 125, 150]}
                valueText={`${game.practiceSpeed ?? 100}%`}
              />
            </FormField>

            <FormControlLabel label="Loop" hint="Play the sections again and again" reverse>
              <Switch
                onChange={(value) => updateSetting('rhythmGame.practiceLoop', value)}
                checked={!!game.practiceLoop}
              />
            </FormControlLabel>

            <FormControlLabel
              label="Speed Up Each Loop"
              hint="5% faster after a loop with no miss, up to the real speed"
              reverse
            >
              <Switch
                onChange={(value) => updateSetting('rhythmGame.practiceRamp', value)}
                checked={!!game.practiceRamp}
                disabled={!game.practiceLoop}
              />
            </FormControlLabel>
          </div>

          <FormControlLabel
            label="Speed Up"
            hint="The song gets faster as you play well: 5% every 4 chords in a row, up to 1.5 times the tempo"
            reverse
          >
            <Switch
              onChange={(value) => updateSetting('rhythmGame.speedUp', value)}
              checked={!!game.speedUp}
            />
          </FormControlLabel>

          <FormField label="Song Name" hint="Show the name of the song, or keep it a mystery">
            <Select
              options={fields.showTitle.choices}
              onChange={(value) => updateSetting('rhythmGame.showTitle', value)}
              value={game.showTitle ?? 'start'}
            />
          </FormField>

          <FormField
            label="Key"
            hint="Key of the built-in songs (imported songs are played in their own key; a minor song in the current key is played in its relative minor)"
          >
            <Select
              options={fields.songKey.choices}
              onChange={(value) => updateSetting('rhythmGame.songKey', value)}
              value={game.songKey}
            />
          </FormField>

          {game.songKey !== 'current' && (
            <FormField
              label="Keys"
              hint="Choose if built-in songs can be played in sharp or flat keys (C#, Bb...)"
            >
              <Select
                options={fields.tonics.choices}
                onChange={(value) => updateSetting('rhythmGame.tonics', value)}
                value={game.tonics}
              />
            </FormField>
          )}

          <FormControlLabel
            label="Learning Mode"
            hint="Displays a piano keyboard with the keys of the chord to play"
            reverse
          >
            <Switch
              onChange={(value) => updateSetting('rhythmGame.learningMode', value)}
              checked={game.learningMode}
            />
          </FormControlLabel>

          {game.learningMode && (
            <>
              <FormField label="Fingering" hint="Displays finger numbers (1 is thumb, 5 is pinky)">
                <Select
                  options={fields.fingering.choices}
                  onChange={(value) => updateSetting('rhythmGame.fingering', value)}
                  value={game.fingering}
                />
              </FormField>

              <FormField
                label="On a Miss"
                hint="Keep going, stop until the missed chord is played, or slow the song down (it speeds back up after 4 hits in a row)"
              >
                <Select
                  options={fields.onMiss.choices}
                  onChange={(value) => updateSetting('rhythmGame.onMiss', value)}
                  value={game.onMiss ?? 'continue'}
                />
              </FormField>
            </>
          )}

          <FormControlLabel label="Gamification" hint="Shows the score and the combo" reverse>
            <Switch
              onChange={(value) => updateSetting('rhythmGame.gamification', value)}
              checked={game.gamification}
            />
          </FormControlLabel>
        </Container>
      </ScrollContainer>
      <Toolbar elevation={2} placement="bottom">
        <Button onClick={() => resetSettings('rhythmGame')} intent="neutral">
          <Icon name="reset" />
          Reset to Defaults
        </Button>
      </Toolbar>
    </>
  );
};

export default RhythmGameSettings;
