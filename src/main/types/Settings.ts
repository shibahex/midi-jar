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

export type ChordQuizSettings = {
  mode: 'random' | 'randomInKey';
  difficulty: 0 | 1 | 2 | 3 | 4 | 5;
  gameLength: number;
  gamification: boolean;
  chordNotation: 'long' | 'short' | 'symbol' | 'preferred';
  displayName: boolean;
  displayReaction: boolean;
  displayIntervals: boolean;
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
  mode: 'random' | 'randomInKey';
  scales: ScaleSet;
  direction: 'up' | 'down' | 'upDown';
  requiredCleanRuns: number;
  jumpBack: boolean;
  learningMode: boolean;
  fingering: 'right' | 'left' | 'both' | 'none';
  gamification: boolean;
  displayReaction: boolean;
  displayNoteNames: boolean;
  displayFormula: boolean;
};

export type ScaleDegreesSettings = {
  mode: 'random' | 'randomInKey';
  scales: ScaleSet;
  gameLength: number;
  gamification: boolean;
  displayReaction: boolean;
  displayScaleNotes: boolean;
  displayDegreeName: boolean;
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
