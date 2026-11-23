import React, { useRef, useState } from 'react';
import classnames from 'classnames/bind';
import {
  Button,
  Container,
  Switch,
  FormField,
  FormControlLabel,
  Input,
  Select,
  Toolbar,
} from '@la-jarre-a-son/ui';

import { useSettings } from 'renderer/contexts/Settings';
import { Icon, InputNumber, ScrollContainer } from 'renderer/components';
import {
  getAllSongs,
  getIncludedSongs,
  importSongFromWeb,
  parseChordSheet,
} from 'renderer/helpers';
import { ImportedSong, SongPartRole } from 'main/types';

import ToggleList, { useExcludedList } from '../ToggleList';
import SongLibrary from '../../RhythmGame/SongLibrary';
import { SpotifySettings } from './SpotifySettings';
import { fields } from './constants';

import styles from '../ChordQuizSettings/ChordQuizSettings.module.scss';

const cx = classnames.bind(styles);

const NO_ITEMS: string[] = [];
const NO_SONGS: ImportedSong[] = [];

/** parts of Songsterr songs that can be heard */
export const PART_LABELS: { id: SongPartRole; label: string }[] = [
  { id: 'rhythm', label: 'Rhythm guitar' },
  { id: 'bass', label: 'Bass' },
  { id: 'lead', label: 'Lead guitar' },
  { id: 'melody', label: 'Melody (vocals)' },
];

const SONG_FILES = '.cho,.chordpro,.chopro,.pro,.crd,.txt';

/**
 * Songs imported from chord sheets: a file is read and added, or removed from the list
 */
