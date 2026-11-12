export type KeyboardSettings = {
  skin: 'classic' | 'flat';
  from: string;
  to: string;
  label: 'none' | 'pitchClass' | 'note' | 'chordNote' | 'interval';
  keyName: 'none' | 'octave' | 'pitchClass' | 'note';
  keyInfo: 'none' | 'tonic' | 'interval' | 'tonicAndInterval';
  fadeOutDuration: number;
  textOpacity: number;
  displaySustained: boolean;
  wrap: boolean;
  sizes: {
    radius: number;
    height: number;
    ratio: number;
    bevel: boolean;
  };
  colors: {
    white: string | null;
    black: string | null;
    played: string | null;
    wrapped: string | null;
    sustained: string | null;
  };
};

export type ChordDisplaySettings = {
  id: string;
  chordNotation: 'long' | 'short' | 'symbol' | 'preferred';
  allowOmissions: boolean;
  useSustain: boolean;
  detectOnRelease: boolean;
  highlightAlterations: boolean;
  displayKeyboard: boolean;
  displayChord: boolean;
  displayName: boolean;
  displayNotation: boolean;
  displayAltChords: boolean;
  displayIntervals: boolean;
  keyboard: KeyboardSettings;
};

/** Hands to display finger numbers for, in learning modes */
export type Fingering = 'right' | 'left' | 'both' | 'none';

/** A song imported from a ChordPro file or a chord sheet */
/** Parts of a song played by the built-in sound (Songsterr songs) */
export type SongPartRole = 'rhythm' | 'bass' | 'lead' | 'melody';

/** The notes of a part: flat [start, length, midi, velocity, ...] in beats from the song start */
export type SongPart = { role: SongPartRole; name: string; notes: number[] };

export type ImportedSong = {
  id: string;
  title: string;
  /** key of the song, e.g. "G" or "Em" (from the file, or the first chord) */
  key: string;
  /** chord names in order, e.g. ["G", "Em7", "C", "D"] */
  chords: string[];
  /** length of each chord in beats (from bar lines), one bar each if not given */
  beats?: number[];
  /** beats in a bar (time signature: 3 for 3/4) */
  beatsPerBar?: number;
  /** tempo of the song (beats per minute) */
  bpm?: number;
  /** the song's own rhythm: a chord is played every N beats (from the strumming) */
  beatsPerHit?: number;
  /** web address the song was imported from (to import it again) */
  url?: string;
  /** parts of the song (verse, chorus...): their name and the index of their first chord */
  sections?: { name: string; start: number }[];
  /** beats of intro before the first chord */
  leadIn?: number;
  /** notes of the instruments (rhythm guitar, bass, lead, melody), to hear the real song */
  parts?: SongPart[];
  /** the song on Spotify, and where its first chord is in the recording (ms, once synced) */
  spotify?: {
    uri: string;
    name: string;
    durationMs?: number;
    firstChordMs?: number;
    /** how the first chord was found: estimated, tapped, or corrected from the playing */
    syncedBy?: 'estimate' | 'tap' | 'playing';
  };
};

/** Tonics asked in quizzes: every key, or natural keys only (no sharp or flat) */
export type Tonics = 'all' | 'natural';

/** Chord types asked in the chord quiz ("all" uses the difficulty) */
export type ChordSet = 'majorMinor' | 'triads' | 'sevenths' | 'ninths' | 'triadsSevenths' | 'all';

export type ChordQuizSettings = {
  /** "rhythm" is from before the Rhythm Game had its own module (read as "random") */
  mode: 'random' | 'randomInKey' | 'progressions' | 'rhythm';
  chords: ChordSet;
  /** chords of the set left out (tonal names, e.g. "m" or "dim") */
  excludedChords: string[];
  tonics: Tonics;
  difficulty: 0 | 1 | 2 | 3 | 4 | 5;
  gameLength: number;
  gamification: boolean;
  chordNotation: 'long' | 'short' | 'symbol' | 'preferred';
  displayName: boolean;
  displayReaction: boolean;
  displayIntervals: boolean;
  learningMode: boolean;
  fingering: Fingering;
  displayRelative: boolean;
  /** stays on the chord after a wrong answer, until the right chord is played */
  retryUntilCorrect: boolean;
  /** key of the progressions: random, or the current key (notation settings) */
  progressionKey: 'random' | 'current';
  /** progressions left out (ids, e.g. "ii-V-I") */
  excludedProgressions: string[];
  /** progressions written by the user, one per line (e.g. "I vi ii V") */
  customProgressions: string;
};

