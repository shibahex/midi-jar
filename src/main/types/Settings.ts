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

/** Tonics asked in quizzes: every key, or natural keys only (no sharp or flat) */
export type Tonics = 'all' | 'natural';

/** Chord types asked in the chord quiz ("all" uses the difficulty) */
export type ChordSet = 'majorMinor' | 'triads' | 'sevenths' | 'ninths' | 'triadsSevenths' | 'all';

export type ChordQuizSettings = {
  mode: 'random' | 'randomInKey' | 'progressions';
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

export type ScaleSet =
  | 'major'
  | 'minor'
  | 'majorMinor'
  | 'modes'
  | 'minors'
  | 'pentatonics'
  | 'all';

export type ScaleQuizSettings = {
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
};

export type Settings = {
  general: GeneralSettings;
  chordDisplay: ChordDisplaySettings[];
  chordQuiz: ChordQuizSettings;
  scaleQuiz: ScaleQuizSettings;
  scaleDegrees: ScaleDegreesSettings;
  circleOfFifths: CircleOfFifthsSettings;
  chordDictionary: ChordDictionarySettings;
  notation: NotationSettings;
  server: ServerSettings;
};