const ImportSongs: React.FC<{ songs: ImportedSong[] }> = ({ songs }) => {
  const { settings, updateSetting } = useSettings();
  const input = useRef<HTMLInputElement>(null);
  const [messages, setMessages] = useState<{ text: string; error: boolean }[]>([]);

  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);

  const save = async (added: ImportedSong[], errors: string[]) => {
    if (added.length) {
      // a song imported again replaces the old one (and keeps its place in the game)
      const same = (a: ImportedSong, b: ImportedSong) =>
        (!!a.url && a.url === b.url) || a.title.toLowerCase() === b.title.toLowerCase();
      // how long a song is (beats): as long, its bars are where they were
      const beatsOf = (song: ImportedSong) =>
        Math.round((song.leadIn ?? 0) + (song.beats ?? []).reduce((sum, beats) => sum + beats, 0));
      const replaced = songs.map((song) => {
        const update = added.find((a) => same(a, song));
        if (!update) return song;
        // its Spotify link is kept; where each beat is in the recording too, when the bars
        // are the same (else the tempo found in the recording was for the old chart)
        const sameBars = !!song.beats && !!update.beats && beatsOf(song) === beatsOf(update);
        const spotify =
          song.spotify &&
          (sameBars ? song.spotify : { ...song.spotify, bpm: undefined, beatTimes: undefined });
        return { ...update, id: song.id, ...(spotify && { spotify }) };
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
      // a web address, or a song name to find on Songsterr
      const result = await importSongFromWeb(address);
      await save([{ id: `imported-${Date.now()}`, ...result }], []);
      setUrl('');
    } catch (e) {
      // errors from the main process come as "Error invoking remote method ...: Error: message"
      const message = e instanceof Error ? e.message.replace(/^.*Error: /, '') : String(e);
      await save([], [`The song could not be imported: ${message}`]);
    } finally {
      setLoading(false);
    }
  };

  // the songs: picked, edited (tempo, link), removed (the song library of the game)
  const [libraryOpen, setLibraryOpen] = useState(false);
  const chosen = settings.rhythmGame.song ?? '';

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
          placeholder="or a web address, or a song name (Songsterr)"
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
      <Button intent="neutral" onClick={() => setLibraryOpen(true)}>
        <Icon name="music" />
        Songs{songs.length ? ` (${songs.length} of yours)` : ''}
      </Button>
      {libraryOpen && (
        <SongLibrary
          songs={songs}
          chosen={chosen}
          onPick={(id) => {
            updateSetting('rhythmGame.song', id);
            setLibraryOpen(false);
          }}
          onRemove={(id) => {
            updateSetting(
              'rhythmGame.customSongs',
              songs.filter((song) => song.id !== id)
            );
            if (chosen === id) updateSetting('rhythmGame.song', '');
          }}
          onClose={() => setLibraryOpen(false)}
        />
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
          <div className={cx('group')}>
            <div className={cx('groupTitle')}>
              <Icon name="music" />
              Your Songs
            </div>
            <div className={cx('groupHint')}>
              Type a song name (found on Songsterr), paste a Songsterr or Ultimate Guitar link, or
              add ChordPro / chord sheet files. Importing a song again updates it.
            </div>
            <div className={cx('groupHint', 'songsterrNote')}>
              <strong>Songsterr songs get the most:</strong> the notes of each instrument (play the
              guitar, bass or vocal line, hear the band, set each volume), the real tempo, bars and
              sections, and better syncing with Spotify. Other sites and files only give the chords.
            </div>
            <ImportSongs songs={importedSongs} />
          </div>

          <SpotifySettings />

          <div className={cx('group')}>
            <div className={cx('groupTitle')}>
              <Icon name="controller" />
              Playing
            </div>
            <div className={cx('groupHint')}>
              The part you play, the volumes and the practice options are on the game screen.
            </div>

            <FormField
              label="Note View"
              hint="The notes and chords scroll from right to left, or fall down a highway with a lane for each degree of the key (1 to 7, colored like the key's chords). V switches while playing"
            >
              <Select
                options={fields.view.choices}
                onChange={(value) => updateSetting('rhythmGame.view', value)}
                value={game.view ?? 'lane'}
              />
            </FormField>

            <FormControlLabel
              label="Practice Mode"
              hint="A piano keyboard with the keys and fingering to play"
              reverse
            >
              <Switch
                onChange={(value) => updateSetting('rhythmGame.learningMode', value)}
                checked={game.learningMode}
              />
            </FormControlLabel>

            {game.learningMode && (
              <FormField label="Fingering" hint="Finger numbers (1 is the thumb, 5 the pinky)">
                <Select
                  options={fields.fingering.choices}
                  onChange={(value) => updateSetting('rhythmGame.fingering', value)}
                  value={game.fingering}
                />
              </FormField>
            )}

            {game.learningMode && (
              <FormField
                label="Your Keyboard"
                hint="The keys of your keyboard, so each key on screen (on the highway too) is the one under your hand: no guessing which octave. With octave buttons on your keyboard, keep them in the middle. Fit each song: the keys the song's notes are on"
              >
                <Select
                  options={fields.keyboardKeys.choices}
                  onChange={(value) => updateSetting('rhythmGame.keyboardKeys', value)}
                  value={game.keyboardKeys ?? 'fit'}
                />
              </FormField>
            )}

            {game.learningMode && (
              <FormField
                label="Keyboard Octave"
                hint="The notes of a part shown where the song plays them (− and + move them by octaves), the keyboard moving to the octave you play a whole chord in, or staying in one octave (moved with − and +). Chords follow you in the first mode. Any octave is fine to play in"
              >
                <Select
                  options={fields.keyboardOctave.choices}
                  onChange={(value) => updateSetting('rhythmGame.keyboardOctave', value)}
                  value={game.keyboardOctave ?? 'song'}
                />
              </FormField>
            )}

            <FormField
              label="Fast Repeated Chords"
              hint="A chord struck again and again fast (a guitar strumming) is hard on a piano: held as one chord instead (struck again every 4 beats; every strum is still heard), or each one is struck. Single notes played again are always each played"
            >
              <Select
                options={fields.repeatedNotes.choices}
                onChange={(value) => updateSetting('rhythmGame.repeatedNotes', value)}
                value={game.repeatedNotes ?? 'hold'}
              />
            </FormField>

            <FormField
              label="Play Songs On"
              hint="Where a song typed or linked plays, whatever the link is from (a Spotify link plays on YouTube, and the other way round). Don't play: only pick the song, the game plays without the recording"
            >
              <Select
                options={fields.playOn.choices}
                onChange={(value) => updateSetting('rhythmGame.playOn', value)}
                value={game.playOn ?? 'youtube'}
              />
            </FormField>

            <FormField
              label="On a Miss"
              hint="Keep going, stop until the note is played, or slow down. With a recording, the song is paused (Spotify, YouTube) or slowed down (YouTube with the browser extension; Spotify: see below)"
            >
              <Select
                options={fields.onMiss.choices}
                onChange={(value) => updateSetting('rhythmGame.onMiss', value)}
                value={game.onMiss ?? 'continue'}
              />
            </FormField>

            <FormField
              label="Slowing Down With Spotify"
              hint="Spotify cannot play slower: it is paused and the game plays the song by itself, slower, then Spotify goes on where the game is once back to full speed. Or the game waits for the note instead"
            >
              <Select
                options={fields.spotifySlowDown.choices}
                onChange={(value) => updateSetting('rhythmGame.spotifySlowDown', value)}
                value={game.spotifySlowDown ?? 'game'}
              />
            </FormField>

            <FormControlLabel
              label="Guessed Chords"
              hint="Tabs without chord names: play chords guessed from the notes (they may not fit). Off: play a part of the song instead"
              reverse
            >
              <Switch
                checked={game.guessedChords !== false}
                onChange={(value) => updateSetting('rhythmGame.guessedChords', value)}
              />
            </FormControlLabel>

            <FormControlLabel label="Score" hint="The score and the combo" reverse>
              <Switch
                onChange={(value) => updateSetting('rhythmGame.gamification', value)}
                checked={game.gamification}
              />
            </FormControlLabel>
          </div>

          <details className={cx('group', 'more')}>
            <summary className={cx('groupTitle')}>
              <Icon name="settings" />
              More Settings
            </summary>

            <FormField label="Song" hint="Play one song, or random songs">
              <Select
                options={[
                  { value: 'random', label: 'Random song' },
                  ...getAllSongs(importedSongs).map((song) => ({
                    value: song.id,
                    label: song.title,
                  })),
                ]}
                onChange={(value) =>
                  updateSetting('rhythmGame.song', value === 'random' ? '' : value)
                }
                value={game.song || 'random'}
              />
            </FormField>

            <FormField as="div" label="Random Songs" hint="The songs played at random">
              <ToggleList
                items={getAllSongs(importedSongs).map((song) => ({
                  id: song.id,
                  label: song.title,
                }))}
                included={getIncludedSongs(excludedSongs, importedSongs).map((song) => song.id)}
                onToggle={toggleSong}
                hint="Click a song to leave it out or play it again"
              />
            </FormField>

            <FormField
              label="Pattern"
              hint="How often each chord is played: the song's own rhythm, or a fixed pattern"
            >
              <Select
                options={fields.pattern.choices}
                onChange={(value) => updateSetting('rhythmGame.pattern', value)}
                value={game.pattern ?? 'song'}
              />
            </FormField>

            <FormControlLabel
              label="Song's Tempo"
              hint="Songs with a tempo of their own play at it (else at the tempo below)"
              reverse
            >
              <Switch
                onChange={(value) => updateSetting('rhythmGame.songTempo', value)}
                checked={!!game.songTempo}
              />
            </FormControlLabel>

            <FormField label="Tempo" hint="Beats per minute, for songs without a tempo">
              <InputNumber
                className={cx('tempo')}
                value={game.tempo}
                onChange={(value: number) => {
                  // any tempo above 0
                  if (Number.isFinite(value) && value > 0) {
                    updateSetting('rhythmGame.tempo', Math.round(value));
                  }
                }}
                step={5}
                min={1}
                aria-label="Tempo in beats per minute"
              />
            </FormField>

            <FormControlLabel
              label="Speed Up"
              hint="Faster as you play well: 5% every 4 chords in a row, up to 1.5 times"
              reverse
            >
              <Switch
                onChange={(value) => updateSetting('rhythmGame.speedUp', value)}
                checked={!!game.speedUp}
              />
            </FormControlLabel>

            <FormControlLabel
              label="Strict Octaves"
              hint="A part's notes count only in their own octave (where the keyboard shows them, moved with − and +), not in any octave"
              reverse
            >
              <Switch
                onChange={(value) => updateSetting('rhythmGame.strictOctaves', value)}
                checked={!!game.strictOctaves}
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
              label="Built-in Sound"
              hint="What the game plays itself: the song, a click on the beat, or nothing"
            >
              <Select
                options={fields.sound.choices}
                onChange={(value) => updateSetting('rhythmGame.sound', value)}
                value={game.sound ?? 'chords'}
              />
            </FormField>

            <FormField
              label="Built-in Songs Key"
              hint="The key of the built-in songs (imported songs play in their own key)"
            >
              <Select
                options={fields.songKey.choices}
                onChange={(value) => updateSetting('rhythmGame.songKey', value)}
                value={game.songKey}
              />
            </FormField>

            {game.songKey !== 'current' && (
              <FormField
                label="Built-in Songs Keys"
                hint="Keys with sharps or flats (C#, Bb...) too"
              >
                <Select
                  options={fields.tonics.choices}
                  onChange={(value) => updateSetting('rhythmGame.tonics', value)}
                  value={game.tonics}
                />
              </FormField>
            )}
          </details>
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
