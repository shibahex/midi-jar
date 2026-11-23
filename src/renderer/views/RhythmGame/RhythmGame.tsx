import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import classnames from 'classnames/bind';
import { Button } from '@la-jarre-a-son/ui';
import { useNavigate } from 'react-router-dom';
import { Chord, Key, Midi, Note } from 'tonal';

import { useSettings } from 'renderer/contexts/Settings';
import useNotes from 'renderer/hooks/useNotes';
import { Icon } from 'renderer/components';
import {
  formatSharpsFlats,
  getBestScaleForChroma,
  estimateFirstChordMs,
  getAllSongs,
  getChordVoicing,
  medianOffset,
  getIncludedSongs,
  getRelativeScale,
  getScaleInfo,
  getSongChords,
  getSongProgression,
  getSongRhythm,
  randomPick,
  getImportedSongChords,
  getImportedSongKey,
  alignClips,
  alignSong,
  beatAt,
  buildSongOnsets,
  findSongByName,
  findSongForTrack,
  mapTempo,
  modelAt,
  msOfBeat,
  importSongFromWeb,
  isLinkedSong,
  PlayableSong,
  sourceName,
  spotifyLinkFor,
  NO_CHORD,
  getTonicChromas,
  getFingeringHands,
} from 'renderer/helpers';

import { Channel, INSTRUMENTS, InstrumentName, synth } from 'renderer/helpers/synth';
import { buildSongTemplate, SongListener } from 'renderer/helpers/audioSync';
import {
  ImportedSong,
  SongPart,
  SongPartRole,
  SpotifyPlayer as SpotifyPlayerState,
  SpotifyTrack,
} from 'main/types';

import ChordQuizKeyboard from '../ChordQuiz/ChordQuizKeyboard';
import Mixer from './Mixer';
import PracticePanel from './PracticePanel';
import SongLibrary, { SongCover, splitTitle } from './SongLibrary';
import {
  BEATS_PER_BAR,
  buildHits,
  buildNoteHits,
  getHandsFingering,
  mergeRepeats,
  buildPartEvents,
  getBeatMs,
  getSections,
  partKey,
  getHitPoints,
  GOOD_MS,
  Hit,
  HitResult,
  isOpen,
  judge,
  matchesChord,
  matchesNotes,
  RhythmChord,
  Section,
  SongRhythm,
} from './rhythm';

import styles from './RhythmGame.module.scss';

const cx = classnames.bind(styles);

/** lane: where the hit line is, and how much of the lane a beat takes (percent) */
const HIT_LINE = 15;
const BEAT_WIDTH = 10;
/**
 * highway: where the hit line is (percent from the bottom, the notes' heads going through it),
 * and how tall a beat is (percent)
 */
const HIGHWAY_LINE = 6;
const BEAT_HEIGHT = 9;
/** highway: the room between notes played close together (percent), and the most a beat takes */
const HIGHWAY_GAP = 16;
/** a note's keys pressed this early (ms, before it can be judged) and held into it play it */
const EARLY_MS = 600;
/** the most octaves of keys the highway shows (a part going further: moved into them) */
const MAX_KEY_OCTAVES = 4;
/** the keys of a keyboard of each size (MIDI, the lowest and the highest) */
const KEYBOARD_SIZES: Record<string, [number, number]> = {
  '25': [48, 72],
  '37': [48, 84],
  '49': [36, 84],
  '61': [36, 96],
  '76': [28, 103],
  '88': [21, 108],
};
/** the white keys of an octave by chroma (C D E F G A B: 0 to 6) */
const WHITE_INDEX: Record<number, number> = { 0: 0, 2: 1, 4: 2, 5: 3, 7: 4, 9: 5, 11: 6 };
/** a black key: half its width, and how far it is moved from between its white keys (in white
 * keys) */
const BLACK_WIDTH = 12 / 41;
const BLACK_SHIFT: Record<number, number> = { 1: -0.069, 3: 0.069, 6: -0.138, 8: 0, 10: 0.138 };
const MAX_BEAT_HEIGHT = 45;

/** Notes of a chord played by the built-in sound: a bass note and the chord above it */
function getGuideNotes(hit: Hit) {
  const root = (Note.chroma(hit.chord.tonic ?? 'C') ?? 0) + 48;
  const base = root < 53 ? root + 12 : root;
  return [base - 12, ...getChordVoicing(hit.chord.intervals).map((s) => base + s)];
}

/** song part notes are scheduled this far ahead (ms), to be played exactly on time */
const LOOKAHEAD_MS = 150;

const ALL_PARTS: string[] = ['rhythm', 'bass', 'lead', 'melody'];

/** instruments to pick for a part ("": the sound style's) */
const INSTRUMENT_CHOICES = [{ value: '', label: 'Default' }, ...INSTRUMENTS];

const DEFAULT_VOLUMES = {
  chords: 80,
  rhythm: 70,
  bass: 75,
  lead: 65,
  melody: 80,
  click: 60,
  countIn: 80,
};

const PART_NAMES: Record<Exclude<SongPartRole, 'other'>, string> = {
  rhythm: 'Rhythm guitar',
  bass: 'Bass',
  lead: 'Lead guitar',
  melody: 'Melody',
};
/** The name of a part: of its role, or its own (another instrument) */
const partName = (part: SongPart) => (part.role === 'other' ? part.name : PART_NAMES[part.role]);

/** What the player can play: the chords, or a part of the song with notes (by its key) */
type PlayPart = string;
/** the parts that can be played as notes, in this order (the rhythm guitar note by note too) */
const NOTE_PARTS: SongPartRole[] = ['lead', 'melody', 'bass', 'rhythm', 'other'];
/** the volume of another instrument of the song, until it is set */
const OTHER_VOLUME = 65;

/**
 * Syncing by listening: Spotify plays the whole song once and it is heard. Spotify is asked
 * where it is this often (ms), and given this long to start
 */
const HEAR_POLL_MS = 2000;
const HEAR_SETTLE_MS = 1500;
const HEAR_START_MS = 10000;
/** Spotify further than this from where it should be (ms): it was moved, what follows is not used */
const HEAR_MOVED_MS = 600;
/**
 * Spotify's position (MPRIS) is not a smooth clock: it is stale (the same answer twice), moves in
 * steps of 1-2 s, and sits at 0 for a few seconds after a play. So a real move in the song is
 * only told by a jump bigger than this (ms), and parts are polled fast to catch each step
 */
const HEAR_JUMP_MS = 2500;
const HEAR_PART_POLL_MS = 400;
/** a part whose position jumped is collected again this many times at most */
const HEAR_RESTARTS = 3;
/** stopped before this much of the song was heard (ms): nothing is synced */
const HEAR_MIN_MS = 20000;
/**
 * Syncing quickly: parts of the song heard (ms each), about one every so often (ms) through
 * the song, and how many at least and at most
 */
const HEAR_PART_MS = 12000;
const HEAR_PART_EVERY_MS = 75000;
const HEAR_PARTS_MIN = 4;
const HEAR_PARTS_MAX = 6;