export type RhythmGameSettings = {
  /** beats per minute */
  tempo: number;
  /** chords played in the rhythm of the song, once per bar, twice, or on every beat */
  pattern: 'song' | 'bar' | 'half' | 'beat';
  /** songs with a tempo of their own (imported) are played at it */
  songTempo: boolean;
  /** songs left out (ids) */
  excludedSongs: string[];
  /** the song to play (id), or "" for a random song */
  song: string;
  /** songs imported from chord sheets or web pages (chords in their key) */
  customSongs: ImportedSong[];
  /** the song name is shown from the start, or revealed at the end */
  showTitle: 'start' | 'end';
  /** the song speeds up (5% every 4 hits in a row, up to 1.5 times) */
  speedUp: boolean;
  /** key of the built-in songs: random, or the current key (notation settings) */
  songKey: 'random' | 'current';
  tonics: Tonics;
  learningMode: boolean;
  fingering: Fingering;
  /** learning mode: on a miss, keep going, wait for the chord, or slow down */
  onMiss: 'continue' | 'wait' | 'slowDown';
  gamification: boolean;
  /** built-in sound: the chords of the song, a click on the beat, both, or nothing */
  sound: 'off' | 'chords' | 'click' | 'both';
  /** built-in sound: the parts of Songsterr songs heard (the rhythm guitar replaces the chords) */
  songParts: SongPartRole[];
  /** built-in sound: volume of each part, from 0 to 100 */
  volumes: {
    chords: number;
    rhythm: number;
    bass: number;
    lead: number;
    melody: number;
    click: number;
  };
  /** Spotify: the Client ID of the user's Spotify app (to log in) */
  spotifyClientId: string;
  /** Spotify: songs linked to Spotify play there, in time with the game */
  spotifySync: boolean;
};

export type ScaleSet =
  | 'major'
  | 'minor'
  | 'majorMinor'
  | 'modes'
  | 'minors'
  | 'pentatonics'
  | 'all';

export type ScaleQuizSettings = {
  /** play scales, melodies of songs, or random solo phrases (over a backing track) */
  practice: 'scales' | 'melodies' | 'solo';
  /** solo: key, as a chroma ("0" = C ... "11" = B) or "current" (notation settings) */
  soloKey: string;
  /** solo: scale the phrases are made of (tonal name, e.g. "minor pentatonic") */
  soloScale: string;
  /** solo: number of notes of a phrase */
  soloLength: 'short' | 'medium' | 'long';
  /** melodies left out (ids) */
  excludedMelodies: string[];
  mode: 'random' | 'randomInKey' | 'sequential';
  tonics: Tonics;
  scales: ScaleSet;
  direction: 'up' | 'down' | 'upDown';
  requiredCleanRuns: number;
  jumpBack: boolean;
  learningMode: boolean;
  fingering: Fingering;
  gamification: boolean;
  displayReaction: boolean;
  displayNoteNames: boolean;
  displayFormula: boolean;
  displayRelative: boolean;
};

export type ScaleDegreesSettings = {
  mode: 'random' | 'randomInKey';
  tonics: Tonics;
  scales: ScaleSet;
  gameLength: number;
  gamification: boolean;
  displayReaction: boolean;
  displayScaleNotes: boolean;
  displayDegreeName: boolean;
  displayRelative: boolean;
  /** keyboard with the keys of the scale and their degrees */
  learningMode: boolean;
};

export type CircleOfFifthsSettings = {
  scale: 'major' | 'minor';
  highlightSector: 'chord' | 'notes';
  highlightInScale: boolean;
  displayMajor: boolean;
  displayMinor: boolean;
  displayDiminished: boolean;
  displayDominants: boolean;
  displayAlterations: boolean;
  displaySuspended: boolean;
  displayModes: boolean;
  displayDegrees: boolean;
  displayDegreeLabels: boolean;
};

export type ChordDictionarySettings = {
  interactive: 'detect' | 'play';
  hideDisabled: boolean;
  filterInKey: boolean;
  groupBy: 'none' | 'quality' | 'intervals';
  defaultNotation: 'long' | 'short' | 'symbol';
  disabled: string[];
  aliases: Array<[key: string, value: string]>;
};

export type NotationSettings = {
  key: string;
  accidentals: 'flat' | 'sharp';
  staffClef: 'both' | 'bass' | 'treble';
  staffTranspose: number;
};

export type ServerSettings = {
  enabled: boolean;
  port: number;
};

export type GeneralSettings = {
  launchAtStartup: boolean;
  startMinimized: boolean;
  /** built-in sound: the notes played on the MIDI keyboard are heard */
  playNotes: boolean;
  /** built-in sound: volume from 0 to 100 */
  soundVolume: number;
  /** built-in sound: classical (piano, strings, flute) or electric */
  soundStyle: 'classical' | 'electric';
};

export type Settings = {
  general: GeneralSettings;
  chordDisplay: ChordDisplaySettings[];
  chordQuiz: ChordQuizSettings;
  scaleQuiz: ScaleQuizSettings;
  scaleDegrees: ScaleDegreesSettings;
  rhythmGame: RhythmGameSettings;
  circleOfFifths: CircleOfFifthsSettings;
  chordDictionary: ChordDictionarySettings;
  notation: NotationSettings;
  server: ServerSettings;
};