/** A time in a recording (ms): "3:07" */
const formatTime = (ms: number) =>
  `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

/**
 * What is listened to while syncing, and whether other sounds (a video...) get in the way
 */
const hearSyncSource = (label?: string) => {
  if (!label) return '';
  if (label === 'Spotify alone' || label === 'the browser alone') {
    return ` · hearing ${label} (other sounds are fine)`;
  }
  return ` · hearing ${label} (keep other sounds off)`;
};

/** Synced by listening (the whole song or parts of it): where each beat is was heard */
const heardBy = (syncedBy?: string) => syncedBy === 'listening' || syncedBy === 'parts';

/**
 * A failed call to Spotify while syncing: "too many requests" stops the sync (Spotify says
 * when to try again), anything else counts as nothing playing
 */
const spotifyBusyOrNull = (e: unknown) => {
  if (/too many requests/.test(String(e))) throw e;
  return null;
};

/** Quick sync: how often (ms) Spotify is asked while it starts the song */
const HEAR_START_POLL_MS = 500;

/**
 * Plays the song in Spotify (from a position, ms) and waits until it really plays it: stopped
 * or paused, Spotify needs a moment and may tell another position while it starts. It plays
 * when two answers in a row agree on when the song started (the clock runs steadily). Its
 * last answer, or an error when it did not play in time (or the player cancelled).
 */
async function startSong(
  link: { uri: string; name: string; durationMs?: number },
  positionMs: number,
  cancelled: () => boolean
): Promise<SpotifyPlayerState> {
  await window.app.spotify.play(link.uri, positionMs);
  const askedAt = performance.now();
  // Spotify's position is stale after a play or a seek (it keeps the old one, or 0, for a few
  // seconds): it plays when it is where it was asked to be, and moves
  const seen = new Set<number>();
  while (performance.now() - askedAt < HEAR_START_MS) {
    if (cancelled()) throw new Error('Cancelled');
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => {
      setTimeout(resolve, HEAR_START_POLL_MS);
    });
    // eslint-disable-next-line no-await-in-loop
    const player = await window.app.spotify.player(link.uri).catch(spotifyBusyOrNull);
    if (
      player?.isPlaying &&
      isLinkedSong(player.track, link) &&
      player.progressMs >= positionMs - 500 &&
      player.progressMs <= positionMs + HEAR_START_MS + 3000
    ) {
      seen.add(Math.round(player.progressMs));
      if (seen.size >= 2) return player;
    }
  }
  throw new Error(`${sourceName(link.uri)} did not play the song`);
}

/** Messages of the main process: "Error invoking remote method ...: Error: message" */
const errorText = (e: unknown) =>
  e instanceof Error ? e.message.replace(/^.*Error: /, '') : String(e);

/**
 * What a miss does. A song synced with a recording (Spotify, YouTube) waits by pausing it, and
 * slows down by slowing it down: only YouTube (through the browser extension) can be. Where the
 * recording cannot be slowed down (Spotify has no speed), the game plays the song by itself
 * while it is slower (the recording paused), or it waits for the note instead.
 */
const missMode = (
  setting: 'continue' | 'wait' | 'slowDown',
  recording: boolean,
  canSlowDown: boolean | null,
  gamePlaysSlower: boolean
) =>
  setting === 'slowDown' && recording && canSlowDown === false && !gamePlaysSlower
    ? 'wait'
    : setting;

/**
 * A recording that was paused and played again, or slowed down: what it tells is not true for
 * this long (ms), the game follows it by itself meanwhile
 */
const RECORDING_SETTLE_MS = 2500;

/**
 * Following Spotify: further off than this (ms), the game goes there at once (Spotify moved);
 * closer, it plays at most this much faster or slower until it is there
 */
const CLOCK_JUMP_MS = 1500;
/**
 * the recording just started again (after a note waited on): what it tells is stale for a
 * while (Spotify tells the old place, or 0), so the game is not moved at once for this long (ms),
 * only caught up gently
 */
const RESUMED_NO_JUMP_MS = 6000;
/** moved back at least this much (ms): the notes coming again can be played again */
const REPLAY_BACK_MS = 2000;
const CLOCK_CATCH_UP = 0.08;
/** how far off (ms) the most catching up is made */
const CLOCK_CATCH_UP_MS = 1000;

/**
 * Spotify is asked where it is this often (ms) while the run starts, and when a button moves
 * the song (a section, the speed, a note waited on); then only this often, to see it was not
 * paused or moved (what it tells is a little off each time: the game keeps its own clock
 * unless Spotify moved). Less often when it does not play the song (paused, another song), and
 * not at all after a while (the run stops) or while the game is hidden. Spotify allows few
 * calls.
 */
const SPOTIFY_POLL_MS = 2000;
const SPOTIFY_CHECK_MS = 15000;
const SPOTIFY_IDLE_POLL_MS = 10000;
const SPOTIFY_IDLE_STOP_MS = 30000;
/** after an error: when Spotify does not say how long to wait (ms) */
const SPOTIFY_ERROR_WAIT_MS = 15000;

/** A color for each degree of the key (I blue, IV green, V orange...), from a numeral */
const DEGREE_HUES = [215, 280, 325, 145, 28, 185, 50];
const ROMAN_DEGREES = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
function degreeHue(numeral?: string) {
  const roman = /[ivIV]+/.exec(numeral ?? '')?.[0].toUpperCase();
  const degree = roman ? ROMAN_DEGREES.indexOf(roman) : -1;
  if (degree < 0) return 215;
  // borrowed chords (♭VII, ♯IV...) a little apart
  return DEGREE_HUES[degree] + (/[♭♯b#]/.test(numeral ?? '') ? 18 : 0);
}

/** The numbers of the chords of a key: major, and (natural) minor */
const MAJOR_NUMERALS = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'];
const MINOR_NUMERALS = ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII'];

/** The chords of a key ("D major", "G minor", "E♭ major"), with their number */
function keyChords(keyLabel: string) {
  const [tonicLabel, mode] = keyLabel.split(' ');
  const tonic = tonicLabel.replace('♯', '#').replace('♭', 'b');
  const minor = mode === 'minor';
  const triads = minor ? Key.minorKey(tonic).natural.triads : Key.majorKey(tonic).triads;
  const numerals = minor ? MINOR_NUMERALS : MAJOR_NUMERALS;
  return triads.map((name, i) => ({ name, numeral: numerals[i] }));
}

/** The degree of a note in a key, from the semitones above its tonic */
const SCALE_DEGREES = ['1', '♭2', '2', '♭3', '3', '4', '♯4', '5', '♭6', '6', '♭7', '7'];

/** Two chords are the same (the same root and quality, whatever the spelling) */
const sameChord = (a: string, b: string) => {
  const x = Chord.get(a);
  const y = Chord.get(b);
  return (
    !!x.tonic &&
    !!y.tonic &&
    Note.chroma(x.tonic) === Note.chroma(y.tonic) &&
    x.quality === y.quality
  );
};

const LABELS: Record<HitResult, string> = {
  perfect: 'PERFECT!',
  good: 'Good',
  miss: 'Miss',
};

type Round = {
  song: PlayableSong;
  keyLabel: string;
  chords: RhythmChord[];
  rhythm: SongRhythm;
  sections: Section[];
  /** notes of the instruments (Songsterr songs) */
  parts: SongPart[];
  tempo: number;
  beatsPerBar: number;
  noSongTempo: boolean;
};

/**
 * The chords of a song were guessed from its notes (a tab without chord names; imported
 * before it was told: "N.C." comes only from guessing)
 */
const chordsGuessed = (r: Round) =>
  !!r.song.imported && (r.song.imported.chordsGuessed ?? r.song.imported.chords.includes(NO_CHORD));

/** The parts that can be played as notes, in this order */
const notePartsOf = (r: Round) =>
  NOTE_PARTS.flatMap((role) => r.parts.filter((p) => p.role === role));

/** The beats of sections of a song (first to last), from the song start (with its intro) */
function getBeatRange(r: Round, first: number, last: number) {
  const beatOfChord = (index: number) =>
    (r.rhythm.leadIn ?? 0) +
    r.chords.slice(0, index).reduce((sum, chord) => sum + (chord.beats ?? r.beatsPerBar), 0);
  const nextSection = r.sections[last + 1];
  return {
    fromBeat: first === 0 ? 0 : beatOfChord(r.sections[first]?.start ?? 0),
    toBeat: nextSection ? beatOfChord(nextSection.start) : Infinity,
  };
}

/** Bars of a song picked to practice (from the first to the last, from 0) */
type BarRange = { from: number; to: number };

/** The beats played: of the sections picked, or of the bars picked in them */
function runWindow(r: Round, first: number, last: number, bars: BarRange | null) {
  if (!bars) return getBeatRange(r, first, last);
  return {
    fromBeat: bars.from * r.beatsPerBar,
    toBeat: (bars.to + 1) * r.beatsPerBar,
  };
}

/** The chords of a part of a song (beats), cut where it starts and ends, and its intro */
function windowChords(r: Round, fromBeat: number, toBeat: number) {
  const leadIn = r.rhythm.leadIn ?? 0;
  let position = leadIn;
  const chords: RhythmChord[] = [];
  r.chords.forEach((chord) => {
    const length = chord.beats ?? r.beatsPerBar;
    const from = Math.max(position, fromBeat);
    const to = Math.min(position + length, toBeat);
    if (to - from > 1e-6) chords.push({ ...chord, beats: to - from });
    position += length;
  });
  return { chords, leadIn: Math.max(0, leadIn - fromBeat) };
}

/** fast-forward and back (← →, the buttons): ms of the song */
const SKIP_MS = 5000;

/** speed up: 5% every 4 hits in a row, up to 1.5 times the tempo */
const SPEED_UP = 1.05;
const MAX_RATE = 1.5;
/**
 * slow down on a miss: 15% slower for each note missed, as slow as needed until the notes are
 * played (a quarter of the speed at most), then back up 5% every 4 hits in a row
 */
const SLOW_DOWN = 0.85;
const MIN_RATE = 0.25;

type Phase = 'ready' | 'playing' | 'done';

/**
 * Rhythm game: the chords of a song scroll toward a hit line in time with the beat,
 * play each one as it reaches the line. The song is revealed at the end.
 */
const RhythmGame: React.FC = () => {
  const { settings, updateSetting } = useSettings();
  const navigate = useNavigate();
  const gameSettings = settings.rhythmGame;
  const { key, accidentals } = settings.notation;
  const { tempo, pattern, songTempo: useSongTempo } = gameSettings;

  const {
    playedMidiNotes,
    sustainedMidiNotes,
    midiNotes,
    chords: playedChords,
  } = useNotes({
    key,
    accidentals,
  });
  // the keys held now (read by the game loop)
  const heldNotes = useRef(playedMidiNotes);
  heldNotes.current = playedMidiNotes;

  // compared by content: settings arrays are new objects after any change
  const excludedSongs = (gameSettings.excludedSongs ?? []).join(',');
  const importedSongs = JSON.stringify(gameSettings.customSongs ?? []);
  const chosenSong = gameSettings.song ?? '';
  const spotifySync = !!gameSettings.spotifySync;

  // a song in a key: random or the current one (a minor song in its relative minor)
  const newRound = useCallback(
    (previous?: string, keep?: string): Round => {
      // the chosen song, the one kept, or a random one (not the same twice in a row)
      const all = getAllSongs(JSON.parse(importedSongs));
      const chosen =
        all.find((s) => s.id === chosenSong) ??
        (keep && !chosenSong ? all.find((s) => s.id === keep) : undefined);
      const songs = getIncludedSongs(excludedSongs.split(','), JSON.parse(importedSongs));
      const song =
        chosen ?? randomPick(songs.length > 1 ? songs.filter((s) => s.id !== previous) : songs);
      // the song's rhythm, and its own tempo when it has one (and it is wanted)
      const rhythm = getSongRhythm(song);
      // songs synced with Spotify play at the tempo of the recording
      const synced = spotifySync && !!song.imported?.spotify && !!rhythm.bpm;
      // (at the recording's own tempo when listening found it)
      const recordingTempo = synced ? song.imported?.spotify?.bpm : undefined;
      const songTempo =
        recordingTempo ?? ((useSongTempo || synced) && rhythm.bpm ? rhythm.bpm : tempo);
      const beatsPerBar = rhythm.beatsPerBar ?? BEATS_PER_BAR;
      const timing = {
        tempo: songTempo,
        beatsPerBar,
        rhythm,
        // the song's tempo is wanted, but the song has none
        noSongTempo: useSongTempo && !!song.imported && !rhythm.bpm,
      };

      // imported songs are played in their own key
      if (song.imported) {
        const chords = getImportedSongChords(song.imported);
        return {
          song,
          keyLabel: getImportedSongKey(song.imported),
          chords,
          sections: getSections(chords, beatsPerBar, song.imported.sections),
          parts: song.imported.parts ?? [],
          ...timing,
        };
      }

      const { mode } = getSongProgression(song.song);
      let tonic: string;
      if (gameSettings.songKey === 'current') {
        tonic = mode === 'major' ? key : getRelativeScale(getScaleInfo(key, 'major'))?.tonic ?? 'A';
      } else {
        const chromas = getTonicChromas(gameSettings.tonics);
        tonic = getBestScaleForChroma(randomPick(chromas), mode).tonic;
      }
      const chords = getSongChords(song.song, tonic);
      return {
        song,
        keyLabel: `${formatSharpsFlats(tonic)} ${mode}`,
        chords,
        sections: getSections(chords, beatsPerBar),
        parts: [],
        ...timing,
      };
    },
    [
      chosenSong,
      excludedSongs,
      importedSongs,
      gameSettings.songKey,
      gameSettings.tonics,
      key,
      tempo,
      useSongTempo,
      spotifySync,
    ]
  );

  // practice: the sections played (first to last), and the speed in percent
  const savedSpeed = gameSettings.practiceSpeed ?? 100;
  // practice mode (chosen sections, speed, loop) or the whole song at full speed
  const [practicing, setPracticing] = useState(false);
  const practicingRef = useRef(practicing);
  practicingRef.current = practicing;
  const practiceLoop = practicing && !!gameSettings.practiceLoop;
  const practiceRamp = !!gameSettings.practiceRamp;
  // what the player plays (a part of the song when it has it)
  const playPart: PlayPart = gameSettings.playPart ?? 'chords';
  const playPartRef = useRef(playPart);
  playPartRef.current = playPart;
  const preferSharps = accidentals === 'sharp';
  // songs whose chords were guessed from the notes: played as chords, or else as a part
  const guessedChordsOn = gameSettings.guessedChords !== false;
  // a part's chords struck again fast (a guitar strumming): played by holding the chord, or
  // each struck
  const repeatsRef = useRef(gameSettings.repeatedNotes);
  repeatsRef.current = gameSettings.repeatedNotes;
  const makeHits = useCallback(
    (r: Round, win: { fromBeat: number; toBeat: number }, speed: number) => {
      const playTempo = (r.tempo * speed) / 100;
      const noChords = !guessedChordsOn && chordsGuessed(r);
      const part =
        r.parts.find((p) => partKey(p) === playPartRef.current) ??
        (noChords ? notePartsOf(r)[0] : undefined);
      if (part) {
        const { fromBeat, toBeat } = win;
        const events = buildPartEvents(
          [part],
          [partKey(part)],
          playTempo,
          r.beatsPerBar,
          fromBeat,
          toBeat
        );
        // notes named like the key of the song (C# minor: sharps)
        // (E major: sharps, F major: flats, C major and A minor: as preferred)
        const [tonic, mode] = r.keyLabel.replace('♯', '#').replace('♭', 'b').split(' ');
        const { alteration } = /^min/i.test(mode ?? '') ? Key.minorKey(tonic) : Key.majorKey(tonic);
        const sharps = alteration > 0 || (alteration === 0 && preferSharps);
        if (events.length) {
          const noteHits = buildNoteHits(events, playTempo, sharps);
          return repeatsRef.current === 'each' ? noteHits : mergeRepeats(noteHits, playTempo);
        }
      }
      // (the intro plays only when starting from it)
      const { chords, leadIn } = windowChords(r, win.fromBeat, win.toBeat);
      return buildHits(chords, playTempo, pattern, { ...r.rhythm, leadIn });
    },
    [pattern, preferSharps, guessedChordsOn]
  );

  const [round, setRound] = useState<Round>(() => newRound());
  const roundRef = useRef(round);
  roundRef.current = round;
  const { beatsPerBar } = round;
  const [range, setRange] = useState({
    first: 0,
    last: round.sections.length - 1,
  });
  // practice: bars picked in the sections (none: the whole sections)
  const [bars, setBars] = useState<BarRange | null>(null);
  const barsRef = useRef(bars);
  barsRef.current = bars;
  // the speed the song is played at (it changes when looping faster)
  const [speed, setSpeed] = useState(100);
  const [loop, setLoop] = useState(0);
  const beatMs = getBeatMs((round.tempo * speed) / 100);
  const [phase, setPhase] = useState<Phase>('ready');
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  // practice: starting again, slower or faster (set below, read by the keys)
  const practiceKeys = useRef({
    restart: () => {},
    changeSpeed: (_delta: number) => {},
    skipBy: (_ms: number) => {},
    switchView: () => {},
  });
  // the volumes and the parts (shown over the game while playing)
  // (open at first: hidden with M or its cross)
  const [showMixer, setShowMixer] = useState(true);
  // Spotify's volume before it was muted
  const spotifyUnmuted = useRef(0);
  const [now, setNow] = useState(0);
  const [hits, setHits] = useState<Hit[]>(() =>
    makeHits(round, runWindow(round, 0, round.sections.length - 1, null), 100)
  );
  const [combo, setCombo] = useState(0);
  const [bestCombo, setBestCombo] = useState(0);
  const [score, setScore] = useState(0);
  const [judgement, setJudgement] = useState<{
    result: HitResult;
    id: number;
  } | null>(null);
  // what happens on a miss (wait for the note, or slow down)
  // Spotify: the linked song plays there, and the game follows it
  const spotifyLink = round.song.imported?.spotify;
  // linked (and with a tempo): can be synced; synced: the first chord was found in the recording
  // the song picked by its name to play without its recording ("Don't play")
  const [recordingOff, setRecordingOff] = useState(false);
  const spotifyLinked = spotifySync && !recordingOff && !!spotifyLink && !!round.song.imported?.bpm;
  const spotifyOn = spotifyLinked && spotifyLink?.firstChordMs !== undefined;
  const spotifyOnRef = useRef(spotifyOn);
  spotifyOnRef.current = spotifyOn;
  const spotifyLinkRef = useRef(spotifyLink);
  spotifyLinkRef.current = spotifyLink;
  // where the linked song plays: Spotify, or YouTube
  const recordingSource = sourceName(spotifyLink?.uri);
  const [spotifyMessage, setSpotifyMessage] = useState('');
  // the last call to Spotify that failed (shown until hidden or a call works again)
  const [spotifyError, setSpotifyError] = useState('');
  const showSpotifyError = (e: unknown, context = '') =>
    setSpotifyError(`${errorText(e)}${context}`);
  // where Spotify was (asked about twice a second), and where the song starts in the recording
  const spotifyPlayer = useRef<{
    progressMs: number;
    at: number;
    isPlaying: boolean;
    track: SpotifyTrack;
    /** Spotify plays the linked song (maybe another release of it) */
    isSong: boolean;
    /** how fast it plays (1: the real speed) */
    rate: number;
  } | null>(null);
  // the cover of the song's album (from its link, or seen while Spotify plays it)
  const [seenArt, setSeenArt] = useState<string | undefined>();
  // playing along with Spotify: what it plays, and the imported song it is (if any)
  const [following, setFollowing] = useState<{
    track: SpotifyTrack;
    song?: ImportedSong;
    busy?: string;
    error?: string;
  } | null>(null);
  // the song to join where Spotify is, once its round is ready
  const [joinSongId, setJoinSongId] = useState<string | null>(null);
  // playing along with Spotify: a song not synced yet is synced quickly first, then Spotify
  // goes back to where it was
  const syncFirst = useRef<{ uri: string; positionMs: number } | null>(null);
  const syncByPartsRef = useRef(async () => false);
  const spotifyTiming = useRef({
    songStartMs: 0,
    countInMs: 0,
    runStartBeat: 0,
    synced: false,
  });
  // syncing: tap on the first chord while Spotify plays the song
  const [calibrating, setCalibrating] = useState(false);
  // how early or late each chord was played (ms): a synced song is corrected from them
  const hitOffsets = useRef<number[]>([]);
  const [syncAdjust, setSyncAdjust] = useState<number | null>(null);
  // the sync moved while playing (arrows, taps while listening): saved when the song stops
  const syncShift = useRef(0);
  const [shownShift, setShownShift] = useState(0);
  const pendingAdjust = useRef(0);
  // syncing by listening to the whole recording (a sound input)
  const listenSync = true;
  const syncInput = gameSettings.syncInput ?? '';
  // listening to the whole song (how much was heard) or to parts of it, and how it went
  const [hearSync, setHearSync] = useState<{
    heardMs: number;
    durationMs: number;
    /** what is listened to (Spotify alone: other sounds do not get in the way) */
    label?: string;
    /** syncing quickly: the part heard now, of how many */
    part?: number;
    parts?: number;
    message?: string;
    ok?: boolean;
  } | null>(null);
  const hearStop = useRef(false);
  const hearing = !!hearSync && !hearSync.message;
  // listening with Spotify: taps on the chord changes, to sync
  const tapOffsets = useRef<number[]>([]);
  const [tapCount, setTapCount] = useState(0);
  const [spotifyVolume, setSpotifyVolume] = useState<number | null>(null);
  // how late the playing reaches the game (ms)
  const latencyMs = gameSettings.latencyMs ?? 0;
  const latencyRef = useRef(latencyMs);
  latencyRef.current = latencyMs;

  // a song synced with a recording (Spotify, YouTube) waits by pausing it, and slows down by
  // slowing it down (YouTube, through the extension: see missMode for the others)
  const onMiss = gameSettings.onMiss ?? 'continue';
  // slower than the recording can play (Spotify): it is paused and the game plays the song
  const gamePlaysSlower = (gameSettings.spotifySlowDown ?? 'game') === 'game';
  const gamePlaysSlowerRef = useRef(gamePlaysSlower);
  gamePlaysSlowerRef.current = gamePlaysSlower;
  // the recording is paused while the game plays the song by itself, slower
  const [detached, setDetached] = useState(false);
  const detachedRef = useRef(false);
  const [rate, setRate] = useState(1);
  // the speed asked while playing (the practice speed changed without starting again): the
  // rate the song plays at when not slowed down by misses
  const [baseRate, setBaseRate] = useState(1);
  const baseRateRef = useRef(1);
  // the speed asked (percent): the practice speed, changed while playing
  const askedSpeed = Math.round(speed * baseRate);
  const [waiting, setWaiting] = useState<number | null>(null);

  // song time: real time, paused while waiting, slower when slowed down
  const songTime = useRef(0);
  // where the count-in starts (song time, ms): the start of the run, or a bar before the
  // section jumped to
  const countInFrom = useRef(0);
  const lastReal = useRef(0);
  const rateRef = useRef(1);
  const waitingRef = useRef<number | null>(null);
  // the recording (Spotify, YouTube) can be slowed down: true or false once known (null: not yet)
  const rateSupported = useRef<boolean | null>(null);
  // waiting on a note stops the recording: where it starts again (ms in it)
  const resumeAt = useRef(0);
  // the recording is not asked where it is until then (performance.now(), Infinity: paused by
  // the game): it was just paused or started again, and what it tells is not true yet
  const holdPollUntil = useRef(0);
  const hitsRef = useRef(hits);
  hitsRef.current = hits;
  const comboRef = useRef(combo);
  comboRef.current = combo;
  // the recording started again after a note waited on: not jumped to until then
  // (performance.now()), what it tells is stale
  const noJumpUntil = useRef(0);
  // the last pause or play asked to the recording: the next one waits for it (in order: a pause
  // run before the play asked before it would leave the recording paused, the game stuck)
  const recordingQueue = useRef<Promise<unknown>>(Promise.resolve());
  // started again once more when it stays paused right after a note waited on (true: done)
  const resumeRetried = useRef(false);
  // asks Spotify where it is after a moment, and follows it (a button moved the song)
  const checkRecordingSoon = useRef((_afterMs: number) => {});

  /** Where the recording is (ms in it) when the song is at a time (ms): the sync, backwards */
  const recordingPositionAt = (songMs: number) => {
    const { songStartMs, countInMs, runStartBeat } = spotifyTiming.current;
    const beatMap = spotifyLinkRef.current?.beatTimes;
    const position = beatMap
      ? msOfBeat(beatMap, runStartBeat + songMs / beatMs - beatsPerBar) + syncShift.current
      : songMs + songStartMs + syncShift.current - countInMs;
    return Math.max(0, position);
  };

  /** Waiting on a note: the recording (Spotify, YouTube) stops until the note is played */
  const holdRecording = (songMs: number) => {
    resumeAt.current = recordingPositionAt(songMs);
    holdPollUntil.current = Infinity;
    const player = spotifyPlayer.current;
    // (what it plays until it stops is not followed: the game stays on the note)
    if (player) {
      spotifyPlayer.current = {
        ...player,
        isPlaying: false,
        progressMs: resumeAt.current,
        at: performance.now(),
      };
    }
    resumeRetried.current = false;
    recordingQueue.current = recordingQueue.current
      .then(() => window.app.spotify.pause())
      .catch((e) => showSpotifyError(e));
  };

  /** The note was played: the recording goes on from the note */
  const resumeRecording = () => {
    const uri = spotifyLinkRef.current?.uri;
    if (!uri) {
      holdPollUntil.current = 0;
      return;
    }
    const position = resumeAt.current;
    const playing = recordingQueue.current
      .then(() => window.app.spotify.play(uri, position))
      .then(() => {
        // (waiting on another note already: paused again next)
        if (waitingRef.current !== null || detachedRef.current) return;
        const now = performance.now();
        const player = spotifyPlayer.current;
        if (player) {
          spotifyPlayer.current = {
            ...player,
            isPlaying: true,
            progressMs: position,
            at: now,
          };
        }
        // (where it is, asked again after a moment: it tells the old place until then)
        holdPollUntil.current = now + RECORDING_SETTLE_MS;
        noJumpUntil.current = now + RESUMED_NO_JUMP_MS;
        checkRecordingSoon.current(RECORDING_SETTLE_MS + 100);
      })
      .catch((e) => {
        holdPollUntil.current = 0;
        showSpotifyError(e, `: play it in ${sourceName(uri)}, the game follows`);
      });
    recordingQueue.current = playing;
  };

  /**
   * Slows the recording down, or back up (1: the real speed). It cannot (Spotify, YouTube
   * without the extension): then it is not slowed down, and a miss waits for the note instead.
   */
  const setRecordingRate = (value: number) => {
    const undo = () => {
      rateSupported.current = false;
      rateRef.current = 1;
      setRate(1);
      baseRateRef.current = 1;
      setBaseRate(1);
      const player = spotifyPlayer.current;
      if (player) spotifyPlayer.current = { ...player, rate: 1 };
    };
    rateRef.current = value;
    setRate(value);
    const player = spotifyPlayer.current;
    if (player) {
      const now = performance.now();
      // (where it is now, at the speed it had until now)
      const progress = player.isPlaying
        ? player.progressMs + (now - player.at) * player.rate
        : player.progressMs;
      spotifyPlayer.current = {
        ...player,
        progressMs: progress,
        at: now,
        rate: value,
      };
    }
    // (the speed it tells is the old one for a moment)
    holdPollUntil.current = Math.max(holdPollUntil.current, performance.now() + 1500);
    checkRecordingSoon.current(1600);
    window.app.spotify
      .rate(value)
      .then((changed) => {
        if (changed) rateSupported.current = true;
        else undo();
      })
      .catch(undo);
  };
  // (read by the game loop, which is not made again at each render)
  const holdRecordingRef = useRef(holdRecording);
  holdRecordingRef.current = holdRecording;
  const resumeRecordingRef = useRef(resumeRecording);
  resumeRecordingRef.current = resumeRecording;
  const recordingPositionAtRef = useRef(recordingPositionAt);
  recordingPositionAtRef.current = recordingPositionAt;
  /** The recording is paused, the game plays the song by itself from where it is */
  const detachRecording = () => {
    if (detachedRef.current) return;
    detachedRef.current = true;
    setDetached(true);
    holdRecording(songTime.current);
  };
  /** Back to the recording's speed: it goes on from where the game is */
  const attachRecording = () => {
    if (!detachedRef.current) return;
    detachedRef.current = false;
    setDetached(false);
    resumeAt.current = recordingPositionAt(songTime.current);
    // (waiting on a note: it goes on once the note is played)
    if (waitingRef.current === null) resumeRecording();
  };
  /**
   * The speed the song plays at (1: the real speed): the recording's speed (YouTube), or the
   * game's alone. A recording that has no speed (Spotify) is paused while the game is slower,
   * and goes on once it is back to the real speed (or it is not slowed down: see missMode)
   */
  const setPlayRate = (value: number) => {
    if (!spotifyOnRef.current) {
      rateRef.current = value;
      setRate(value);
      return;
    }
    if (rateSupported.current !== false) {
      if (value !== rateRef.current) setRecordingRate(value);
      return;
    }
    if (!gamePlaysSlowerRef.current) return;
    const next = Math.min(1, value);
    rateRef.current = next;
    setRate(next);
    if (next < 1 - 1e-6) detachRecording();
    else attachRecording();
  };
  const setRecordingRateRef = useRef(setRecordingRate);
  setRecordingRateRef.current = setRecordingRate;
  const setPlayRateRef = useRef(setPlayRate);
  setPlayRateRef.current = setPlayRate;
  // leaving the game: the video is not left slowed down
  useEffect(
    () => () => {
      if (rateSupported.current) window.app.spotify.rate(1).catch(() => {});
    },
    []
  );
  // a chord must be released before the next hit (repeated chords are struck again)
  const armed = useRef(true);
  // each key held: when it was pressed (song time, as the game hears it), and whether it played a
  // note already (a key pressed early for a note plays it when it comes, but only once)
  const keyPresses = useRef(new Map<number, { time: number; used: boolean }>());
  // strict octaves: how far the notes to play are moved (semitones, as shown); null: any octave
  const strictShiftRef = useRef<number | null>(null);
  // built-in sound: the chords of the song, a click on the beat
  const sound = gameSettings.sound ?? 'chords';
  const soundRef = useRef(sound);
  soundRef.current = sound;
  const sounded = useRef(new Set<number>());
  // volume of each part (the mixer)
  // (each other instrument of the song has its own, by name)
  const otherParts = round.parts.filter((p) => p.role === 'other').map(partKey);
  const volumes: Record<string, number> = {
    ...DEFAULT_VOLUMES,
    ...Object.fromEntries(otherParts.map((id) => [id, OTHER_VOLUME])),
    ...gameSettings.volumes,
  };
  const volumesKey = JSON.stringify(volumes);
  // muted (kept with the parts heard: "!chords", "!click", "!master"...): silent, their
  // volume kept
  const mutes = (gameSettings.songParts ?? ALL_PARTS).filter((k) => k.startsWith('!')).join(',');
  useEffect(() => {
    const muted = mutes.split(',');
    const levels = {
      keyboard: 100,
      ...(JSON.parse(volumesKey) as Record<string, number>),
    };
    Object.entries(levels).forEach(([id, value]) =>
      synth.setChannelVolume(id as Channel, muted.includes(`!${id}`) ? 0 : value / 100)
    );
  }, [volumesKey, mutes]);
  // the master volume: everything the game plays (back as it was when leaving the game)
  const masterMuted = mutes.split(',').includes('!master');
  const soundVolume = settings.general.soundVolume ?? 70;
  useEffect(() => {
    synth.setVolume(masterMuted ? 0 : soundVolume / 100);
    return () => synth.setVolume(soundVolume / 100);
  }, [masterMuted, soundVolume]);

  // the instrument picked for each part (none: the sound style's)
  const instrumentsKey = JSON.stringify(gameSettings.instruments ?? {});
  const otherPartsKey = otherParts.join('\n');
  useEffect(() => {
    const picked = JSON.parse(instrumentsKey) as Record<string, string>;
    const channels = [
      'chords',
      'rhythm',
      'bass',
      'lead',
      'melody',
      ...otherPartsKey.split('\n').filter(Boolean),
    ] as Channel[];
    channels.forEach((channel) =>
      synth.setChannelInstrument(channel, (picked[channel] as InstrumentName) || null)
    );
  }, [instrumentsKey, otherPartsKey]);

  // the parts of the song heard (the rhythm guitar replaces the chords): the main ones when
  // picked, the other instruments unless switched off ("!other:Piano")
  const partSetting = gameSettings.songParts ?? ALL_PARTS;
  // (the main parts are heard when listed, anything else unless muted)
  const isHeard = (id: string) =>
    ALL_PARTS.includes(id) ? partSetting.includes(id) : !partSetting.includes(`!${id}`);
  const songParts = round.parts.map(partKey).filter(isHeard).join(',');
  const partEvents = useMemo(() => {
    // the beats of the chosen sections, from the song start (after its intro)
    const { fromBeat, toBeat } = runWindow(round, range.first, range.last, bars);
    return buildPartEvents(
      round.parts,
      songParts.split(','),
      (round.tempo * speed) / 100,
      round.beatsPerBar,
      fromBeat,
      toBeat
    );
  }, [round, songParts, range, bars, speed]);
  const partEventsRef = useRef(partEvents);
  partEventsRef.current = partEvents;
  // the rhythm guitar of the song plays the chords instead of the chord sound (when it is
  // heard: turned down to nothing, the chords are heard again)
  const playsRhythmPart =
    (volumes.rhythm ?? OTHER_VOLUME) > 0 && partEvents.some((e) => e.role === 'rhythm');
  const playsRhythmPartRef = useRef(playsRhythmPart);
  playsRhythmPartRef.current = playsRhythmPart;
  const partCursor = useRef(0);
  const heardPartsRef = useRef<string[]>([]);
  heardPartsRef.current = songParts.split(',');
  // the song time at the last frame (to notice jumps)
  const lastSongTime = useRef(0);
  const lastBeat = useRef(-1);
  // listening: the song plays by itself, nothing is judged
  const [listening, setListening] = useState(false);
  const listeningRef = useRef(false);
  listeningRef.current = listening;

  // the saved speed is read when the song changes (saving it must not reset the sections)
  const savedSpeedRef = useRef(savedSpeed);
  savedSpeedRef.current = savedSpeed;

  // settings changed: new round (the same song, whole), waiting to start
  useEffect(() => {
    const next = newRound(undefined, roundRef.current?.song.id);
    setRound(next);
    setRange({ first: 0, last: next.sections.length - 1 });
    setBars(null);
    const nextSpeed = practicingRef.current ? savedSpeedRef.current : 100;
    setHits(makeHits(next, runWindow(next, 0, next.sections.length - 1, null), nextSpeed));
    setSpeed(nextSpeed);
    setLoop(0);
    setPhase('ready');
  }, [newRound, makeHits]);

  // another part to play: the hits of the same sections (while playing: from now on, the
  // song goes on)
  useEffect(() => {
    const r = roundRef.current;
    const next = makeHits(r, runWindow(r, range.first, range.last, barsRef.current), speed);
    if (phaseRef.current === 'playing') {
      const t = songTime.current;
      const fromNow = next.map((h) => (h.time < t - GOOD_MS ? { ...h, skipped: true } : h));
      hitsRef.current = fromNow;
      setHits(fromNow);
      // waiting on a note of the other part: the song goes on
      if (waitingRef.current !== null) {
        waitingRef.current = null;
        setWaiting(null);
        lastReal.current = performance.now();
        if (spotifyOnRef.current && !detachedRef.current) resumeRecordingRef.current();
      }
      return;
    }
    setHits(next);
    setPhase('ready');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playPart]);

  /** Plays a song (the same sections at the same speed, or a new song from the start),
   * or only listens to it */
  const start = (
    next: Round = round,
    options: {
      first?: number;
      last?: number;
      speed?: number;
      loop?: number;
      listen?: boolean;
      /** Spotify already plays the song: the game joins it where it is (the whole song) */
      join?: boolean;
    } = {}
  ) => {
    const isNew = next !== round || !!options.join;
    const first = options.join ? 0 : options.first ?? (isNew ? 0 : range.first);
    const last = options.join
      ? next.sections.length - 1
      : options.last ?? (isNew ? next.sections.length - 1 : range.last);
    // a recording plays at its real speed (slower: the game plays alone, see setPlayRate)
    const askedRunSpeed = options.speed ?? speed;
    const playSpeed = spotifyOnRef.current ? 100 : askedRunSpeed;
    const listen = !!options.listen;
    // the bars picked are played again (another song or other sections: the sections)
    const runBars = isNew || options.first !== undefined ? null : barsRef.current;
    const win = runWindow(next, first, last, runBars);
    setRound(next);
    setRange({ first, last });
    setBars(runBars);
    setSpeed(playSpeed);
    setLoop(options.loop ?? 0);
    setHits(makeHits(next, win, playSpeed));
    setListening(listen);
    listeningRef.current = listen;
    sounded.current = new Set();
    lastBeat.current = -1;
    partCursor.current = 0;
    lastSongTime.current = 0;
    // notes of a previous run, still to come, are stopped
    synth.stopAll();
    setCombo(0);
    setBestCombo(0);
    setScore(0);
    setJudgement(null);
    setNow(0);
    armed.current = true;
    songTime.current = 0;
    countInFrom.current = 0;
    lastReal.current = performance.now();
    // (a video slowed down by the last run is back to its speed)
    if (rateSupported.current) window.app.spotify.rate(1).catch(() => {});
    rateRef.current = 1;
    setRate(1);
    baseRateRef.current = 1;
    setBaseRate(1);
    detachedRef.current = false;
    setDetached(false);
    waitingRef.current = null;
    setWaiting(null);
    holdPollUntil.current = 0;
    recordingQueue.current = Promise.resolve();
    resumeRetried.current = false;
    // (Spotify has no speed: found out for YouTube when a miss slows it down)
    rateSupported.current = next.song.imported?.spotify?.uri.startsWith('youtube:') ? null : false;
    setSpotifyMessage('');
    spotifyPlayer.current = null;
    hitOffsets.current = [];
    setSyncAdjust(null);
    syncShift.current = 0;
    setShownShift(0);
    pendingAdjust.current = 0;
    tapOffsets.current = [];
    setTapCount(0);
    const link = next.song.imported?.spotify;
    if (spotifyOnRef.current && link?.firstChordMs !== undefined) {
      // where the song starts in the recording (its intro before the first chord): where each
      // beat is when the whole recording was heard, else at the tempo of the song
      const nextBeatMs = getBeatMs(next.tempo);
      const map = link.beatTimes;
      // practice: the chosen sections (or bars) start after the count-in
      const sectionBeat = win.fromBeat;
      const songStartMs = map
        ? msOfBeat(map, sectionBeat)
        : link.firstChordMs - ((next.rhythm.leadIn ?? 0) - sectionBeat) * nextBeatMs;
      const countInMs = map
        ? songStartMs - msOfBeat(map, sectionBeat - next.beatsPerBar)
        : next.beatsPerBar * nextBeatMs;
      spotifyTiming.current = {
        songStartMs,
        countInMs,
        runStartBeat: sectionBeat,
        synced: false,
      };
      // practice slower than Spotify plays: the game plays alone until back to speed
      const startSlower =
        !options.join &&
        !link.uri.startsWith('youtube:') &&
        gamePlaysSlowerRef.current &&
        askedRunSpeed < 100;
      if (startSlower) {
        const base = askedRunSpeed / 100;
        baseRateRef.current = base;
        setBaseRate(base);
        rateRef.current = base;
        setRate(base);
        detachedRef.current = true;
        setDetached(true);
        holdPollUntil.current = Infinity;
      } else if (!options.join) {
        setSpotifyMessage(`Starting the song on ${sourceName(link.uri)}...`);
        window.app.spotify
          .play(link.uri, Math.max(0, songStartMs - countInMs))
          .catch((e) =>
            showSpotifyError(e, `: play it in ${sourceName(link.uri)}, the game follows`)
          );
      }
    }
    setPhase('playing');
  };

  // Spotify is asked where it is, while playing or syncing (see SPOTIFY_POLL_MS)
  useEffect(() => {
    if (!spotifyLinked || (phase !== 'playing' && !calibrating)) return undefined;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // since when Spotify has not been playing the song (0: it plays it)
    let idleSince = 0;
    // just started: Spotify is given a moment to seek and play (asked often, no "paused" yet)
    const startedAt = Date.now();
    const settling = () => Date.now() - startedAt < 8000;
    // a button moved the song: what Spotify tells is followed until then (Date.now())
    let followUntil = 0;
    // when a button asked to check it (Date.now(); a poll on its way does not put it off)
    let checkAt = 0;
    const next = (ms: number) => {
      if (timer) clearTimeout(timer);
      const wait = checkAt > Date.now() ? Math.min(ms, checkAt - Date.now()) : ms;
      // (the next poll, defined just below)
      // eslint-disable-next-line no-use-before-define
      if (!stopped) timer = setTimeout(poll, wait);
    };
    checkRecordingSoon.current = (afterMs: number) => {
      checkAt = Date.now() + afterMs;
      followUntil = checkAt + 3000;
      next(afterMs);
    };
    const poll = async () => {
      // hidden: nothing asked (the game goes on by itself)
      // waiting on a note (the recording was stopped by the game), or just started again: what
      // it tells is not followed, nor is it idle
      if (document.visibilityState !== 'visible' || performance.now() < holdPollUntil.current) {
        next(SPOTIFY_POLL_MS);
        return;
      }
      let player: Awaited<ReturnType<typeof window.app.spotify.player>>;
      try {
        player = await window.app.spotify.player(spotifyLinkRef.current?.uri);
      } catch (e) {
        if (stopped) return;
        const text = errorText(e);
        showSpotifyError(e);
        // too many calls: as long as Spotify says
        const seconds = Number(/(\d+) s\)?$/.exec(text)?.[1]);
        next(seconds ? seconds * 1000 + 500 : SPOTIFY_ERROR_WAIT_MS);
        return;
      }
      if (stopped) return;
      setSpotifyError('');
      const where = player ? sourceName(player.track.uri) : sourceName(spotifyLinkRef.current?.uri);
      const isSong = !!player && isLinkedSong(player.track, spotifyLinkRef.current);
      if (!player) {
        spotifyPlayer.current = null;
        setSpotifyMessage(`Nothing plays in ${where}`);
      } else {
        if (player.volumePercent !== null) setSpotifyVolume(player.volumePercent);
        if (isSong && player.track.imageUrl) setSeenArt(player.track.imageUrl);
        // the moment Spotify measured it, on this page's clock
        const at = performance.now() - (Date.now() - player.measuredAt);
        let { progressMs } = player;
        // just checking (it plays on as followed): the game's own clock is kept, unless
        // Spotify is far from it (moved in Spotify)
        const before = spotifyPlayer.current;
        if (
          !settling() &&
          Date.now() > followUntil &&
          isSong &&
          player.isPlaying &&
          before?.isSong &&
          before.isPlaying
        ) {
          const expected = before.progressMs + (at - before.at) * before.rate;
          if (Math.abs(progressMs - expected) < CLOCK_JUMP_MS) progressMs = expected;
        }
        spotifyPlayer.current = {
          progressMs,
          at,
          isPlaying: player.isPlaying,
          track: player.track,
          isSong,
          rate: player.rate ?? 1,
        };
        // the speed it really plays at (the game's windows follow it)
        if (isSong && player.isPlaying && (player.rate ?? 1) !== rateRef.current) {
          rateRef.current = player.rate ?? 1;
          setRate(rateRef.current);
        }
        if (!isSong) {
          const sameName = spotifyLinkRef.current?.name
            .toLowerCase()
            .startsWith(player.track.name.toLowerCase());
          setSpotifyMessage(
            sameName
              ? `${where} plays another version of ${player.track.name}`
              : `${where} plays ${player.track.name}, not this song`
          );
        } else if (!player.isPlaying) {
          // started again on a note, but still paused: asked once more (else the game would
          // stay stuck on it)
          if (
            phase === 'playing' &&
            performance.now() < noJumpUntil.current &&
            waitingRef.current === null &&
            !detachedRef.current &&
            !resumeRetried.current
          ) {
            resumeRetried.current = true;
            resumeAt.current = recordingPositionAtRef.current(songTime.current);
            resumeRecordingRef.current();
          } else if (!settling()) setSpotifyMessage(`${where} is paused`);
        } else {
          setSpotifyMessage('');
        }
      }
      // Spotify not playing the song: asked less often, and the run stops after a while
      if (isSong && player?.isPlaying) {
        idleSince = 0;
        next(settling() || Date.now() < followUntil ? SPOTIFY_POLL_MS : SPOTIFY_CHECK_MS);
        return;
      }
      idleSince = idleSince || Date.now();
      if (phase === 'playing' && Date.now() - idleSince > SPOTIFY_IDLE_STOP_MS) {
        synth.stopAll();
        setPhase('ready');
        setSpotifyMessage(`Stopped: ${where} was not playing the song`);
        return;
      }
      next(settling() ? 1000 : SPOTIFY_IDLE_POLL_MS);
    };
    poll();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      checkRecordingSoon.current = () => {};
    };
  }, [spotifyLinked, phase, calibrating]);

  // following Spotify: the imported songs as they are now (read by the polling)
  const customSongsRef = useRef(gameSettings.customSongs ?? []);
  customSongsRef.current = gameSettings.customSongs ?? [];

  /**
   * Plays along with what Spotify plays: the song is linked to that exact track (another
   * version is linked instead, and searched for by listening), picked, then joined
   */
  const followSong = useCallback(
    async (song: ImportedSong, track: SpotifyTrack) => {
      if (!song.bpm) {
        setFollowing({
          track,
          song,
          error: 'it has no tempo: type it in the settings',
        });
        return;
      }
      setFollowing({ track, song, busy: 'Joining' });
      let songs = customSongsRef.current;
      if (!isLinkedSong(track, song.spotify) || song.spotify?.firstChordMs === undefined) {
        const link = await spotifyLinkFor(song, track);
        songs = songs.map((s) => (s.id === song.id ? { ...s, spotify: link } : s));
        if (!songs.some((s) => s.id === song.id)) songs = [...songs, { ...song, spotify: link }];
        await updateSetting('rhythmGame.customSongs', songs);
      }
      if (gameSettings.song !== song.id) await updateSetting('rhythmGame.song', song.id);
      setJoinSongId(song.id);
    },
    [gameSettings.song, updateSetting]
  );

  // the followed song is ready: joined where Spotify is
  useEffect(() => {
    if (!joinSongId || round.song.id !== joinSongId || !spotifyOn || phase === 'playing') return;
    setJoinSongId(null);
    setFollowing(null);
    // not synced yet (only estimated): synced quickly first, then back where Spotify was
    const resume = syncFirst.current;
    syncFirst.current = null;
    if (resume && !round.song.imported?.spotify?.beatTimes) {
      const songId = round.song.id;
      const syncThenJoin = async () => {
        await syncByPartsRef.current();
        await window.app.spotify.play(resume.uri, resume.positionMs).catch(() => {});
        setJoinSongId(songId);
      };
      syncThenJoin().catch(() => {});
      return;
    }
    start(round, { join: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joinSongId, round, spotifyOn, phase]);

  // a song that could not be joined (its round never came) is given up
  useEffect(() => {
    if (!joinSongId) return undefined;
    const timeout = setTimeout(() => setJoinSongId(null), 8000);
    return () => clearTimeout(timeout);
  }, [joinSongId]);

  /** Following Spotify: the song it plays is imported (from Songsterr), then joined */
  /** Imports the song followed: searched by its name, or from a tab's link pasted */
  const importFollowed = async (link?: string) => {
    if (!following) return;
    const { track } = following;
    setFollowing({ track, busy: 'Importing' });
    try {
      const artist = track.artists.split(',')[0];
      const result = await importSongFromWeb(
        link ?? `${track.name.replace(/\s+-\s+.*$/, '')} ${artist}`
      );
      const song: ImportedSong = { id: `imported-${Date.now()}`, ...result };
      await followSong(song, track);
    } catch (e) {
      setFollowing({
        track,
        error: `it could not be imported: ${errorText(e)}`,
      });
    }
  };

  /**
   * Plays along with a track playing from a position (ms): joined there, or imported first when
   * it is not one of the songs (synced quickly first, when it can be)
   */
  const playAlongWith = async (track: SpotifyTrack, positionMs: number, known?: ImportedSong) => {
    setRecordingOff(false);
    // (when chosen in the settings)
    syncFirst.current =
      listenSync && gameSettings.syncBeforeJoin ? { uri: track.uri, positionMs } : null;
    const song = known ?? findSongForTrack(customSongsRef.current, track);
    if (song) {
      await followSong(song, track);
      return;
    }
    setFollowing({ track, busy: 'Importing' });
    try {
      const artist = track.artists.split(',')[0];
      const result = await importSongFromWeb(`${track.name.replace(/\s+-\s+.*$/, '')} ${artist}`);
      await followSong({ id: `imported-${Date.now()}`, ...result }, track);
    } catch (e) {
      setFollowing({
        track,
        error: `it could not be imported: ${errorText(e)}`,
      });
    }
  };

  // on the start screen: what Spotify plays, asked with a click (Spotify allows few calls):
  // undefined until asked, null when nothing plays
  const [nowPlaying, setNowPlaying] = useState<SpotifyTrack | null | undefined>(undefined);
  const [checking, setChecking] = useState(false);
  const [nowPaused, setNowPaused] = useState(false);
  // everything that was there (a few browsers, Spotify): one is picked
  const [nowPlayers, setNowPlayers] = useState<SpotifyPlayerState[]>([]);
  const pickNowPlaying = (player: SpotifyPlayerState) => {
    setNowPlaying(player.track);
    setNowPaused(!player.isPlaying);
  };
  const checkSpotify = async () => {
    setChecking(true);
    try {
      // everything there, paused too (it is played again from there, e.g. after a run was
      // stopped): the one playing is picked first, the others can be picked instead
      const players = await window.app.spotify.players();
      const player = players.find((each) => each.isPlaying) ?? players[0];
      setNowPlayers(players);
      setNowPlaying(player?.track ?? null);
      setNowPaused(!!player && !player.isPlaying);
      setSpotifyError('');
    } catch (e) {
      // (what plays is not known: as it was)
      showSpotifyError(e);
    } finally {
      setChecking(false);
    }
  };
  const nowPlayingSong = nowPlaying && findSongForTrack(gameSettings.customSongs ?? [], nowPlaying);

  /**
   * A song typed by its name, or a link (YouTube, Spotify): played where it is chosen to play
   * (whatever the link is from: a Spotify link plays on YouTube, the same song searched there,
   * and the other way round): on YouTube (in the browser playing it, else a new tab) or on
   * Spotify from its start, and played along with; or not played at all (the song is picked,
   * or imported, and the game plays alone)
   */
  const playOn = gameSettings.playOn ?? 'youtube';
  const [typedSong, setTypedSong] = useState('');
  const [openingSong, setOpeningSong] = useState(false);
  const playByName = async () => {
    const typed = typedSong.trim();
    setOpeningSong(true);
    setSpotifyError('');
    try {
      // a link: the track or video it is (to play it as is, or to search its song elsewhere)
      const isSpotifyLink = /open\.spotify\.com\/|spotify:track:/i.test(typed);
      const isYouTubeLink = !isSpotifyLink && /youtube\.com\/|youtu\.be\//i.test(typed);
      // another link: the page of a tab (Songsterr...), imported as it is
      const isTabLink = !isSpotifyLink && !isYouTubeLink && /^https?:\/\//i.test(typed);
      let linked: SpotifyTrack | null = null;
      if (isSpotifyLink) linked = await window.app.spotify.track(typed);
      else if (isYouTubeLink) linked = await window.app.youtube.video(typed);
      let tab: ImportedSong | null = null;
      if (isTabLink) {
        setSpotifyMessage('Importing the tab...');
        tab = { id: `imported-${Date.now()}`, ...(await importSongFromWeb(typed)) };
        await updateSetting('rhythmGame.customSongs', [...customSongsRef.current, tab]);
        setSpotifyMessage('');
      }
      // (what it is called: its song and artist)
      let name = typed;
      if (linked) name = `${linked.name} ${linked.artists.split(',')[0]}`.trim();
      else if (tab) name = tab.title.replace(/\s+by\s+/i, ' ');
      if (playOn === 'none') {
        let song = tab ?? findSongByName(customSongsRef.current, name);
        if (!song) {
          setSpotifyMessage(`Importing ${name}...`);
          song = {
            id: `imported-${Date.now()}`,
            ...(await importSongFromWeb(name)),
          };
          await updateSetting('rhythmGame.customSongs', [...customSongsRef.current, song]);
        }
        setSpotifyMessage('');
        setRecordingOff(true);
        await updateSetting('rhythmGame.song', song.id);
        setTypedSong('');
        return;
      }
      let track: SpotifyTrack | null;
      if (playOn === 'spotify') {
        track = isSpotifyLink ? linked : await window.app.spotify.search(name);
      } else {
        track = isYouTubeLink ? linked : await window.app.youtube.search(name);
      }
      if (!track) throw new Error(`${name} was not found on ${sourceName(`${playOn}:`)}`);
      setFollowing({
        track,
        busy: playOn === 'spotify' ? 'Playing it on Spotify' : 'Playing it in the browser',
      });
      await window.app.spotify.play(track.uri, 0);
      setNowPlaying(track);
      setNowPaused(false);
      setTypedSong('');
      await playAlongWith(track, 0, tab ?? undefined);
    } catch (e) {
      setFollowing(null);
      setSpotifyMessage('');
      showSpotifyError(e);
    } finally {
      setOpeningSong(false);
    }
  };

  /**
   * Plays along with the song Spotify plays now, once (not following Spotify after it): joined
   * where Spotify is, or imported first when it is not one of the songs
   */
  const playAlong = async () => {
    let player: SpotifyPlayerState | undefined;
    try {
      // the one picked, as it is now (followed from now on)
      const players = await window.app.spotify.players();
      player =
        players.find((each) => nowPlaying && each.track.uri === nowPlaying.uri) ?? players[0];
      if (player) await window.app.spotify.select(player.track.uri);
      setSpotifyError('');
    } catch (e) {
      showSpotifyError(e);
      return;
    }
    // nothing there (anymore): told in the Spotify box
    if (!player) {
      setNowPlaying(null);
      return;
    }
    setSpotifyMessage('');
    // paused (a run stopped pauses it): played again from where it is
    if (!player.isPlaying) {
      try {
        await window.app.spotify.play(player.track.uri, player.progressMs);
      } catch (e) {
        showSpotifyError(e);
        return;
      }
    }
    setNowPaused(false);
    await playAlongWith(player.track, player.progressMs);
  };

  /** Syncing: Spotify plays the song from its start, a tap marks its first chord */
  const calibrate = () => {
    if (!spotifyLink) return;
    spotifyPlayer.current = null;
    setSpotifyMessage(`Starting the song on ${recordingSource}...`);
    setCalibrating(true);
    window.app.spotify
      .play(spotifyLink.uri, 0)
      .catch((e) => showSpotifyError(e, `: start it from the beginning in ${recordingSource}`));
  };

  /**
   * Saves where the first chord of the song is in the Spotify recording, and where each beat
   * is when the whole recording was heard. Moved (tapped, arrows): every beat moves with it.
   * Estimated: the beats heard are forgotten.
   */
  const saveSync = useCallback(
    (
      firstChordMs: number,
      syncedBy: 'estimate' | 'tap' | 'playing' | 'listening' | 'parts',
      beatTimes?: number[]
    ) => {
      const songId = round.song.id;
      updateSetting(
        'rhythmGame.customSongs',
        (gameSettings.customSongs ?? []).map((song) => {
          if (song.id !== songId || !song.spotify) return song;
          const moved = Math.round(firstChordMs) - (song.spotify.firstChordMs ?? 0);
          const beats =
            beatTimes ??
            (syncedBy === 'estimate' ? undefined : song.spotify.beatTimes?.map((ms) => ms + moved));
          return {
            ...song,
            spotify: {
              ...song.spotify,
              ...(beatTimes && { bpm: mapTempo(beatTimes) }),
              firstChordMs: Math.round(firstChordMs),
              // the beats heard, only moved: still synced by listening
              syncedBy:
                !beatTimes && beats && heardBy(song.spotify.syncedBy)
                  ? song.spotify.syncedBy
                  : syncedBy,
              beatTimes: beats,
            },
          };
        })
      );
    },
    [round, gameSettings.customSongs, updateSetting]
  );

  /** Syncs without tapping: estimated from the lengths of the recording and of the song */
  const autoSync = async () => {
    const song = round.song.imported;
    if (!song?.spotify) return;
    setSpotifyMessage('Syncing...');
    try {
      const durationMs =
        song.spotify.durationMs ?? (await window.app.spotify.search(song.spotify.name))?.durationMs;
      if (!durationMs) throw new Error(`${recordingSource} did not give the length of the song`);
      const spotifyBars = await window.app.spotify.bars(song.spotify.uri);
      const firstChordMs = estimateFirstChordMs(song, durationMs, spotifyBars);
      if (firstChordMs === null) throw new Error('This song has no tempo');
      saveSync(firstChordMs, 'estimate');
      setSpotifyMessage('');
    } catch (e) {
      showSpotifyError(e);
    }
  };

  /**
   * Syncing by listening: Spotify plays the whole song once, from its start to its end, and it
   * is heard all along (the game's own sound is off). Then the notes and hits heard are lined
   * up with the song all at once: where each of its beats is in the recording, even where the
   * band slows down or speeds up. Stopped before the end: the beats heard so far.
   */
  useEffect(() => {
    setHearSync(null);
  }, [round.song.id]);
  const syncByListening = async () => {
    const song = round.song.imported;
    const link = song?.spotify;
    if (!song?.bpm || !link) return;
    hearStop.current = false;
    setSpotifyMessage('');
    setHearSync({ heardMs: 0, durationMs: link.durationMs ?? 0 });
    const listener = new SongListener();
    listener.keepOnsets = true;
    const wait = (ms: number) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms);
      });
    // when the recording started (on this page's clock), from each answer of Spotify
    const starts: number[] = [];
    const startAt = () => [...starts].sort((x, y) => x - y)[Math.floor(starts.length / 2)];
    let durationMs = link.durationMs ?? 0;
    let heardUntil = 0;
    let stopped = '';
    // answers in a row where Spotify did not play the song (one blip is not a pause)
    let bad = 0;
    try {
      await listener.start(syncInput, link.uri);
      const { label } = listener;
      setHearSync({ heardMs: 0, durationMs, label });
      await window.app.spotify.play(link.uri, 0);
      const askedAt = performance.now();
      await wait(HEAR_SETTLE_MS);
      while (!hearStop.current) {
        // eslint-disable-next-line no-await-in-loop
        const player = await window.app.spotify.player(link.uri).catch(spotifyBusyOrNull);
        const at = player && performance.now() - (Date.now() - player.measuredAt);
        const playing = !!player?.isPlaying && isLinkedSong(player.track, link);
        if (!player || at === null || !playing) {
          // the end of the song (Spotify stops, or plays the next one)
          if (starts.length && durationMs && heardUntil >= durationMs - 4000) break;
          if (starts.length) {
            bad += 1;
            if (bad < 3) {
              // eslint-disable-next-line no-await-in-loop
              await wait(HEAR_POLL_MS / 2);
              // eslint-disable-next-line no-continue
              continue;
            }
            stopped = player?.isPlaying
              ? `${recordingSource} played another song`
              : `${recordingSource} was paused`;
            break;
          }
          if (performance.now() - askedAt > HEAR_START_MS) {
            throw new Error(`${recordingSource} did not play the song`);
          }
          // (not started yet)
          // eslint-disable-next-line no-await-in-loop
          await wait(HEAR_POLL_MS);
          // eslint-disable-next-line no-continue
          continue;
        }
        bad = 0;
        durationMs = player.track.durationMs || durationMs;
        const startedAt = at - player.progressMs;
        if (starts.length >= 4 && Math.abs(startedAt - startAt()) > HEAR_JUMP_MS) {
          stopped = `${recordingSource} was moved in the song`;
          break;
        }
        starts.push(startedAt);
        heardUntil = player.progressMs;
        setHearSync({ heardMs: heardUntil, durationMs, label });
        if (durationMs && heardUntil >= durationMs - 1000) break;
        // eslint-disable-next-line no-await-in-loop
        await wait(HEAR_POLL_MS);
      }
      window.app.spotify.pause().catch(() => {});
      listener.stop();
      if (heardUntil < HEAR_MIN_MS) {
        throw new Error(
          stopped || (hearStop.current ? 'Stopped' : 'Not enough of the song was heard')
        );
      }
      const recordingStart = startAt();
      const recording = {
        frames: listener.frames
          .map((frame) => ({
            positionMs: frame.at - recordingStart,
            chroma: frame.chroma,
          }))
          .filter((frame) => frame.positionMs >= 0 && frame.positionMs <= heardUntil),
        onsets: listener.onsets
          .map((onset) => ({
            positionMs: onset.positionMs - recordingStart,
            value: onset.value,
          }))
          .filter((onset) => onset.positionMs >= 0 && onset.positionMs <= heardUntil),
        heardMs: heardUntil,
        durationMs: durationMs || heardUntil,
      };
      if (recording.frames.length < 200) {
        throw new Error('The song could not be heard: pick the sound input in the settings');
      }
      setHearSync({
        heardMs: heardUntil,
        durationMs,
        message: 'Lining up the song...',
      });
      // (the message shows before the work starts)
      await wait(50);
      const leadIn = round.rhythm.leadIn ?? 0;
      const result = alignSong(
        recording,
        buildSongTemplate(round.chords, round.beatsPerBar, leadIn, round.parts),
        buildSongOnsets(round.chords, round.beatsPerBar, leadIn, round.parts),
        getBeatMs(song.bpm)
      );
      if (!result) throw new Error('What was heard does not sound like this song');
      saveSync(msOfBeat(result.map, leadIn), 'listening', result.map);
      const tempos = result.map
        .slice(0, Math.ceil(result.heardBeats))
        .map((ms, i, all) => (i >= 4 ? 240000 / (ms - all[i - 4]) : 0))
        .filter((bpm) => bpm > 0)
        .sort((x, y) => x - y);
      const tempoAt = (part: number) => Math.round(tempos[Math.floor(tempos.length * part)]);
      const tempoRange = tempos.length
        ? ` · the band plays from ${tempoAt(0.05)} to ${tempoAt(0.95)} BPM`
        : '';
      const upTo = heardUntil < durationMs - 4000 ? ` up to ${formatTime(heardUntil)}` : '';
      const why = stopped ? ` (${stopped.toLowerCase()})` : '';
      setHearSync({
        heardMs: heardUntil,
        durationMs,
        ok: true,
        message: `Synced by listening${upTo}${why}${tempoRange}`,
      });
    } catch (e) {
      window.app.spotify.pause().catch(() => {});
      setHearSync({ heardMs: 0, durationMs, message: errorText(e) });
    } finally {
      listener.stop();
    }
  };

  /**
   * Syncing quickly: Spotify plays a few parts of the song (from its start to near its end),
   * each is found in the song, and the beats between them go at the tempo between them (a
   * band slowing down or speeding up between two parts is not heard: the whole song is)
   */
  const syncByParts = async () => {
    const song = round.song.imported;
    const link = song?.spotify;
    if (!song?.bpm || !link) return false;
    hearStop.current = false;
    setSpotifyMessage('');
    let durationMs = link.durationMs ?? 0;
    setHearSync({ heardMs: 0, durationMs, part: 0, parts: 0 });
    const listener = new SongListener();
    listener.keepOnsets = true;
    const wait = (ms: number) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms);
      });
    try {
      // Spotify stopped or paused: it is started first (it fails to move in a song it does
      // not play), and it tells the length of the song once it plays it. It plays before the
      // listening starts: Spotify alone can only be heard once it makes a sound, else the whole
      // computer is heard
      setHearSync({ heardMs: 0, durationMs, part: 0, parts: 0 });
      const started = await startSong(link, 0, () => hearStop.current);
      await listener.start(syncInput, link.uri);
      const { label } = listener;
      setHearSync({ heardMs: 0, durationMs, label, part: 0, parts: 0 });
      durationMs = durationMs || started.track.durationMs;
      if (!durationMs) throw new Error(`${recordingSource} did not give the length of the song`);
      const parts = Math.max(
        HEAR_PARTS_MIN,
        Math.min(HEAR_PARTS_MAX, Math.round(durationMs / HEAR_PART_EVERY_MS) + 1)
      );
      const recording = {
        frames: [] as { positionMs: number; chroma: Float32Array }[],
        onsets: [] as { positionMs: number; value: number }[],
        clips: [] as [number, number][],
        heardMs: 0,
        durationMs,
      };
      for (let part = 0; part < parts; part += 1) {
        if (hearStop.current) throw new Error('Cancelled');
        // from the very start to a few seconds before the end
        const at = (part / (parts - 1)) * Math.max(0, durationMs - HEAR_PART_MS - 5000);
        setHearSync({ heardMs: at, durationMs, label, part: part + 1, parts });
        // the seek is waited for: Spotify stalls and catches up after it, so this part is only
        // collected once two answers in a row agree on when the song started (see startSong)
        // eslint-disable-next-line no-await-in-loop
        await startSong(link, at, () => hearStop.current);
        const askedAt = performance.now();
        // when this part started (on this page's clock), from each answer of Spotify, and
        // from when to when it was heard
        const starts: number[] = [];
        let restarts = 0;
        // answers in a row where Spotify did not play the song (one blip is not a pause)
        let bad = 0;
        let firstAt = 0;
        let lastAt = 0;
        let lastProgress = -1;
        // Spotify's position only lags (stale, in steps), never runs ahead: the truest start of
        // the part is among the lowest ones (the 15th percentile, not the median)
        const lowStart = () => [...starts].sort((x, y) => x - y)[Math.floor(starts.length * 0.15)];
        while (!hearStop.current && lastAt - firstAt < HEAR_PART_MS) {
          // eslint-disable-next-line no-await-in-loop
          const player = await window.app.spotify.player(link.uri).catch(spotifyBusyOrNull);
          if (player?.isPlaying && isLinkedSong(player.track, link)) {
            bad = 0;
            const pageAt = performance.now() - (Date.now() - player.measuredAt);
            const startedAt = pageAt - player.progressMs;
            // moved ahead (the start is earlier than all before) or back (position went back)
            const movedAhead = starts.length >= 4 && lowStart() - startedAt > HEAR_JUMP_MS;
            const movedBack = lastProgress >= 0 && player.progressMs < lastProgress - 1000;
            if (movedAhead || movedBack) {
              // the position jumped (after a seek Spotify may stall or catch up): what this part
              // collected is dropped and it is collected again from here, a few times at most
              restarts += 1;
              if (restarts > HEAR_RESTARTS) {
                throw new Error(`${recordingSource} was moved in the song`);
              }
              starts.length = 0;
              firstAt = 0;
              lastAt = 0;
            }
            lastProgress = player.progressMs;
            starts.push(startedAt);
            firstAt = firstAt || pageAt;
            lastAt = pageAt;
          } else if (starts.length) {
            bad += 1;
            if (bad >= 3) {
              throw new Error(
                player?.isPlaying
                  ? `${recordingSource} played another song`
                  : `${recordingSource} was paused`
              );
            }
          } else if (performance.now() - askedAt > HEAR_START_MS) {
            throw new Error(`${recordingSource} did not play the song`);
          }
          // eslint-disable-next-line no-await-in-loop
          await wait(HEAR_PART_POLL_MS);
        }
        if (hearStop.current) throw new Error('Cancelled');
        // what was heard of this part (not the end of the part before it, still coming)
        const partStart = lowStart();
        recording.frames.push(
          ...listener.frames
            .filter((frame) => frame.at >= firstAt && frame.at <= lastAt)
            .map((frame) => ({
              positionMs: frame.at - partStart,
              chroma: frame.chroma,
            }))
        );
        recording.onsets.push(
          ...listener.onsets
            .filter((onset) => onset.positionMs >= firstAt && onset.positionMs <= lastAt)
            .map((onset) => ({
              positionMs: onset.positionMs - partStart,
              value: onset.value,
            }))
        );
        recording.clips.push([firstAt - partStart, lastAt - partStart]);
        recording.heardMs = lastAt - partStart;
      }
      window.app.spotify.pause().catch(() => {});
      listener.stop();
      if (recording.frames.length < 200) {
        throw new Error('The song could not be heard: pick the sound input in the settings');
      }
      setHearSync({
        heardMs: 0,
        durationMs,
        message: 'Finding the parts in the song...',
      });
      // (the message shows before the work starts)
      await wait(50);
      const leadIn = round.rhythm.leadIn ?? 0;
      const result = alignClips(
        recording,
        buildSongTemplate(round.chords, round.beatsPerBar, leadIn, round.parts),
        buildSongOnsets(round.chords, round.beatsPerBar, leadIn, round.parts),
        getBeatMs(song.bpm)
      );
      if (!result) {
        throw new Error(
          'The parts heard did not sound like this song: try syncing with the whole song'
        );
      }
      saveSync(msOfBeat(result.map, leadIn), 'parts', result.map);
      const missed = parts - result.used;
      setHearSync({
        heardMs: 0,
        durationMs,
        ok: true,
        message: `Synced from ${result.used} parts of the song${
          missed ? ` (${missed} did not sound like the tab)` : ''
        } · about ${Math.round(mapTempo(result.map))} BPM · the whole song is closer`,
      });
      return true;
    } catch (e) {
      window.app.spotify.pause().catch(() => {});
      setHearSync({ heardMs: 0, durationMs, message: errorText(e) });
      return false;
    } finally {
      listener.stop();
    }
  };

  syncByPartsRef.current = syncByParts;

  /**
   * Quick sync from its buttons: Spotify starts the song by itself (see syncByParts), and when
   * it is done (or failed, or was cancelled) Spotify plays again what it was playing, from where
   * it was. Paused or stopped before: left paused.
   */
  const quickSync = async () => {
    const link = round.song.imported?.spotify;
    if (!link) return;
    const before = await window.app.spotify.player(link.uri).catch(() => null);
    const resume = before?.isPlaying
      ? {
          uri: before.track.uri,
          positionMs: before.progressMs + Math.max(0, Date.now() - before.measuredAt),
        }
      : null;
    await syncByParts();
    if (resume) {
      await window.app.spotify
        .play(resume.uri, resume.positionMs)
        .catch((e) => showSpotifyError(e, ': press play in Spotify to go on'));
    }
  };

  const tap = useCallback(() => {
    const player = spotifyPlayer.current;
    if (!player?.isPlaying || !player.isSong) return;
    saveSync(player.progressMs + (performance.now() - player.at), 'tap');
    setCalibrating(false);
    window.app.spotify.pause().catch(() => {});
  }, [saveSync]);

  // syncing: Space (or Enter) taps, Esc gives up
  useEffect(() => {
    if (!calibrating) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        tap();
      }
      if (event.key === 'Escape') {
        setCalibrating(false);
        window.app.spotify.pause().catch(() => {});
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [calibrating, tap]);

  // when a run with Spotify ends: the sync moved by the arrows, the taps and the playing is saved
  const wasPlaying = useRef(false);
  useEffect(() => {
    if (phase === 'playing') {
      wasPlaying.current = true;
      return;
    }
    if (!wasPlaying.current) return;
    wasPlaying.current = false;
    const firstChordMs = spotifyLinkRef.current?.firstChordMs;
    const total = syncShift.current + pendingAdjust.current;
    const source = pendingAdjust.current ? 'playing' : 'tap';
    syncShift.current = 0;
    pendingAdjust.current = 0;
    if (firstChordMs === undefined || Math.abs(total) < 1) return;
    saveSync(firstChordMs + total, source);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  /** Moves the sync with Spotify (ms, later when more): live while playing, saved otherwise */
  const moveSync = (ms: number) => {
    if (phase === 'playing') {
      syncShift.current += ms;
      setShownShift(syncShift.current);
    } else if (spotifyLink?.firstChordMs !== undefined) {
      saveSync(spotifyLink.firstChordMs + ms, 'tap');
    }
  };

  /** Listening with Spotify: a tap on a chord change, the sync follows the taps */
  const listenTap = useCallback(() => {
    const t = songTime.current - latencyRef.current;
    const nearest = hitsRef.current
      .filter((h) => h.chordStart && Math.abs(h.time - t) <= 500)
      .sort((a, b) => Math.abs(a.time - t) - Math.abs(b.time - t))[0];
    if (!nearest) return;
    tapOffsets.current.push(t - nearest.time);
    setTapCount(tapOffsets.current.length);
    const offset = medianOffset(tapOffsets.current, 4);
    if (offset === null) return;
    // tapped late: the recording is later than the game thought
    syncShift.current += offset;
    setShownShift(syncShift.current);
    tapOffsets.current = [];
  }, []);

  /** Stops the song (and Spotify) */
  const stop = useCallback(() => {
    setPhase('ready');
    synth.stopAll();
    setCalibrating(false);
    holdPollUntil.current = 0;
    if (spotifyOnRef.current) {
      window.app.spotify.pause().catch(() => {});
      // (and not left slowed down)
      if (rateSupported.current) window.app.spotify.rate(1).catch(() => {});
    }
  }, []);

  const record = useCallback((id: number, result: HitResult) => {
    setHits((current) => current.map((h) => (h.id === id ? { ...h, result } : h)));
    setJudgement({ result, id });
    if (result === 'miss') {
      setCombo(0);
      return;
    }
    const nextCombo = comboRef.current + 1;
    setCombo(nextCombo);
    setBestCombo((best) => Math.max(best, nextCombo));
    setScore((s) => s + getHitPoints(result, comboRef.current));
  }, []);

  // the lane moves, chords not played in time are missed, the song ends
  useEffect(() => {
    if (phase !== 'playing') return undefined;
    let frame = 0;
    const tick = () => {
      const real = performance.now();
      const player = spotifyPlayer.current;
      if (spotifyOnRef.current && detachedRef.current) {
        // the recording is paused: the game plays the song by itself, slower
        if (waitingRef.current === null) {
          songTime.current += (real - lastReal.current) * rateRef.current;
        }
      } else if (spotifyOnRef.current) {
        // the song time follows Spotify (still while it has not started, or is paused, or the
        // game waits on a note: it stays on the note)
        if (waitingRef.current === null && player?.isPlaying && player.isSong) {
          const { songStartMs, countInMs, runStartBeat } = spotifyTiming.current;
          // (slowed down: the recording moves less than the time that passes)
          const progress = player.progressMs + (real - player.at) * player.rate;
          // where each beat is, when the whole recording was heard (else at the song's tempo)
          const beatMap = spotifyLinkRef.current?.beatTimes;
          const model = beatMap ? modelAt(beatMap, progress - syncShift.current) : null;
          const target = model
            ? (beatsPerBar + beatAt(model, progress - syncShift.current) - runStartBeat) * beatMs
            : progress - (songStartMs + syncShift.current) + countInMs;
          const drift = target - songTime.current;
          const resumed = real < noJumpUntil.current;
          if (!spotifyTiming.current.synced || (Math.abs(drift) > CLOCK_JUMP_MS && !resumed)) {
            // started, or moved in Spotify: there at once (not just after it started again on a
            // note: what it tells is stale then)
            songTime.current = target;
            spotifyTiming.current.synced = true;
          } else {
            // at the recording's pace, catching up gently (a little faster or slower): a
            // correction never shows as a jump
            const pace = model ? beatMs / model.beatMs : 1;
            const catchUp = Math.max(
              -CLOCK_CATCH_UP,
              Math.min(CLOCK_CATCH_UP, drift / CLOCK_CATCH_UP_MS)
            );
            songTime.current += (real - lastReal.current) * pace * player.rate * (1 + catchUp);
          }
        }
      } else if (waitingRef.current === null) {
        songTime.current += (real - lastReal.current) * rateRef.current;
      }
      lastReal.current = real;
      const t = songTime.current;
      setNow(t);

      // the song jumped (restarted, or moved back or ahead in Spotify): the sound follows
      if (t < lastSongTime.current - 200 || t > lastSongTime.current + 1500) {
        synth.stopAll();
        const events = partEventsRef.current;
        const next = events.findIndex((e) => e.time >= t);
        partCursor.current = next === -1 ? events.length : next;
        sounded.current = new Set(hitsRef.current.filter((h) => h.time < t).map((h) => h.id));
        lastBeat.current = Math.floor(t / beatMs);
        // moved back (a seek, a section again): the chords coming again can be played again (a
        // small correction keeps what was played)
        if (t < lastSongTime.current - REPLAY_BACK_MS) {
          setHits((current) =>
            // (listening: only the chords still to come, the others are not played again)
            current.map((h) =>
              h.time >= t - (listeningRef.current ? 0 : GOOD_MS)
                ? { ...h, result: undefined, skipped: false }
                : h
            )
          );
        } else if (t > lastSongTime.current) {
          // moved ahead (joined in the middle, or Spotify moved on): the chords passed are
          // skipped, not missed
          // (marked, not removed: listening may move the song back to them)
          const skip = (h: Hit) =>
            isOpen(h) && h.time < t - GOOD_MS ? { ...h, skipped: true } : h;
          hitsRef.current = hitsRef.current.map(skip);
          setHits((current) => current.map(skip));
        }
      }
      lastSongTime.current = t;

      // built-in sound (not while waiting on a note)
      if (waitingRef.current === null) {
        const beatNow = Math.floor(t / beatMs);
        // the count-in is always heard (its own volume), the click when it is on
        const countBeat = beatNow - Math.round(countInFrom.current / beatMs);
        const counting = countBeat >= 0 && countBeat < beatsPerBar;
        if ((counting || sound === 'click' || sound === 'both') && beatNow !== lastBeat.current) {
          lastBeat.current = beatNow;
          synth.click(
            counting ? countBeat === 0 : beatNow % beatsPerBar === 0,
            counting ? 'countIn' : 'click'
          );
        }
        // (the recording paused: the game plays the song instead)
        const playsSong =
          listeningRef.current || sound === 'chords' || sound === 'both' || detachedRef.current;
        // the parts of the song: notes coming soon are scheduled on the audio clock
        if (playsSong) {
          const events = partEventsRef.current;
          while (
            partCursor.current < events.length &&
            events[partCursor.current].time < t + LOOKAHEAD_MS * rateRef.current
          ) {
            const event = events[partCursor.current];
            partCursor.current += 1;
            // notes long gone (the song was paused) are not played late
            if (event.time >= t - 50) {
              synth.play(
                [event.midi],
                event.duration / rateRef.current / 1000,
                // listening: the parts are softer, so the chords stand out
                listeningRef.current ? Math.round(event.velocity * 0.6) : event.velocity,
                (event.time - t) / rateRef.current / 1000,
                event.part as Channel
              );
            }
          }
        }
        if (playsSong) {
          const due = hitsRef.current.filter((h) => t >= h.time && !sounded.current.has(h.id));
          due.forEach((h) => {
            sounded.current.add(h.id);
            // a chord reached long ago (the song was paused) is not played late,
            // the rhythm guitar of the song plays the chords itself
            // (listening: the chords are always heard, on top of the song's parts)
            const seconds = ((h.length * beatMs) / rateRef.current / 1000) * 0.85;
            // a part played by the player: its notes are heard when the part is not
            if (h.notes) {
              const played = playPartRef.current;
              if (t - h.time > 150 || heardPartsRef.current.includes(played)) return;
              // (a chord held for its strums: each strum is heard, on time)
              const strums = [{ time: h.time, notes: h.notes }, ...(h.strums ?? [])];
              strums.forEach((strum, i) => {
                const end = strums[i + 1]?.time ?? h.time + h.length * beatMs;
                synth.play(
                  strum.notes,
                  h.strums ? ((end - strum.time) / rateRef.current / 1000) * 0.85 : seconds,
                  95,
                  Math.max(0, (strum.time - t) / rateRef.current / 1000),
                  played as Channel
                );
              });
              return;
            }
            if (t - h.time > 150 || (playsRhythmPartRef.current && !listeningRef.current)) return;
            const velocity = listeningRef.current ? 115 : 95;
            // a guitar strums the chord
            const strum = synth.isPlucked('chords') ? 0.018 : 0;
            synth.play(getGuideNotes(h), seconds, h.chordStart ? velocity : 70, 0, 'chords', strum);
          });
          // listening: the chords are played by the song itself
          if (listeningRef.current && due.length) {
            const ids = new Set(due.map((h) => h.id));
            setHits((current) =>
              current.map((h) => (ids.has(h.id) ? { ...h, result: 'perfect' } : h))
            );
          }
        }
      }

      // timing windows are real time: in song time they shrink when slowed down
      // (a recording that cannot be slowed down waits instead)
      const mode = missMode(
        onMiss,
        spotifyOnRef.current,
        rateSupported.current,
        gamePlaysSlowerRef.current
      );
      // a note's keys pressed a little early (before it could be judged) and held into it: played
      // when it comes (not by a key that played a note already)
      if (!listeningRef.current && heldNotes.current.length) {
        const early = EARLY_MS * rateRef.current;
        const keysHeld = heldNotes.current;
        const shift = strictShiftRef.current;
        hitsRef.current
          .filter((h) => h.notes && isOpen(h) && t >= h.time)
          .forEach((h) => {
            const notes = h.notes as number[];
            const wanted = (m: number) =>
              shift === null ? h.chromas.includes(m % 12) : notes.some((n) => n + shift === m);
            const all =
              shift === null
                ? matchesChord(h.chromas, keysHeld)
                : matchesNotes(
                    notes.map((n) => n + shift),
                    keysHeld
                  );
            const presses = keysHeld.filter(wanted).map((m) => keyPresses.current.get(m));
            const fresh = presses.some((p) => p && !p.used && p.time >= h.time - early);
            if (!all || !fresh) return;
            presses.forEach((p) => {
              if (p) p.used = true;
            });
            hitsRef.current = hitsRef.current.map((x) =>
              x.id === h.id ? { ...x, result: 'good' } : x
            );
            record(h.id, 'good');
            if (waitingRef.current === h.id) {
              waitingRef.current = null;
              setWaiting(null);
              if (spotifyOnRef.current && !detachedRef.current) resumeRecordingRef.current();
            }
          });
      }
      // wait: the song stops on the note when it is not played, until it is (no miss). It
      // stops once the note is late (played as late as a good hit, and as late as the playing
      // reaches the game, it was in time), where it is (no jump back), and not when a chord is
      // held already (pressed for it: not kept from the chord before; notes are pressed each)
      if (mode === 'wait' && !listeningRef.current && waitingRef.current === null) {
        const grace = (GOOD_MS + latencyRef.current) * rateRef.current;
        const due = hitsRef.current.find((h) => isOpen(h) && t >= h.time + grace);
        const held = heldNotes.current;
        const holding = !!due && !due.notes && armed.current && matchesChord(due.chromas, held);
        if (due && holding) {
          armed.current = false;
          hitsRef.current = hitsRef.current.map((h) =>
            h.id === due.id ? { ...h, result: 'good' } : h
          );
          record(due.id, 'good');
        } else if (due) {
          waitingRef.current = due.id;
          setWaiting(due.id);
          // (a recording stops too, where it is: Spotify, YouTube; not when the game plays
          // alone)
          if (spotifyOnRef.current && !detachedRef.current) holdRecordingRef.current(t);
        }
      }
      const missed =
        listeningRef.current || mode === 'wait'
          ? []
          : hitsRef.current.filter((h) => isOpen(h) && t > h.time + GOOD_MS * rateRef.current);
      missed.forEach((h) => record(h.id, 'miss'));
      if (missed.length && mode === 'slowDown') {
        setPlayRateRef.current(Math.max(MIN_RATE, rateRef.current * SLOW_DOWN ** missed.length));
      }

      // the song ends after its last chord and its last note
      const last = hitsRef.current[hitsRef.current.length - 1];
      const lastNote = partEventsRef.current[partEventsRef.current.length - 1];
      const end = Math.max(
        last ? last.time + last.length * beatMs : 0,
        lastNote ? lastNote.time + lastNote.duration : 0
      );
      if (last && t > end) {
        setPhase('done');
        if (spotifyOnRef.current) {
          window.app.spotify.pause().catch(() => {});
          if (rateSupported.current) window.app.spotify.rate(1).catch(() => {});
        }
        // played in time with the recording: chords played late mean it is later than thought
        const offset = medianOffset(hitOffsets.current);
        if (
          spotifyOnRef.current &&
          !listeningRef.current &&
          offset !== null &&
          Math.abs(offset) >= 30
        ) {
          setSyncAdjust(Math.round(offset));
          pendingAdjust.current = Math.round(offset);
        }
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [phase, beatMs, beatsPerBar, record, onMiss, sound]);

  // listening with Spotify: Space taps the chord changes
  useEffect(() => {
    if (phase !== 'playing' || !listening || !spotifyOn) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === ' ') {
        event.preventDefault();
        listenTap();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, listening, spotifyOn, listenTap]);

  // Esc stops the song, M shows the volumes and the parts, Space starts again (with a
  // count-in), - and + slow down and speed up
  useEffect(() => {
    if (phase !== 'playing') return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') stop();
      const typing =
        event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement;
      if (!typing && !event.repeat && !listeningRef.current) {
        if (event.key === ' ') {
          event.preventDefault();
          practiceKeys.current.restart();
        }
        if (event.key === '-' || event.key === '_') practiceKeys.current.changeSpeed(-5);
        if (event.key === '+' || event.key === '=') practiceKeys.current.changeSpeed(5);
      }
      // back and ahead 5 s (held: again and again)
      if (!typing && !listeningRef.current) {
        if (event.key === 'ArrowLeft') practiceKeys.current.skipBy(-SKIP_MS);
        if (event.key === 'ArrowRight') practiceKeys.current.skipBy(SKIP_MS);
      }
      if (event.key.toLowerCase() === 'm' && !event.repeat && !typing) {
        setShowMixer((v) => !v);
      }
      if (event.key.toLowerCase() === 'v' && !event.repeat && !typing) {
        practiceKeys.current.switchView();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, stop]);

  // keys held at the last change: the keys just pressed are the new ones
  const previousNotes = useRef<number[]>([]);

  // a chord is played: the closest chord to play in time is judged
  useEffect(() => {
    const pressed = playedMidiNotes.filter((m) => !previousNotes.current.includes(m));
    previousNotes.current = playedMidiNotes;
    // when each key held was pressed (the ones let go: forgotten)
    [...keyPresses.current.keys()].forEach((m) => {
      if (!playedMidiNotes.includes(m)) keyPresses.current.delete(m);
    });
    const heard = songTime.current - latencyRef.current * rateRef.current;
    pressed.forEach((m) => keyPresses.current.set(m, { time: heard, used: false }));
    // (the keys just pressed played a note: not again for the next one)
    const spendPresses = () =>
      pressed.forEach((m) => {
        const press = keyPresses.current.get(m);
        if (press) press.used = true;
      });
    if (!playedMidiNotes.length) {
      armed.current = true;
      return;
    }
    // syncing with Spotify: any key taps the first chord
    if (calibrating && armed.current) {
      armed.current = false;
      tap();
      return;
    }
    // listening with Spotify: a key taps the chord changes
    if (phase === 'playing' && listeningRef.current && spotifyOnRef.current && armed.current) {
      armed.current = false;
      listenTap();
      return;
    }
    if (phase !== 'playing' || listeningRef.current) return;
    // notes: each new key is played (legato is fine); chords: released between hits
    const playsNotes = hitsRef.current.some((h) => h.notes);
    if (playsNotes ? !pressed.length : !armed.current) return;
    // a note is hit by a key just pressed, the other notes of the hit held
    // (strict octaves: a part's notes where the keyboard shows them, moved by octaves)
    const strictNotes = (h: Hit) => {
      const shift = strictShiftRef.current;
      return shift !== null && h.notes ? h.notes.map((m) => m + shift) : null;
    };
    const matches = (h: Hit) => {
      const strict = strictNotes(h);
      if (strict) {
        return matchesNotes(strict, playedMidiNotes) && pressed.some((m) => strict.includes(m));
      }
      return (
        matchesChord(h.chromas, playedMidiNotes) &&
        (!h.notes || pressed.some((m) => h.chromas.includes(m % 12)))
      );
    };

    // waiting on a note: playing it starts the song again
    if (waitingRef.current !== null) {
      const waitedHit = hitsRef.current.find((h) => h.id === waitingRef.current);
      if (waitedHit && matches(waitedHit)) {
        armed.current = false;
        spendPresses();
        waitingRef.current = null;
        setWaiting(null);
        lastReal.current = performance.now();
        // a recording goes on from the note (not when the game plays alone)
        if (spotifyOnRef.current && !detachedRef.current) resumeRecordingRef.current();
        // marked at once: the next frame must not see it as still open (and wait again)
        hitsRef.current = hitsRef.current.map((h) =>
          h.id === waitedHit.id ? { ...h, result: 'good' } : h
        );
        record(waitedHit.id, 'good');
      }
      return;
    }

    // the playing reaches the game late: judged as played that much earlier
    const t = songTime.current - latencyRef.current * rateRef.current;
    const window = GOOD_MS * rateRef.current;
    // the first one still open that the keys play (the same note again and again: the one
    // due, not the next one)
    const target = hitsRef.current
      .filter((h) => isOpen(h) && Math.abs(h.time - t) <= window && matches(h))
      .sort((a, b) => a.time - b.time)[0];
    if (!target) return;

    // judged in real time
    const offset = (t - target.time) / rateRef.current;
    const result = judge(offset);
    if (result) {
      hitOffsets.current.push(offset);
      armed.current = false;
      spendPresses();
      // every 4 hits in a row (6 after slowing down): back up to speed, or faster when speeding up
      const recording = spotifyOnRef.current;
      const slowsDown =
        missMode(onMiss, recording, rateSupported.current, gamePlaysSlowerRef.current) ===
        'slowDown';
      if ((comboRef.current + 1) % 4 === 0) {
        // back up to the speed asked (a recording is not sped up beyond it)
        const max = gameSettings.speedUp && !recording ? MAX_RATE : baseRateRef.current;
        if (rateRef.current < max && (slowsDown || (gameSettings.speedUp && !recording))) {
          setPlayRateRef.current(Math.min(max, rateRef.current * SPEED_UP));
        }
      }
      hitsRef.current = hitsRef.current.map((h) => (h.id === target.id ? { ...h, result } : h));
      record(target.id, result);
    }
  }, [playedMidiNotes, phase, record, onMiss, gameSettings.speedUp, calibrating, tap, listenTap]);

  const waitingHit = waiting !== null ? hits.find((h) => h.id === waiting) : undefined;
  // the note to play: the one waited on, or the next one
  const nextHit = waitingHit ?? hits.find(isOpen) ?? hits[hits.length - 1];
  const beat = Math.floor(now / beatMs);
  // a bar is counted before the first chord (and before a section jumped to)
  const countBeat = beat - Math.round(countInFrom.current / beatMs);
  const countIn =
    phase === 'playing' && countBeat >= 0 && countBeat < beatsPerBar
      ? beatsPerBar - countBeat
      : null;

  const stats = useMemo(
    () => ({
      perfect: hits.filter((h) => h.result === 'perfect').length,
      good: hits.filter((h) => h.result === 'good').length,
      miss: hits.filter((h) => h.result === 'miss').length,
    }),
    [hits]
  );
  // practice loop: the sections start again after a short break (5% faster after a loop
  // with no miss, up to the real speed)
  useEffect(() => {
    if (phase !== 'done' || !practiceLoop || listeningRef.current) return undefined;
    const clean = stats.miss === 0;
    const timeout = setTimeout(() => {
      const nextSpeed = practiceRamp && clean ? Math.min(100, askedSpeed + 5) : askedSpeed;
      start(round, { speed: Math.max(askedSpeed, nextSpeed), loop: loop + 1 });
    }, 1500);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, practiceLoop]);

  // of the chords judged (not the ones skipped by joining in the middle)
  const judged = stats.perfect + stats.good + stats.miss;
  const accuracy = judged ? Math.round(((stats.perfect + stats.good * 0.5) / judged) * 100) : 0;

  // notes are shorter than chords: the lane is zoomed in
  const playsNotes = hits.some((h) => h.notes);
  const beatWidth = playsNotes ? BEAT_WIDTH * 2 : BEAT_WIDTH;
  // hits visible on the lane: from a beat behind the line to the end of the lane
  const visible = hits.filter((h) => {
    const beats = (h.time - now) / beatMs;
    return beats > -1.5 && beats < (100 - HIT_LINE) / beatWidth;
  });

  // pick a song to play, or play random songs
  const isWholeSong = range.first === 0 && range.last === round.sections.length - 1;
  const barsLabel =
    bars &&
    (bars.from === bars.to ? `Bar ${bars.from + 1}` : `Bars ${bars.from + 1}-${bars.to + 1}`);
  const sectionLabel =
    barsLabel ||
    (isWholeSong
      ? 'Whole song'
      : [
          round.sections[range.first]?.name,
          range.last !== range.first && round.sections[range.last]?.name,
        ]
          .filter(Boolean)
          .join(' to '));

  // practice: choose the sections and the speed (like a guitar game practice mode)
  const changePractice = (first: number, last: number, nextSpeed: number) => {
    const from = Math.min(first, last);
    const to = Math.max(first, last);
    setRange({ first: from, last: to });
    setBars(null);
    setSpeed(nextSpeed);
    setHits(makeHits(round, runWindow(round, from, to, null), nextSpeed));
  };
  // the recording cannot change speed (Spotify)
  // (Spotify has no speed; YouTube can, through the extension)
  const noRecordingSpeed =
    spotifyOn && (!spotifyLink?.uri.startsWith('youtube:') || rateSupported.current === false);
  const speedLocked = noRecordingSpeed && !gamePlaysSlower;
  /**
   * Practice: slower or faster (5% steps). While playing, the song goes on at that speed
   * (slowed down by misses: from that speed); else the next run plays at it
   */
  const setAskedSpeed = (value: number) => {
    if (speedLocked) return;
    // (Spotify: slower only, the game playing the song)
    const next = Math.min(noRecordingSpeed ? 100 : 150, Math.max(25, value));
    updateSetting('rhythmGame.practiceSpeed', next);
    if (phase !== 'playing') {
      changePractice(range.first, range.last, next);
      return;
    }
    const base = next / speed;
    // (slowed down by misses: as much slower than the new speed)
    const nextRate = Math.min(base, (rateRef.current / baseRateRef.current) * base);
    baseRateRef.current = base;
    setBaseRate(base);
    setPlayRate(nextRate);
  };
  const changeSpeed = (delta: number) => setAskedSpeed(askedSpeed + delta);
  // (read by the keys)
  practiceKeys.current = {
    restart: () => start(round),
    changeSpeed,
    // eslint-disable-next-line no-use-before-define
    skipBy: (ms: number) => skipBy(ms),
    switchView: () =>
      updateSetting('rhythmGame.view', gameSettings.view === 'highway' ? 'lane' : 'highway'),
  };

  /** Practice: bars of the sections picked (null: the whole sections) */
  const changeBars = (next: BarRange | null) => {
    setBars(next);
    setHits(makeHits(round, runWindow(round, range.first, range.last, next), speed));
  };
  // the bars of the sections picked (to pick some of them)
  const rangeWindow = getBeatRange(round, range.first, range.last);
  const rangeBars = {
    from: Math.floor(rangeWindow.fromBeat / round.beatsPerBar),
    to:
      Math.ceil(
        (Number.isFinite(rangeWindow.toBeat)
          ? rangeWindow.toBeat
          : (round.rhythm.leadIn ?? 0) +
            round.chords.reduce((sum, chord) => sum + (chord.beats ?? round.beatsPerBar), 0)) /
          round.beatsPerBar
      ) - 1,
  };
  // practice: each section with its length in bars
  const sectionBars = useMemo(
    () =>
      round.sections.map((section, index) => {
        const end = round.sections[index + 1]?.start ?? round.chords.length;
        const beats = round.chords
          .slice(section.start, end)
          .reduce((sum, chord) => sum + (chord.beats ?? round.beatsPerBar), 0);
        return {
          name: section.name,
          bars: Math.max(1, Math.round(beats / round.beatsPerBar)),
        };
      }),
    [round]
  );

  // switching to the whole song keeps the practice choice for coming back
  const savedPractice = useRef<{
    round: Round;
    first: number;
    last: number;
  } | null>(null);
  const changePracticing = (next: boolean) => {
    setPracticing(next);
    if (next) {
      const kept = savedPractice.current?.round === round ? savedPractice.current : null;
      changePractice(kept?.first ?? 0, kept?.last ?? round.sections.length - 1, savedSpeed);
    } else {
      savedPractice.current = { round, first: range.first, last: range.last };
      changePractice(0, round.sections.length - 1, 100);
    }
  };

  const practice = (
    <PracticePanel
      practicing={practicing}
      onPracticingChange={changePracticing}
      sections={sectionBars}
      first={range.first}
      last={range.last}
      onRangeChange={(first, last) => changePractice(first, last, askedSpeed)}
      speed={askedSpeed}
      onSpeedChange={setAskedSpeed}
      loop={!!gameSettings.practiceLoop}
      onLoopChange={(value) => updateSetting('rhythmGame.practiceLoop', value)}
      ramp={practiceRamp}
      onRampChange={(value) => updateSetting('rhythmGame.practiceRamp', value)}
      barRange={rangeBars}
      bars={bars}
      onBarsChange={changeBars}
      speedLocked={speedLocked}
    />
  );

  // the parts of the song heard (Songsterr songs), switched on and off with a click
  const enabledParts = songParts.split(',');
  /** a part heard or not (the setting keeps the main parts heard, the others switched off) */
  const setHeard = (id: string, on: boolean) => {
    const rest = partSetting.filter((k) => k !== id && k !== `!${id}`);
    if (ALL_PARTS.includes(id)) updateSetting('rhythmGame.songParts', on ? [...rest, id] : rest);
    else updateSetting('rhythmGame.songParts', on ? rest : [...rest, `!${id}`]);
  };
  const partToggles = round.parts.length > 0 && (
    <div className={cx('parts')} role="group" aria-label="Parts heard">
      <span className={cx('partsLabel')}>Hear</span>
      {round.parts.map((part) => {
        const id = partKey(part);
        const on = enabledParts.includes(id);
        return (
          <button
            key={id}
            type="button"
            className={cx('part', { 'part--on': on })}
            aria-pressed={on}
            title={part.name}
            onClick={() => setHeard(id, !on)}
          >
            {partName(part)}
          </button>
        );
      })}
    </div>
  );

  // what the player plays: the chords, or a part of the song (like picking guitar or bass)
  const noteParts = notePartsOf(round);
  const guessed = chordsGuessed(round);
  const playable: PlayPart[] = [
    ...(guessedChordsOn || !guessed || !noteParts.length ? ['chords'] : []),
    ...noteParts.map(partKey),
  ];
  const playName = (id: PlayPart) => {
    const part = round.parts.find((p) => partKey(p) === id);
    return part ? partName(part) : 'Chords';
  };
  const playingPart = playable.includes(playPart) ? playPart : playable[0];
  const guessedNotice = guessed && playingPart === 'chords' && (
    <span
      className={cx('tag', 'tag--warn')}
      title="This tab has no chord names: the chords were guessed from the notes of the rhythm guitar and bass, and may not fit the song. Play a part of the song instead, or turn guessed chords off in the settings."
    >
      chords guessed from the notes
    </span>
  );
  const partPicker = playable.length > 1 && (
    <div className={cx('parts')} role="group" aria-label="Part you play">
      <span className={cx('partsLabel')}>You play</span>
      {playable.map((part) => (
        <button
          key={part}
          type="button"
          className={cx('part', 'part--choice', {
            'part--on': part === playingPart,
          })}
          aria-pressed={part === playingPart}
          title={
            part === 'chords'
              ? 'Play the chords of the song'
              : `Play the notes of the ${playName(part).toLowerCase()}`
          }
          onClick={() => updateSetting('rhythmGame.playPart', part)}
        >
          {playName(part)}
        </button>
      ))}
      {guessedNotice}
    </div>
  );

  // the instrument of a part, to pick under its volume bar
  const instrumentPicker = (channel: Channel) => ({
    instrument: (gameSettings.instruments as Record<string, string> | undefined)?.[channel] ?? '',
    instruments: INSTRUMENT_CHOICES,
  });

  // volume bars: the chords, the parts of the song it has, the click
  const mixer = (
    <Mixer
      channels={[
        // everything the game plays (not Spotify: its own volume, last)
        {
          id: 'master',
          label: 'Master',
          value: soundVolume,
          apart: true,
          muted: masterMuted,
        },
        {
          id: 'chords',
          label: 'Chords',
          value: volumes.chords,
          muted: !isHeard('chords'),
          playable: playable.includes('chords'),
          playing: playingPart === 'chords',
          ...instrumentPicker('chords'),
        },
        // every instrument of the song
        ...round.parts.map((part) => {
          const id = partKey(part);
          return {
            id,
            label: partName(part),
            value: volumes[id] ?? OTHER_VOLUME,
            muted: !enabledParts.includes(id),
            // any instrument of the song can be played: picked here, even while it plays
            playable: playable.includes(id),
            playing: playingPart === id,
            ...instrumentPicker(id as Channel),
          };
        }),
        {
          id: 'click',
          label: 'Click',
          value: volumes.click,
          muted: !isHeard('click'),
        },
        {
          id: 'countIn',
          label: 'Count-in',
          value: volumes.countIn,
          muted: !isHeard('countIn'),
        },
        // your keyboard, heard with Play My Notes
        ...(settings.general.playNotes
          ? [
              {
                id: 'keyboard',
                label: 'You',
                value: volumes.keyboard ?? 100,
                muted: !isHeard('keyboard'),
                instrument: settings.general.keyboardInstrument ?? '',
                instruments: INSTRUMENT_CHOICES,
              },
            ]
          : []),
        ...(spotifyOn
          ? [
              {
                id: 'spotify',
                label: 'Spotify',
                value: spotifyVolume ?? 50,
                muted: spotifyVolume === 0,
              },
            ]
          : []),
      ]}
      onInput={(id, value) => {
        if (id === 'master') synth.setVolume(value / 100);
        else if (id !== 'spotify') synth.setChannelVolume(id as Channel, value / 100);
      }}
      onMute={(id, mute) => {
        // Spotify: its volume down to nothing, then back to what it was
        if (id === 'spotify') {
          const next = mute ? 0 : spotifyUnmuted.current || 50;
          if (mute && spotifyVolume) spotifyUnmuted.current = spotifyVolume;
          setSpotifyVolume(next);
          window.app.spotify.volume(next).catch((e) => showSpotifyError(e));
          return;
        }
        setHeard(id, !mute);
      }}
      onPlay={(id) => updateSetting('rhythmGame.playPart', id)}
      onInstrument={(id, instrument) => {
        if (id === 'keyboard') updateSetting('general.keyboardInstrument', instrument);
        else
          updateSetting('rhythmGame.instruments', {
            ...gameSettings.instruments,
            [id]: instrument,
          });
      }}
      onChange={(id, value) => {
        if (id === 'master') {
          updateSetting('general.soundVolume', value);
          return;
        }
        if (id === 'spotify') {
          setSpotifyVolume(value);
          window.app.spotify.volume(value).catch((e) => showSpotifyError(e));
          return;
        }
        updateSetting('rhythmGame.volumes', { ...volumes, [id]: value });
        // turned up: heard again
        if (value > 0 && round.parts.some((p) => partKey(p) === id) && !enabledParts.includes(id)) {
          setHeard(id, true);
        }
      }}
    />
  );

  // arrows: the sync with Spotify of a synced song, or how late the playing arrives
  const arrows = (kind: 'sync' | 'latency', compact = false) => {
    const sync = kind === 'sync';
    // not playing: the saved sync is moved (shown as it is)
    const value = sync ? Math.round(shownShift) : latencyMs;
    return (
      <div
        className={cx('latency', { 'latency--compact': compact })}
        role="group"
        aria-label={sync ? 'Spotify sync' : 'Latency'}
      >
        <span className={cx('latencyLabel')}>
          {(sync && phase !== 'playing' && 'First chord at') || (sync && 'Sync') || 'Latency'}
        </span>
        <button
          type="button"
          className={cx('arrow')}
          aria-label={sync ? 'Song earlier' : 'Less latency'}
          title={sync ? 'The chords come earlier (20 ms)' : 'Less latency (10 ms)'}
          onClick={() =>
            sync
              ? moveSync(-20)
              : updateSetting('rhythmGame.latencyMs', Math.max(0, latencyMs - 10))
          }
        >
          ◀
        </button>
        <span className={cx('latencyValue')}>
          {sync && phase !== 'playing'
            ? `${((spotifyLink?.firstChordMs ?? 0) / 1000).toFixed(2)} s`
            : `${sync && value > 0 ? '+' : ''}${value} ms`}
        </span>
        <button
          type="button"
          className={cx('arrow')}
          aria-label={sync ? 'Song later' : 'More latency'}
          title={sync ? 'The chords come later (20 ms)' : 'More latency (10 ms)'}
          onClick={() =>
            sync ? moveSync(20) : updateSetting('rhythmGame.latencyMs', latencyMs + 10)
          }
        >
          ▶
        </button>
      </div>
    );
  };

  // the songs, with their covers: one picked, or random songs
  const [libraryOpen, setLibraryOpen] = useState(false);
  const pickedSong = getAllSongs(gameSettings.customSongs ?? []).find((s) => s.id === chosenSong);
  const songPicker = (
    <button
      type="button"
      className={cx('songPicker')}
      onClick={() => setLibraryOpen(true)}
      title="Your songs: pick one, search, remove"
    >
      {pickedSong ? (
        <SongCover song={pickedSong.imported} title={pickedSong.title} small />
      ) : (
        <Icon name="music" />
      )}
      <span className={cx('songPickerName')}>
        {pickedSong ? splitTitle(pickedSong.title).name : 'Random song'}
      </span>
      <small>Songs</small>
    </button>
  );
  const songLibrary = libraryOpen && (
    <SongLibrary
      songs={gameSettings.customSongs ?? []}
      chosen={chosenSong}
      onPick={(id) => {
        updateSetting('rhythmGame.song', id);
        setLibraryOpen(false);
      }}
      onRemove={(id) => {
        updateSetting(
          'rhythmGame.customSongs',
          (gameSettings.customSongs ?? []).filter((song) => song.id !== id)
        );
        if (chosenSong === id) updateSetting('rhythmGame.song', '');
      }}
      onClose={() => setLibraryOpen(false)}
    />
  );

  // the song: its name and artist ("Name by Artist"), or a mystery until the end
  const mystery = phase !== 'done' && gameSettings.showTitle === 'end';
  const [songName, songArtist] = mystery
    ? ['Mystery song', undefined]
    : round.song.title.split(/\s+by\s+/i);
  const art = mystery ? undefined : spotifyLink?.imageUrl ?? seenArt;
  // the cover seen is the linked song's (another song: forgotten)
  useEffect(() => {
    setSeenArt(undefined);
  }, [round.song.id]);

  // every section of the song, in beats from its start (with its intro), then in the time of
  // this run (its hits start at the first section played, after a bar of count-in)
  const sectionBeats = useMemo(() => {
    let position = 0;
    return round.sections.map((section, index) => {
      const end = round.sections[index + 1]?.start ?? round.chords.length;
      const beats =
        (index === 0 ? round.rhythm.leadIn ?? 0 : 0) +
        round.chords
          .slice(section.start, end)
          .reduce((sum, chord) => sum + (chord.beats ?? round.beatsPerBar), 0);
      const item = {
        index,
        name: section.name || `Part ${index + 1}`,
        fromBeat: position,
        toBeat: position + beats,
      };
      position += beats;
      return item;
    });
  }, [round]);
  const songBeats = sectionBeats[sectionBeats.length - 1]?.toBeat || 1;
  const runStartBeat = bars
    ? runWindow(round, range.first, range.last, bars).fromBeat
    : sectionBeats[range.first]?.fromBeat ?? 0;
  const timeline = sectionBeats.map((section) => ({
    ...section,
    from: (beatsPerBar + section.fromBeat - runStartBeat) * beatMs,
    to: (beatsPerBar + section.toBeat - runStartBeat) * beatMs,
  }));
  const currentSection =
    phase === 'playing'
      ? timeline.find((s) => s.index >= range.first && now < s.to) ?? timeline[timeline.length - 1]
      : null;
  // a long rest before the next note or chord (a part that plays nothing for a while)
  const restBeats =
    phase === 'playing' && nextHit && isOpen(nextHit) ? (nextHit.time - now) / beatMs : 0;
  const resting = restBeats > beatsPerBar * 2;

  /**
   * The player: a click on a section goes there (a bar before it), within the sections being
   * played; another section is played from its start
   */
  const goToSection = (index: number) => {
    const section = timeline[index];
    if (!section) return;
    if (phase !== 'playing' || index < range.first || index > range.last) {
      const last = practicing && index <= range.last ? range.last : round.sections.length - 1;
      start(round, { first: index, last });
      return;
    }
    const target = Math.max(0, section.from - beatsPerBar * beatMs);
    countInFrom.current = target;
    // eslint-disable-next-line no-use-before-define
    seekTo(target);
  };

  // where this run ends (song time, ms)
  const runEndMs = timeline[range.last]?.to ?? 0;
  /**
   * The song goes to a time (ms, in this run), with the recording (Spotify, YouTube) when it
   * plays it: not waiting on a note anymore
   */
  const seekTo = (ms: number) => {
    if (phase !== 'playing') return;
    const target = Math.min(Math.max(0, ms), runEndMs);
    const wasWaiting = waitingRef.current !== null;
    waitingRef.current = null;
    setWaiting(null);
    if (spotifyOnRef.current && !detachedRef.current) {
      const position = recordingPositionAt(target);
      // waiting on a note, the recording was paused: it plays again from there
      if (wasWaiting) {
        resumeAt.current = position;
        resumeRecording();
        return;
      }
      // followed right away (Spotify tells where it is a moment later)
      if (spotifyPlayer.current) {
        spotifyPlayer.current = {
          ...spotifyPlayer.current,
          progressMs: position,
          at: performance.now(),
        };
      }
      // (it tells the old place for a moment)
      holdPollUntil.current = Math.max(holdPollUntil.current, performance.now() + 1500);
      window.app.spotify.seek(position).catch((e) => showSpotifyError(e));
      checkRecordingSoon.current(1600);
      return;
    }
    songTime.current = target;
    lastReal.current = performance.now();
  };
  /** Fast-forward or back (ms of the song) */
  const skipBy = (ms: number) => seekTo(songTime.current + ms);
  /** The time in this run (ms) at a beat of the song (from its start) */
  const runMsAt = (songBeat: number) => (beatsPerBar + songBeat - runStartBeat) * beatMs;
  // where the song is (a beat of the song, from its start) and the seek bar being dragged
  const nowBeat = runStartBeat + now / beatMs - beatsPerBar;
  const [seeking, setSeeking] = useState(false);
  const seekBeatAt = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) * songBeats;
  };

  /** Practice markers: the sections from first to last are practiced (again and again) */
  const markPractice = (first: number, last: number) => {
    const from = Math.min(first, last);
    const to = Math.max(first, last);
    setPracticing(true);
    const nextSpeed = practicing ? speed : savedSpeed;
    if (phase === 'playing') start(round, { first: from, last: to, speed: nextSpeed });
    else changePractice(from, to, nextSpeed);
  };
  const clearPractice = () => {
    if (phase === 'playing') {
      setPracticing(false);
      start(round, { first: 0, last: round.sections.length - 1, speed: 100 });
    } else {
      changePracticing(false);
    }
  };

  // dragging over the sections sets the practice markers, a click goes to a section
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  const sectionAt = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const atBeat = ((event.clientX - rect.left) / rect.width) * songBeats;
    const found = sectionBeats.find((s) => atBeat < s.toBeat);
    return (found ?? sectionBeats[sectionBeats.length - 1])?.index ?? 0;
  };
  const runFromBeat = sectionBeats[range.first]?.fromBeat ?? 0;
  const runToBeat = sectionBeats[range.last]?.toBeat ?? songBeats;
  const player = sectionBeats.length > 0 && (
    <div className={cx('player')}>
      {phase === 'playing' && (
        <button
          type="button"
          className={cx('skip')}
          onClick={() => skipBy(-SKIP_MS)}
          title="Back 5 seconds (←)"
          aria-label="Back 5 seconds"
        >
          −5s
        </button>
      )}
      <div className={cx('playerTrack')}>
        <div
          className={cx('timeline', { 'timeline--dragging': !!drag })}
          role="group"
          aria-label="Sections of the song: click to go there, drag to practice them"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            const index = sectionAt(event);
            setDrag({ from: index, to: index });
          }}
          onPointerMove={(event) => {
            if (!drag) return;
            const index = sectionAt(event);
            if (index !== drag.to) setDrag({ ...drag, to: index });
          }}
          onPointerUp={() => {
            if (!drag) return;
            setDrag(null);
            if (drag.from === drag.to) goToSection(drag.from);
            else markPractice(drag.from, drag.to);
          }}
          onPointerCancel={() => setDrag(null)}
        >
          {timeline.map((section) => {
            const width = ((section.toBeat - section.fromBeat) / songBeats) * 100;
            const inRun = section.index >= range.first && section.index <= range.last;
            const done =
              phase === 'playing' && inRun
                ? Math.min(1, Math.max(0, (now - section.from) / (section.to - section.from)))
                : 0;
            const dragged =
              drag &&
              section.index >= Math.min(drag.from, drag.to) &&
              section.index <= Math.max(drag.from, drag.to);
            return (
              <div
                key={section.index}
                className={cx('segment', {
                  'segment--now': section === currentSection,
                  'segment--out': practicing && !inRun && !drag,
                  'segment--marked': practicing && inRun && !drag,
                  'segment--first': practicing && section.index === range.first && !drag,
                  'segment--last': practicing && section.index === range.last && !drag,
                  'segment--drag': dragged,
                })}
                style={{ width: `${width}%` }}
                title={`${section.name}: click to go there, drag over sections to practice them`}
              >
                <div className={cx('segmentFill')} style={{ width: `${done * 100}%` }} />
                {width >= 4 && <span className={cx('segmentName')}>{section.name}</span>}
              </div>
            );
          })}
        </div>
        {phase === 'playing' && (
          <div
            className={cx('seekBar', { 'seekBar--seeking': seeking })}
            role="slider"
            tabIndex={-1}
            aria-label="Where the song is: click or drag to go there"
            aria-valuemin={0}
            aria-valuemax={Math.round(songBeats)}
            aria-valuenow={Math.round(nowBeat)}
            title="Click or drag to go there (← → 5 seconds)"
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              setSeeking(true);
              seekTo(runMsAt(seekBeatAt(event)));
            }}
            onPointerMove={(event) => {
              if (seeking) seekTo(runMsAt(seekBeatAt(event)));
            }}
            onPointerUp={() => setSeeking(false)}
            onPointerCancel={() => setSeeking(false)}
          >
            <div
              className={cx('seekRun')}
              style={{
                left: `${(runFromBeat / songBeats) * 100}%`,
                width: `${((runToBeat - runFromBeat) / songBeats) * 100}%`,
              }}
            />
            <div
              className={cx('seekDone')}
              style={{
                left: `${(runFromBeat / songBeats) * 100}%`,
                width: `${
                  (Math.max(0, Math.min(nowBeat, runToBeat) - runFromBeat) / songBeats) * 100
                }%`,
              }}
            />
            <div
              className={cx('seekHead')}
              style={{ left: `${(Math.min(Math.max(nowBeat, 0), songBeats) / songBeats) * 100}%` }}
            />
          </div>
        )}
      </div>
      {phase === 'playing' && (
        <button
          type="button"
          className={cx('skip')}
          onClick={() => skipBy(SKIP_MS)}
          title="Ahead 5 seconds (→)"
          aria-label="Ahead 5 seconds"
        >
          +5s
        </button>
      )}
      {practicing && (
        <button
          type="button"
          className={cx('playerClear')}
          onClick={clearPractice}
          title="Play the whole song again"
        >
          <Icon name="cross" />
          Whole song
        </button>
      )}
    </div>
  );
  // the chords of the key, with their number: the one to play lit (or told apart when it is
  // not one of them)
  const chordsOfKey = useMemo(() => keyChords(round.keyLabel), [round.keyLabel]);
  const keyTonic = Note.chroma(Chord.get(chordsOfKey[0]?.name ?? '').tonic ?? '') ?? 0;
  const rootOf = (name: string) => Note.chroma(Chord.get(name).tonic ?? '') ?? -1;
  /**
   * Highway: a lane for each note the song plays (a chord: its root; notes: their lowest one),
   * low to high like on the keyboard (chords: from the tonic up), named and numbered by its
   * degree in the key (the notes out of the key too: ♭6...), colored like the degree it is on (or
   * the one below it)
   */
  const keyRoots = chordsOfKey.map((c) => rootOf(c.name));
  const aboveTonic = (chroma: number) => (((chroma - keyTonic) % 12) + 12) % 12;
  const chromaOf = (hit: Hit) =>
    hit.notes?.length ? Math.min(...hit.notes) % 12 : rootOf(hit.chord.tonic ?? hit.name);
  const highwayLanes = useMemo(() => {
    const names = new Map<number, string>();
    // where the notes of each lane are played on the keyboard (MIDI)
    const pitches = new Map<number, number[]>();
    hits.forEach((h) => {
      const chroma = chromaOf(h);
      if (chroma < 0) return;
      if (h.notes?.length)
        pitches.set(chroma, [...(pitches.get(chroma) ?? []), Math.min(...h.notes)]);
      if (names.has(chroma)) return;
      // (a part's notes: the lowest one)
      names.set(chroma, h.notes ? h.chord.notes[0] : h.chord.tonic ?? h.name);
    });
    // notes: low to high like on the keyboard (where they are mostly played); chords: from the
    // tonic up
    const middle = (chroma: number) => {
      const played = [...(pitches.get(chroma) ?? [])].sort((a, b) => a - b);
      return played.length ? played[Math.floor(played.length / 2)] : aboveTonic(chroma);
    };
    return [...names.entries()]
      .sort(([a], [b]) => middle(a) - middle(b) || aboveTonic(a) - aboveTonic(b))
      .map(([chroma, name]) => {
        // the degree it is on, or the one below it
        let degree = 0;
        keyRoots.forEach((root, i) => {
          if (aboveTonic(root) <= aboveTonic(chroma)) degree = i;
        });
        return {
          chroma,
          name,
          number: SCALE_DEGREES[aboveTonic(chroma)],
          outside: !keyRoots.includes(chroma),
          hue: degreeHue(chordsOfKey[degree]?.numeral),
        };
      });
    // (the lanes change with the song, the part played and the key)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hits, keyTonic, chordsOfKey]);
  const laneCount = Math.max(1, highwayLanes.length);
  // the lanes the keys held are on (lit at the bottom)
  const heldChromas = new Set(playedMidiNotes.map((m) => m % 12));
  // the highway is stretched out so that notes played close together are well apart (the
  // closest ones but a few: a fast run does not stretch it all)
  const closeGap = useMemo(() => {
    const gaps = hits
      .map((h) => h.length)
      .filter((beats) => beats > 0)
      .sort((a, b) => a - b);
    return gaps[Math.floor(gaps.length * 0.2)] ?? 1;
  }, [hits]);
  const beatHeight = Math.min(
    MAX_BEAT_HEIGHT,
    Math.max(playsNotes ? BEAT_HEIGHT * 1.6 : BEAT_HEIGHT, HIGHWAY_GAP / closeGap)
  );
  const highwayVisible = hits.filter((h) => {
    const beats = (h.time - now) / beatMs;
    return beats + h.length > -1 && beats < (100 - HIGHWAY_LINE) / beatHeight;
  });
  // the fingers of a part's notes, worked out with the notes coming after them
  // (both hands: each its own notes, the low ones for the left)
  const partFingers = useMemo(
    () => getHandsFingering(hits, getFingeringHands(gameSettings.fingering)),
    [hits, gameSettings.fingering]
  );
  // a part's notes falling onto the keys of the keyboard under the highway (its notes where
  // the song plays them): the keyboard stays where most of them are
  // (whatever the keyboard octave: the keyboard shows all the part's notes where they are, so
  // none is moved to another octave; − and + move them all by octaves)
  const keyLanes = gameSettings.view === 'highway' && !!gameSettings.learningMode && playsNotes;
  // (a keyboard staying in one octave: the song's own octaves; on the highway's keys: as shown)
  strictShiftRef.current = gameSettings.strictOctaves
    ? 12 *
      (gameSettings.keyboardOctave === 'fixed' && !keyLanes
        ? 0
        : gameSettings.keyboardTranspose ?? 0)
    : null;
  const keysTranspose = 12 * (gameSettings.keyboardTranspose ?? 0);
  // the keys shown: the player's keyboard (each key on screen the one under the hand), or the
  // octaves the part's notes are in (most: the ones with the most notes); the notes outside them
  // moved into them by octaves
  const keyboardKeys = gameSettings.keyboardKeys ?? 'fit';
  const keysRange = useMemo(() => {
    if (keyboardKeys !== 'fit') {
      const [low, high] = KEYBOARD_SIZES[keyboardKeys];
      return { low, high };
    }
    const notes = hits.flatMap((h) => h.notes ?? []).map((m) => m + keysTranspose);
    if (!notes.length) return { low: 60, high: 83 };
    const lowest = Math.floor(Math.min(...notes) / 12);
    const highest = Math.floor(Math.max(...notes) / 12);
    const octaves = Math.max(2, Math.min(MAX_KEY_OCTAVES, highest - lowest + 1));
    let firstOctave = lowest;
    let most = -1;
    for (let from = lowest; from <= Math.max(lowest, highest - octaves + 1); from += 1) {
      const count = notes.filter((m) => m >= 12 * from && m < 12 * (from + octaves)).length;
      if (count > most) {
        most = count;
        firstOctave = from;
      }
    }
    return { low: 12 * firstOctave, high: 12 * (firstOctave + octaves) - 1 };
  }, [hits, keysTranspose, keyboardKeys]);
  const keysLow = keysRange.low;
  const keysHigh = keysRange.high;
  // white keys from C0, to each white key (a black key: the white key below it)
  const whiteOf = (m: number) =>
    7 * Math.floor(m / 12) + (WHITE_INDEX[m % 12] ?? WHITE_INDEX[(m % 12) - 1]);
  const whiteKeys = whiteOf(keysHigh) - whiteOf(keysLow) + 1;
  /** Where a note falls on the keyboard (percent): its key, moved into the keyboard by octaves */
  const keyPlace = (midi: number) => {
    let m = midi + keysTranspose;
    while (m < keysLow) m += 12;
    while (m > keysHigh) m -= 12;
    const chroma = m % 12;
    const white = 100 / whiteKeys;
    const index = whiteOf(m) - whiteOf(keysLow);
    if (WHITE_INDEX[chroma] !== undefined) {
      return { left: index * white, width: white, black: false };
    }
    // a black key: about on the line between the white keys around it (like the keyboard draws
    // it: 24 of 41 wide, moved a little toward the outside of its group)
    const center = (index + 1 + BLACK_SHIFT[chroma]) * white;
    return { left: center - white * BLACK_WIDTH, width: white * 2 * BLACK_WIDTH, black: true };
  };
  const heldKeys = new Set(playedMidiNotes.map((m) => keyPlace(m - keysTranspose).left));
  // the note just played right (before the next one): its keys still held are not wrong
  const beforeNext = hits[hits.indexOf(nextHit) - 1];
  const justPlayed =
    beforeNext && (beforeNext.result === 'perfect' || beforeNext.result === 'good')
      ? { chromas: beforeNext.chromas, notes: beforeNext.notes }
      : undefined;
  // the next note's lane: its keys colored like it
  const nextLane = nextHit && highwayLanes.find((lane) => lane.chroma === chromaOf(nextHit));
  // the keyboard of the learning mode (in the highway view: under the road, as wide)
  const keyboard = gameSettings.learningMode && nextHit && phase === 'playing' && (
    <ChordQuizKeyboard
      target={nextHit.chord}
      keyName={key}
      sharps={accidentals === 'sharp'}
      fingering={gameSettings.fingering}
      playedMidiNotes={playedMidiNotes}
      sustainedMidiNotes={sustainedMidiNotes}
      strictOctaves={!!gameSettings.strictOctaves}
      midiNotes={midiNotes}
      fixedOctaveShift={
        gameSettings.keyboardOctave === 'fixed' ? gameSettings.keyboardOctaveShift ?? 0 : undefined
      }
      // notes of a part: where the song plays them (moved by octaves); on the highway's keys,
      // whatever the keyboard octave (staying in one: − and + move it)
      songNotes={
        (gameSettings.keyboardOctave ?? 'song') === 'song' || keyLanes ? nextHit.notes : undefined
      }
      transpose={keysTranspose / 12}
      onTransposeChange={(octaves) => updateSetting('rhythmGame.keyboardTranspose', octaves)}
      songFingers={partFingers.get(nextHit.id)}
      targetColor={nextLane && `hsl(${nextLane.hue} 62% 44%)`}
      songRange={keyLanes ? keysRange : undefined}
      partNotes={nextHit.notes}
      justPlayed={justPlayed}
      onFixedOctaveShiftChange={(shift) => updateSetting('rhythmGame.keyboardOctaveShift', shift)}
    />
  );
  const highway = (
    <div className={cx('highway', { 'highway--wide': keyLanes && whiteKeys > 28 })}>
      <div className={cx('highwayRoad')}>
        {/* the keys of the keyboard below (a part's notes fall onto them) */}
        {keyLanes &&
          Array.from({ length: keysHigh - keysLow + 1 }, (_, i) => keysLow + i).map((midi) => {
            const place = keyPlace(midi - keysTranspose);
            return (
              <div
                key={midi}
                className={cx('highwayKey', {
                  'highwayKey--black': place.black,
                  'highwayKey--held': heldKeys.has(place.left),
                  // (a C: an octave starts there)
                  'highwayKey--octave': midi % 12 === 0 && midi !== keysLow,
                })}
                style={{ left: `${place.left}%`, width: `${place.width}%` }}
              />
            );
          })}
        {!keyLanes &&
          highwayLanes.map((lane) => (
            <div
              key={lane.chroma}
              className={cx('highwayLane', {
                'highwayLane--held': heldChromas.has(lane.chroma),
              })}
              style={{ '--hue': lane.hue } as React.CSSProperties}
            />
          ))}
        {/* a line on each bar */}
        {Array.from(
          { length: Math.ceil((100 - HIGHWAY_LINE) / beatHeight / beatsPerBar) + 2 },
          (_, i) => {
            const bar = Math.floor(now / beatMs / beatsPerBar) + i;
            const bottom =
              HIGHWAY_LINE + ((bar * beatsPerBar * beatMs - now) / beatMs) * beatHeight;
            return bottom > -5 && bottom < 105 ? (
              <div key={bar} className={cx('highwayBar')} style={{ bottom: `${bottom}%` }} />
            ) : null;
          }
        )}
        <div className={cx('highwayLine')} style={{ bottom: `${HIGHWAY_LINE}%` }} />
        {highwayVisible.flatMap((h) => {
          const index = highwayLanes.findIndex((lane) => lane.chroma === chromaOf(h));
          const lane = highwayLanes[index];
          if (!lane) return [];
          // named when it changes (the same note again and again: once)
          const before = hits[hits.findIndex((x) => x.id === h.id) - 1];
          const named = !before || before.name !== h.name;
          const next = h === nextHit && isOpen(h);
          // (the next note waited on stays on the line, not past it)
          const rise = ((h.time - now) / beatMs) * beatHeight;
          const bottom = `calc(${HIGHWAY_LINE + (next ? Math.max(0, rise) : rise)}% - 0.7em)`;
          const height = `calc(${Math.max(0, h.length * beatHeight - 0.6)}% + 0.7em)`;
          // on the keys: a gem on each key of the notes, colored like the degree of each
          if (keyLanes && h.notes) {
            return h.notes.map((midi) => {
              const place = keyPlace(midi);
              const noteLane = highwayLanes.find((l) => l.chroma === midi % 12) ?? lane;
              return (
                <div
                  key={`${h.id}-${midi}`}
                  className={cx('gem', 'gem--key', h.result && `gem--${h.result}`, {
                    'gem--next': next,
                    'gem--skipped': h.skipped,
                    'gem--outside': noteLane.outside,
                  })}
                  style={
                    {
                      left: `${place.left}%`,
                      width: `${place.width}%`,
                      bottom,
                      height,
                      '--hue': noteLane.hue,
                    } as React.CSSProperties
                  }
                >
                  {named && (
                    <span className={cx('gemName')}>
                      {formatSharpsFlats(
                        Midi.midiToNoteName(midi, {
                          sharps: accidentals === 'sharp',
                          pitchClass: true,
                        })
                      )}
                    </span>
                  )}
                </div>
              );
            });
          }
          return [
            <div
              key={h.id}
              className={cx('gem', h.result && `gem--${h.result}`, {
                'gem--next': next,
                'gem--skipped': h.skipped,
                'gem--outside': lane.outside,
              })}
              style={
                {
                  left: `${(index / laneCount) * 100}%`,
                  width: `${100 / laneCount}%`,
                  // its head centered on the line when it is to be played
                  bottom,
                  height,
                  '--hue': lane.hue,
                } as React.CSSProperties
              }
            >
              {named && <span className={cx('gemName')}>{formatSharpsFlats(h.name)}</span>}
            </div>,
          ];
        })}
      </div>
      {/* the targets: a lane each, lit by the keys held (on the keys: the keyboard is) */}
      <div className={cx('highwayTargets', { 'highwayTargets--hidden': keyLanes })}>
        {highwayLanes.map((lane) => (
          <span
            key={lane.chroma}
            className={cx('highwayTarget', {
              'highwayTarget--held': heldChromas.has(lane.chroma),
              'highwayTarget--outside': lane.outside,
            })}
            style={{ '--hue': lane.hue } as React.CSSProperties}
          >
            <strong>{lane.number}</strong>
            {formatSharpsFlats(lane.name)}
          </span>
        ))}
      </div>
      {keyboard && <div className={cx('highwayKeys')}>{keyboard}</div>}
    </div>
  );
  const keyStrip = (hit: Hit) => {
    // notes of a part: the degrees of the key they are on (by their root), the others apart
    if (hit.notes) {
      const roots = chordsOfKey.map((c) => rootOf(c.name));
      const outside = hit.chromas.filter((pc) => !roots.includes(pc));
      return (
        <div className={cx('keyStrip')} aria-label={`Degrees of ${round.keyLabel}`}>
          <span className={cx('keyStripKey')}>{round.keyLabel}</span>
          {chordsOfKey.map((c, i) => (
            <span
              key={c.numeral}
              className={cx('keyChord', {
                'keyChord--on': hit.chromas.includes(roots[i]),
              })}
              style={{ '--hue': degreeHue(c.numeral) } as React.CSSProperties}
            >
              <span className={cx('keyChordNumeral')}>{i + 1}</span>
              {formatSharpsFlats(Chord.get(c.name).tonic ?? '')}
            </span>
          ))}
          {outside.map((pc) => (
            <span
              key={pc}
              className={cx('keyChord', 'keyChord--on', 'keyChord--outside')}
              style={{ '--hue': 215 } as React.CSSProperties}
              title="Not a note of the key"
            >
              <span className={cx('keyChordNumeral')}>
                {SCALE_DEGREES[(pc - keyTonic + 12) % 12]}
              </span>
              {formatSharpsFlats(hit.chord.notes.find((n) => Note.chroma(n) === pc) ?? '')}
            </span>
          ))}
        </div>
      );
    }
    const inKey = chordsOfKey.some((c) => sameChord(c.name, hit.name));
    return (
      <div className={cx('keyStrip')} aria-label={`Chords of ${round.keyLabel}`}>
        <span className={cx('keyStripKey')}>{round.keyLabel}</span>
        {chordsOfKey.map((c) => (
          <span
            key={c.numeral}
            className={cx('keyChord', {
              'keyChord--on': sameChord(c.name, hit.name),
            })}
            style={{ '--hue': degreeHue(c.numeral) } as React.CSSProperties}
          >
            <span className={cx('keyChordNumeral')}>{c.numeral}</span>
            {formatSharpsFlats(c.name.replace('dim', '°'))}
          </span>
        ))}
        {!inKey && (
          <span
            className={cx('keyChord', 'keyChord--on', 'keyChord--outside')}
            style={{ '--hue': degreeHue(hit.numeral) } as React.CSSProperties}
            title="Not one of the chords of the key"
          >
            <span className={cx('keyChordNumeral')}>{hit.numeral || '?'}</span>
            {formatSharpsFlats(hit.name)}
          </span>
        )}
      </div>
    );
  };

  // the chord after the next one (to see it coming)
  const thenHit = nextHit && hits.find((h) => h.time > nextHit.time && h.chordStart);

  // Spotify while playing: one line, the most useful thing to know
  const status = (() => {
    if (!spotifyOn) return null;
    if (spotifyMessage) return { tone: 'warn', text: spotifyMessage };
    return { tone: 'ok', text: `Playing with ${recordingSource}` };
  })();

  // a grade at the end, like in arcade games
  const grade =
    (accuracy >= 95 && 'S') ||
    (accuracy >= 85 && 'A') ||
    (accuracy >= 70 && 'B') ||
    (accuracy >= 50 && 'C') ||
    'D';

  // the start screen: practice, the parts and sound, the timing
  const [tab, setTab] = useState<'practice' | 'sound' | 'timing'>('practice');
  const [showSync, setShowSync] = useState(false);

  // keys on the start and end screens: Enter starts, L listens, N plays the next song
  const keyActions = useRef({
    start: () => {},
    listen: () => {},
    next: () => {},
  });
  keyActions.current = {
    start: () => start(),
    listen: () => start(round, { listen: true }),
    next: () => !chosenSong && start(newRound(round.song.id)),
  };
  useEffect(() => {
    if (phase === 'playing' || calibrating) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, select, textarea, button, [role="slider"], [role="listbox"]')) {
        return;
      }
      const action = {
        Enter: 'start',
        l: 'listen',
        L: 'listen',
        n: 'next',
        N: 'next',
      }[event.key] as keyof typeof keyActions.current | undefined;
      if (!action) return;
      event.preventDefault();
      keyActions.current[action]();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, calibrating]);

  const cover = (size: 'sm' | 'lg') =>
    art ? (
      <img className={cx('cover', `cover--${size}`)} src={art} alt="" />
    ) : (
      <div className={cx('cover', `cover--${size}`, 'cover--none')}>
        <Icon name="music" />
      </div>
    );

  // what Spotify plays, asked with a click, to play along with it (in the song card)
  const nowPlayingBox = spotifySync && (
    <div className={cx('nowPlaying', { 'nowPlaying--found': !!nowPlaying })}>
      {nowPlaying?.imageUrl ? (
        <img className={cx('nowPlayingCover')} src={nowPlaying.imageUrl} alt="" />
      ) : (
        <span className={cx('nowPlayingIcon')}>
          <Icon name="music" />
        </span>
      )}
      <span className={cx('nowPlayingText')}>
        <small>
          {nowPlaying
            ? `${nowPaused ? 'Paused' : 'Now'} on ${sourceName(nowPlaying.uri)}`
            : 'Spotify · YouTube'}
        </small>
        {nowPlaying ? (
          <span>
            <strong>{nowPlaying.name}</strong> · {nowPlaying.artists}
          </span>
        ) : (
          <span>
            {nowPlaying === null
              ? 'Nothing is playing there right now'
              : 'Playing a song on Spotify, or a YouTube video in your browser? Play along with it'}
          </span>
        )}
      </span>
      {nowPlaying && (
        <button
          type="button"
          className={cx('spotifyButton')}
          onClick={playAlong}
          title={
            nowPlayingSong
              ? `Play it from where ${sourceName(nowPlaying.uri)} is${
                  gameSettings.syncBeforeJoin ? ' (synced quickly first, the first time)' : ''
                }`
              : `Import it from Songsterr, then play it from where ${sourceName(nowPlaying.uri)} is`
          }
        >
          <Icon name="music" />
          {nowPlayingSong ? 'Play along' : 'Import & play along'}
        </button>
      )}
      <button
        type="button"
        className={cx('spotifyButton', {
          'spotifyButton--quiet': !!nowPlaying,
        })}
        onClick={checkSpotify}
        disabled={checking}
        title="Ask Spotify and your browser what they play now"
      >
        <Icon name="refresh" />
        {checking && 'Checking...'}
        {!checking && (nowPlaying ? 'Check again' : 'Check what plays')}
      </button>
      {nowPlayers.length > 1 && (
        <div
          className={cx('nowPlayingChoices')}
          role="radiogroup"
          aria-label="What to play along with"
        >
          {nowPlayers.map((choice) => (
            <button
              key={choice.track.uri}
              type="button"
              role="radio"
              aria-checked={choice.track.uri === nowPlaying?.uri}
              className={cx('nowPlayingChoice', {
                'nowPlayingChoice--on': choice.track.uri === nowPlaying?.uri,
              })}
              onClick={() => pickNowPlaying(choice)}
              title={`${choice.isPlaying ? 'Playing' : 'Paused'} on ${sourceName(
                choice.track.uri
              )}`}
            >
              <span
                className={cx('followDot', {
                  'followDot--off': !choice.isPlaying,
                })}
              />
              <small>{sourceName(choice.track.uri)}</small>
              <strong>{choice.track.name}</strong>
              <span>{choice.track.artists}</span>
            </button>
          ))}
        </div>
      )}
      <form
        className={cx('nowPlayingLink')}
        onSubmit={(event) => {
          event.preventDefault();
          if (typedSong.trim() && !openingSong) playByName();
        }}
      >
        <input
          value={typedSong}
          onChange={(event) => setTypedSong(event.target.value)}
          placeholder="A song's name, or a YouTube, Spotify or Songsterr link"
          aria-label="A song to play"
        />
        <span className={cx('playOn')} role="radiogroup" aria-label="Play the recording on">
          {(
            [
              [
                'youtube',
                'YouTube',
                'Play it on YouTube, in your browser (a new tab when it does not play there)',
              ],
              ['spotify', 'Spotify', 'Play it on Spotify (the app on this computer, else Premium)'],
              [
                'none',
                "Don't play",
                'Only pick the song (imported when it is not one of yours): the game plays without the recording',
              ],
            ] as const
          ).map(([value, label, hint]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={playOn === value}
              className={cx('playOnChoice', `playOnChoice--${value}`, {
                'playOnChoice--on': playOn === value,
              })}
              onClick={() => updateSetting('rhythmGame.playOn', value)}
              title={hint}
            >
              {label}
            </button>
          ))}
        </span>
        <button
          type="submit"
          className={cx('spotifyButton', {
            'spotifyButton--youtube': playOn === 'youtube',
          })}
          disabled={!typedSong.trim() || openingSong}
          title={
            playOn === 'none'
              ? 'Pick the song, without its recording'
              : 'Play along with it from its start'
          }
        >
          <Icon name="music" />
          {openingSong && 'Finding...'}
          {!openingSong && (playOn === 'none' ? 'Pick' : 'Play along')}
        </button>
      </form>
      {recordingOff && spotifyLink && (
        <div className={cx('nowPlayingOff')}>
          The recording is off for this song
          <button type="button" onClick={() => setRecordingOff(false)}>
            Play with it
          </button>
        </div>
      )}
    </div>
  );

  // a call to Spotify that failed: what Spotify said (until hidden, or a call works again)
  const spotifyErrorBanner = spotifyError && (
    <div className={cx('spotifyError')} role="alert">
      <Icon name="info" />
      <span>
        <strong>Spotify:</strong> {spotifyError}
      </span>
      <button
        type="button"
        className={cx('spotifyErrorClose')}
        onClick={() => setSpotifyError('')}
        title="Hide"
      >
        <Icon name="cross" />
      </button>
    </div>
  );

  // a tab's link pasted, when the song was not found by its name
  const [pastedTab, setPastedTab] = useState('');
  // playing along with what Spotify plays: joining it, importing it, or why it cannot
  const followLine = following && phase !== 'playing' && (
    <div className={cx('follow', 'follow--on')}>
      <span className={cx('followDot')} />
      {following && (
        <>
          {following.track.imageUrl && (
            <img className={cx('followCover')} src={following.track.imageUrl} alt="" />
          )}
          <span>
            <strong>{following.track.name}</strong> · {following.track.artists}
            {following.busy && ` · ${following.busy}...`}
            {following.error && ` · ${following.error}`}
            {!following.song && !following.busy && !following.error && ' · not in your songs'}
          </span>
          {!following.song && !following.busy && !following.error && (
            <Button size="sm" intent="primary" onClick={() => importFollowed()}>
              <Icon name="plus" />
              Import and play
            </Button>
          )}
        </>
      )}
      {following && !following.song && following.error && !following.busy && (
        // not found by its name: its tab found by the player, its link pasted
        <form
          className={cx('followPaste')}
          onSubmit={(event) => {
            event.preventDefault();
            if (pastedTab.trim()) importFollowed(pastedTab.trim());
          }}
        >
          <a
            href={`https://www.songsterr.com/?pattern=${encodeURIComponent(
              `${following.track.name} ${following.track.artists.split(',')[0]}`
            )}`}
            target="_blank"
            rel="noreferrer"
            title="Search for its tab on Songsterr, in your browser, then paste its link here"
          >
            Find it on Songsterr
          </a>
          <input
            value={pastedTab}
            onChange={(event) => setPastedTab(event.target.value)}
            placeholder="Paste the tab's link"
            aria-label="The link of the song's tab"
          />
          <Button size="sm" intent="primary" type="submit" disabled={!pastedTab.trim()}>
            Import
          </Button>
        </form>
      )}
      <button
        type="button"
        className={cx('followOff')}
        onClick={() => setFollowing(null)}
        title="Close"
      >
        <Icon name="cross" />
      </button>
    </div>
  );

  // Spotify on the start screen: linked, synced (and how), and the ways to sync
  const syncedBy = spotifyLink?.syncedBy;
  const spotifyCard = spotifyLinked && (
    <div className={cx('spotifyCard')}>
      <span className={cx('spotifyBadge', { 'spotifyBadge--off': !spotifyOn })}>
        <span className={cx('followDot')} />
        {spotifyOn ? `${recordingSource} synced` : `${recordingSource}: not synced yet`}
        {spotifyOn &&
          (spotifyLink?.beatTimes
            ? ` · ${syncedBy === 'parts' ? 'parts of it heard' : 'every beat heard'}`
            : syncedBy && syncedBy !== 'estimate' && ` (${syncedBy})`)}
      </span>
      {spotifyMessage && !calibrating && (
        <span className={cx('spotifyStatus')}>{spotifyMessage}</span>
      )}
      {hearSync && (
        <span className={cx('spotifyStatus', { 'spotifyStatus--ok': hearSync.ok })}>
          {hearSync.message ??
            `${
              hearSync.parts !== undefined
                ? `Listening to part ${hearSync.part || 1} of ${hearSync.parts || '...'}`
                : `Listening to the whole song: ${formatTime(hearSync.heardMs)}${
                    hearSync.durationMs ? ` / ${formatTime(hearSync.durationMs)}` : ''
                  }`
            }${hearSyncSource(hearSync.label)}...`}
          {hearing && (
            <button
              type="button"
              className={cx('linkButton')}
              onClick={() => {
                hearStop.current = true;
              }}
              title={
                hearSync.parts !== undefined
                  ? 'Stops listening (nothing is synced)'
                  : 'Syncs with what was heard so far (the rest of the song at the tempo of its last beats)'
              }
            >
              {hearSync.parts !== undefined ? 'Cancel' : 'Stop here'}
            </button>
          )}
        </span>
      )}
      {listenSync && !spotifyLink?.beatTimes && (
        <>
          <Button
            size="sm"
            intent="primary"
            onClick={quickSync}
            disabled={hearing}
            title={`${recordingSource} plays a few parts of the song (about a minute) and the game finds them in the song: the beats between them are guessed at the tempo between them`}
          >
            Quick sync
          </Button>
          <Button
            size="sm"
            intent="neutral"
            onClick={syncByListening}
            disabled={hearing}
            title={`${recordingSource} plays the whole song once${
              spotifyLink?.durationMs ? ` (${formatTime(spotifyLink.durationMs)})` : ''
            } and the game listens: it finds where every beat is, even where the band slows down or speeds up`}
          >
            Sync with the whole song
          </Button>
        </>
      )}
      <Button
        size="sm"
        variant="ghost"
        intent="neutral"
        onClick={() => setShowSync((v) => !v)}
        aria-expanded={showSync}
      >
        {spotifyOn ? 'Resync' : 'Other ways'}
        <Icon name={showSync ? 'angle-up' : 'angle-down'} />
      </Button>
      {showSync && (
        <div className={cx('syncMenu')}>
          {listenSync && spotifyLink?.beatTimes && (
            <>
              <Button
                size="sm"
                intent="neutral"
                onClick={quickSync}
                disabled={hearing}
                title={`${recordingSource} plays a few parts of the song (about a minute), the game finds them in the song`}
              >
                Quick (parts)
              </Button>
              <Button
                size="sm"
                intent="neutral"
                onClick={syncByListening}
                disabled={hearing}
                title={`${recordingSource} plays the whole song once, the game listens to it and finds every beat again`}
              >
                Whole song
              </Button>
            </>
          )}
          <Button size="sm" intent="neutral" onClick={calibrate} title="Tap on the first chord">
            By tapping
          </Button>
          <Button
            size="sm"
            intent="neutral"
            onClick={autoSync}
            title="From the lengths of the recording and of the song"
          >
            Estimate
          </Button>
          {spotifyOn && arrows('sync')}
        </div>
      )}
    </div>
  );

  return (
    <div
      id="RhythmGame"
      className={cx('base', { 'base--playing': phase === 'playing' })}
      style={{ '--beat-ms': `${beatMs}ms` } as React.CSSProperties}
    >
      {/* the song's cover, blurred behind everything, pulsing with the beat */}
      <div className={cx('backdrop')} aria-hidden>
        {art && <div className={cx('backdropArt')} style={{ backgroundImage: `url(${art})` }} />}
        {phase === 'playing' && beat >= 0 && (
          <div className={cx('pulse', { 'pulse--bar': beat % beatsPerBar === 0 })} key={beat} />
        )}
      </div>

      {phase === 'playing' && (
        <div className={cx('hud')}>
          <div className={cx('hudSong')}>
            {cover('sm')}
            <div className={cx('hudText')}>
              <div className={cx('song')}>
                {songName}
                {songArtist && <span className={cx('artist')}> · {songArtist}</span>}
              </div>
              <div className={cx('meta')}>
                <span>
                  <strong>{round.keyLabel}</strong>
                </span>
                <span>{Math.round(((round.tempo * speed) / 100) * rate)} BPM</span>
                {beatsPerBar !== BEATS_PER_BAR && <span>{beatsPerBar}/4</span>}
                {practicing && (
                  <span className={cx('tag', 'tag--practice')}>
                    {sectionLabel} · {askedSpeed}%{practiceLoop && ` · loop ${loop + 1}`}
                  </span>
                )}
                {listening && phase === 'playing' && (
                  <span className={cx('tag', 'tag--ok')}>listening</span>
                )}
                {detached && phase === 'playing' && (
                  <span className={cx('tag', 'tag--warn')}>
                    {recordingSource} paused: the game plays it slower
                  </span>
                )}
                {rate < baseRate - 0.001 && (
                  <span className={cx('tag', 'tag--warn')}>
                    slowed down · {Math.round(speed * rate)}%
                  </span>
                )}
                {rate > baseRate + 0.001 && (
                  <span className={cx('tag', 'tag--ok')}>
                    sped up · {Math.round(speed * rate)}%
                  </span>
                )}
                {round.noSongTempo && (
                  <span className={cx('tag', 'tag--warn')}>no tempo: set it in settings</span>
                )}
                {phase === 'playing' && guessedNotice}
              </div>
            </div>
          </div>

          {gameSettings.gamification && phase === 'playing' && !listening && (
            <div className={cx('scoreBox')}>
              <span className={cx('score')}>{score}</span>
              <span className={cx('combo', { 'combo--on': combo > 1 })}>×{combo}</span>
            </div>
          )}

          <div className={cx('hudActions')}>
            {!listening && (
              <div className={cx('practiceControls')}>
                <Button
                  size="sm"
                  intent="neutral"
                  onClick={() => start(round)}
                  title={`Start ${sectionLabel.toLowerCase()} again, with a count-in (Space)`}
                >
                  <Icon name="refresh" />
                  Restart
                  <kbd className={cx('kbd')}>Space</kbd>
                </Button>
                {!spotifyOn && (
                  <span className={cx('speedControl')} title="Slower (-) or faster (+)">
                    <button
                      type="button"
                      onClick={() => changeSpeed(-5)}
                      disabled={speed <= 50}
                      aria-label="Slower"
                    >
                      −
                    </button>
                    <span
                      className={cx({
                        speedSlow: speed < 100,
                        speedFast: speed > 100,
                      })}
                    >
                      {speed}%
                    </span>
                    <button
                      type="button"
                      onClick={() => changeSpeed(5)}
                      disabled={speed >= 150}
                      aria-label="Faster"
                    >
                      +
                    </button>
                  </span>
                )}
              </div>
            )}
            <Button
              intent={showMixer ? 'primary' : 'neutral'}
              onClick={() => setShowMixer((v) => !v)}
              title="The part you play, and the volume and instrument of each part (M)"
              aria-pressed={showMixer}
            >
              <Icon name="music" />
              Volume &amp; parts
              <kbd className={cx('kbd')}>M</kbd>
            </Button>
            <Button
              className={cx('stop')}
              intent="danger"
              onClick={stop}
              title="Stop the song (Esc)"
            >
              <Icon name="cross" />
              Stop
              <kbd className={cx('kbd')}>Esc</kbd>
            </Button>
          </div>
        </div>
      )}

      {phase === 'playing' && player}

      {phase === 'playing' && spotifyErrorBanner}
      {phase === 'playing' && (status || spotifyOn) && (
        <div className={cx('statusRow')}>
          {status && (
            <span
              className={cx('statusChip', `statusChip--${status.tone}`)}
              title={
                status.tone === 'busy'
                  ? `The game sound is off for a moment while it listens to ${recordingSource}`
                  : undefined
              }
            >
              <span className={cx('followDot')} />
              {status.text}
            </span>
          )}
          {spotifyOn && arrows('sync', true)}
          {spotifyOn && listening && (
            <span className={cx('latencyHint')}>
              Tap Space or a key on each chord change to sync
              {tapCount > 0 && ` (${tapCount}/4)`}
            </span>
          )}
        </div>
      )}

      {phase === 'playing' && (
        <div className={cx('stage')}>
          <div className={cx('current')}>
            {currentSection && <span className={cx('sectionTag')}>{currentSection.name}</span>}
            {countIn !== null && (
              <span className={cx('countIn')} key={countIn}>
                {countIn}
              </span>
            )}
            {countIn === null && resting && nextHit && (
              <>
                <span className={cx('currentName', 'currentName--rest')}>Rest</span>
                <span className={cx('then')}>
                  next <strong>{formatSharpsFlats(nextHit.name)}</strong> in{' '}
                  {Math.ceil(restBeats / beatsPerBar)} bars
                </span>
              </>
            )}
            {countIn === null && !resting && (
              <>
                <span className={cx('currentName')}>{formatSharpsFlats(nextHit?.name ?? '')}</span>
                <span className={cx('currentNumeral')}>{nextHit?.numeral}</span>
                {thenHit && !waitingHit && (
                  <span className={cx('then')}>
                    then <strong>{formatSharpsFlats(thenHit.name)}</strong>
                  </span>
                )}
                {waitingHit && (
                  <span className={cx('waiting')}>
                    Waiting for {formatSharpsFlats(waitingHit.name)}...
                  </span>
                )}
                {nextHit && keyStrip(nextHit)}
                {/* the chord the keys held make (the line kept: nothing moves when it shows) */}
                <span className={cx('playedChord')}>
                  {playedMidiNotes.length > 1 && playedChords[0] ? (
                    <>
                      You play <strong>{formatSharpsFlats(playedChords[0].symbol)}</strong>
                    </>
                  ) : (
                    '\u00a0'
                  )}
                </span>
              </>
            )}
            {judgement && phase === 'playing' && (
              <span
                className={cx('judgement', `judgement--${judgement.result}`)}
                key={`${judgement.id}-${judgement.result}`}
              >
                {LABELS[judgement.result]}
              </span>
            )}
          </div>

          <div className={cx('beats')}>
            {Array.from({ length: beatsPerBar }, (_, i) => (
              <span
                // eslint-disable-next-line react/no-array-index-key
                key={i}
                className={cx('beat', {
                  'beat--on': phase === 'playing' && beat >= 0 && beat % beatsPerBar === i,
                  'beat--first': i === 0,
                })}
              />
            ))}
          </div>

          {gameSettings.view === 'highway' && highway}
          {gameSettings.view !== 'highway' && (
            <div className={cx('lane')}>
              <div className={cx('hitLine')} style={{ left: `${HIT_LINE}%` }} />
              {judgement && judgement.result !== 'miss' && phase === 'playing' && (
                <div
                  className={cx('hitFlash', `hitFlash--${judgement.result}`)}
                  style={{ left: `${HIT_LINE}%` }}
                  key={`flash-${judgement.id}`}
                />
              )}
              {visible.map((h) => (
                <div
                  key={h.id}
                  className={cx('block', h.result && `block--${h.result}`, {
                    'block--next': h === nextHit && isOpen(h),
                    'block--skipped': h.skipped,
                    'block--repeat': !h.chordStart,
                  })}
                  style={
                    {
                      left: `${HIT_LINE + ((h.time - now) / beatMs) * beatWidth}%`,
                      width: `${Math.max(2, h.length * beatWidth - 1)}%`,
                      '--hue': degreeHue(h.numeral),
                    } as React.CSSProperties
                  }
                >
                  <span className={cx('blockName')}>{formatSharpsFlats(h.name)}</span>
                  {h.chordStart && <span className={cx('blockNumeral')}>{h.numeral}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {calibrating && (
        <div className={cx('panel', 'panel--spotify')}>
          <div className={cx('panelTitle')}>Sync with {recordingSource}</div>
          <div className={cx('panelText')}>
            Spotify plays <strong>{spotifyLink?.name}</strong> from the start. Press Space or any
            key of your keyboard right when the first chord (
            <strong>{formatSharpsFlats(round.chords[0]?.name ?? '')}</strong>) starts.
          </div>
          {spotifyMessage && <div className={cx('spotifyStatus')}>{spotifyMessage}</div>}
          <div className={cx('buttons')}>
            <Button intent="primary" onClick={tap}>
              Tap: first chord now
            </Button>
            <Button
              intent="neutral"
              onClick={() => {
                setCalibrating(false);
                window.app.spotify.pause().catch(() => {});
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {phase === 'ready' && !calibrating && (
        <div className={cx('card')}>
          {followLine}
          {nowPlayingBox}
          {spotifyErrorBanner}
          <div className={cx('cardHead')}>
            {cover('lg')}
            <div className={cx('cardInfo')}>
              <div className={cx('cardTitle')}>{songName}</div>
              {songArtist && <div className={cx('cardArtist')}>{songArtist}</div>}
              <div className={cx('meta')}>
                <span>
                  <strong>{round.keyLabel}</strong>
                </span>
                <span>{Math.round((round.tempo * speed) / 100)} BPM</span>
                <span>
                  {round.sections.length} section
                  {round.sections.length > 1 ? 's' : ''}
                </span>
                {round.parts.length > 0 && (
                  <span>
                    {round.parts.length} part{round.parts.length > 1 ? 's' : ''}
                  </span>
                )}
                {guessed && (
                  <button
                    type="button"
                    role="switch"
                    className={cx('switch', { 'switch--on': guessedChordsOn })}
                    onClick={() => updateSetting('rhythmGame.guessedChords', !guessedChordsOn)}
                    aria-checked={guessedChordsOn}
                    title="This tab has no chord names: play chords guessed from its notes (they may not fit), or play a part of the song instead"
                  >
                    <span className={cx('switchTrack')}>
                      <span className={cx('switchKnob')} />
                    </span>
                    Guess chords
                    <span className={cx('switchState')}>{guessedChordsOn ? 'On' : 'Off'}</span>
                  </button>
                )}
              </div>
              {spotifySync && spotifyLink && !round.song.imported?.bpm && (
                <div className={cx('spotifyStatus')}>
                  This song has no tempo: type it in the settings to play it with Spotify
                </div>
              )}
              {spotifyCard}
            </div>
          </div>

          <div className={cx('cardPlay')}>
            {songPicker}
            <Button
              intent="neutral"
              onClick={() => start(round, { listen: true })}
              title="Hear the song played by itself before playing it (L)"
            >
              <Icon name="visible" />
              Listen
              <kbd className={cx('kbd')}>L</kbd>
            </Button>
            <Button
              intent={practicing ? 'primary' : 'neutral'}
              onClick={() => {
                changePracticing(!practicing);
                setTab('practice');
              }}
              aria-pressed={practicing}
              title="Practice a part of the song: pick sections or bars, slow it down, loop it"
            >
              <Icon name="refresh" />
              {practicing ? 'Practicing' : 'Practice'}
            </Button>
            <Button className={cx('startButton')} intent="primary" onClick={() => start()}>
              <Icon name="music" />
              {practicing
                ? `Practice ${sectionLabel.toLowerCase()} · ${speed}%`
                : `Play ${playsNotes ? 'the notes' : 'the chords'}`}
              <kbd className={cx('kbd')}>Enter</kbd>
            </Button>
          </div>

          {player}
          <div className={cx('hint')}>
            Click a section to start from it · drag across sections to practice them
          </div>

          <div className={cx('tabs')} role="tablist">
            {(
              [
                ['practice', 'Practice'],
                ['sound', 'Volume & parts'],
                ['timing', 'Timing'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                className={cx('tab', { 'tab--on': tab === id })}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className={cx('tabPanel')} role="tabpanel">
            {tab === 'practice' && practice}
            {tab === 'sound' && (
              <>
                {partPicker}
                {partToggles}
                {mixer}
              </>
            )}
            {tab === 'timing' && (
              <>
                {arrows('latency')}
                <div className={cx('hint')}>
                  How late your playing reaches the game (MIDI, audio, bluetooth): chords played
                  that late still count as on time.
                </div>
                {spotifyOn && arrows('sync')}
                {spotifyOn && (
                  <div className={cx('hint')}>
                    Where the song is in the Spotify recording: move it when the chords come too
                    early (◀) or too late (▶).
                  </div>
                )}
              </>
            )}
          </div>
          <div className={cx('hint')}>
            {playsNotes
              ? 'Each new key pressed plays a note (holding the last one is fine).'
              : 'Release the keys between chords, even when a chord is repeated.'}
          </div>
        </div>
      )}

      {phase === 'done' && (
        <div className={cx('card', 'card--done')}>
          {followLine}
          {nowPlayingBox}
          {spotifyErrorBanner}
          {!listening && !practiceLoop && (
            <div className={cx('result')}>
              <span className={cx('grade', `grade--${grade}`)}>{grade}</span>
              <div className={cx('resultText')}>
                <div className={cx('panelTitle')}>
                  {accuracy}% · {songName}
                  {isWholeSong ? '' : ` (${sectionLabel})`}
                </div>
                <div className={cx('stats')}>
                  <span className={cx('stat--perfect')}>Perfect {stats.perfect}</span>
                  <span className={cx('stat--good')}>Good {stats.good}</span>
                  <span className={cx('stat--miss')}>Miss {stats.miss}</span>
                  <span>Best combo {bestCombo}</span>
                  {gameSettings.gamification && <span>{score} pts</span>}
                </div>
              </div>
            </div>
          )}
          {practiceLoop && !listening && (
            <div className={cx('panelTitle')}>
              Loop {loop + 1} done: <strong>{accuracy}%</strong>, again in a moment
              {practiceRamp && stats.miss === 0 && speed < 100 && ' (5% faster)'}
            </div>
          )}
          {listening && (
            <div className={cx('panelTitle')}>
              That was <strong>{round.song.title}</strong>
              {isWholeSong ? '' : ` (${sectionLabel})`}: your turn now!
            </div>
          )}
          {syncAdjust !== null && (
            <div className={cx('spotifyStatus', 'spotifyStatus--ok')}>
              Spotify sync corrected by {syncAdjust > 0 ? '+' : ''}
              {syncAdjust} ms from your playing
            </div>
          )}
          <div className={cx('cardPlay')}>
            {practiceLoop && (
              <Button
                intent="neutral"
                onClick={() => updateSetting('rhythmGame.practiceLoop', false)}
              >
                <Icon name="cross" />
                Stop looping
              </Button>
            )}
            {!practiceLoop && songPicker}
            <Button
              className={cx({ startButton: listening })}
              intent={listening ? 'primary' : 'neutral'}
              onClick={() => start()}
            >
              <Icon name={listening ? 'music' : 'reset'} />
              {listening ? 'Play it' : 'Play again'}
              <kbd className={cx('kbd')}>Enter</kbd>
            </Button>
            {!chosenSong && !practiceLoop && !listening && (
              <Button
                className={cx('startButton')}
                intent="primary"
                onClick={() => start(newRound(round.song.id))}
              >
                <Icon name="music" />
                Next song
                <kbd className={cx('kbd')}>N</kbd>
              </Button>
            )}
          </div>
          {!practiceLoop && (
            <details className={cx('more')}>
              <summary>Practice a part of it</summary>
              {practice}
            </details>
          )}
        </div>
      )}

      {gameSettings.view !== 'highway' && keyboard}

      {/* below the game, not over it */}
      {phase === 'playing' && (showMixer || listening) && (
        <div
          className={cx('mixerDock', {
            'mixerDock--panel': showMixer && !listening,
          })}
        >
          {showMixer && !listening && (
            <button
              type="button"
              className={cx('mixerClose')}
              onClick={() => setShowMixer(false)}
              title="Hide (M)"
            >
              <Icon name="cross" />
            </button>
          )}
          {!listening && partPicker}
          {mixer}
        </div>
      )}

      {phase !== 'playing' && !calibrating && (
        <div className={cx('corner')}>
          <Button
            intent="neutral"
            onClick={() => navigate('settings')}
            title="Songs, Spotify, gameplay and sound settings"
          >
            <Icon name="settings" />
            Settings
          </Button>
        </div>
      )}

      {songLibrary}
    </div>
  );
};

export default RhythmGame;
