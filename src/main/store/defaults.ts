import {
  ChordDictionarySettings,
  ChordDisplaySettings,
  ChordQuizSettings,
  CircleOfFifthsSettings,
  KeyboardSettings,
  NotationSettings,
  RhythmGameSettings,
  SongPartRole,
  ScaleDegreesSettings,
  ScaleQuizSettings,
} from 'main/types';
import { StoreType } from '../types/Store';

export const defaultKeyboardSettings: KeyboardSettings = {
  skin: 'classic' as const,
  from: 'C3',
  to: 'C5',
  label: 'pitchClass',
  keyName: 'note',
  keyInfo: 'tonicAndInterval',
  fadeOutDuration: 0,
  textOpacity: 0.5,
  displaySustained: true,
  wrap: false,
  sizes: {
    radius: 0.4,
    height: 6,
    ratio: 0.6,
    bevel: true,
  },
  colors: {
    white: '#ffffff',
    black: '#000000',
    played: '#315bce',
    wrapped: '#1d367b',
    sustained: '#808080',
  },
};

export const defaultChordDisplaySettings: ChordDisplaySettings = {
  id: 'default',
  chordNotation: 'preferred',
  allowOmissions: true,
  useSustain: true,
  detectOnRelease: true,
  highlightAlterations: false,
  displayKeyboard: true,
  displayChord: true,
  displayName: false,
  displayNotation: false,
  displayAltChords: true,
  displayIntervals: false,
  keyboard: defaultKeyboardSettings,
};

export const defaultChordQuizSettings: ChordQuizSettings = {
  mode: 'random' as const,
  chords: 'all' as const,
  excludedChords: [],
  tonics: 'all' as const,
  difficulty: 0 as const,
  gameLength: 16,
  gamification: true,
  chordNotation: 'preferred',
  displayName: true,
  displayReaction: true,
  displayIntervals: true,
  learningMode: false,
  fingering: 'right' as const,
  displayRelative: false,
  retryUntilCorrect: false,
  progressionKey: 'random' as const,
  excludedProgressions: [],
  customProgressions: '',
};

export const defaultScaleQuizSettings: ScaleQuizSettings = {
  practice: 'scales' as const,
  soloKey: '9',
  soloScale: 'minor pentatonic',
  soloLength: 'medium' as const,
  excludedMelodies: [],
  mode: 'random' as const,
  tonics: 'all' as const,
  scales: 'majorMinor' as const,
  direction: 'up' as const,
  requiredCleanRuns: 0,
  jumpBack: true,
  learningMode: false,
  fingering: 'right' as const,
  gamification: true,
  displayReaction: true,
  displayNoteNames: false,
  displayFormula: true,
  displayRelative: false,
};

export const defaultRhythmGameSettings: RhythmGameSettings = {
  tempo: 80,
  pattern: 'song' as const,
  songTempo: false,
  excludedSongs: [],
  song: '',
  customSongs: [],
  showTitle: 'start' as const,
  speedUp: false,
  songKey: 'random' as const,
  tonics: 'all' as const,
  learningMode: false,
  fingering: 'right' as const,
  onMiss: 'continue' as const,
  gamification: true,
  practiceSpeed: 100,
  practiceLoop: false,
  practiceRamp: false,
  sound: 'chords' as const,
  songParts: ['rhythm', 'bass', 'lead', 'melody'] as SongPartRole[],
  volumes: { chords: 80, rhythm: 70, bass: 75, lead: 65, melody: 80, click: 60 },
  spotifyClientId: '',
  spotifySync: false,
};

export const defaultScaleDegreesSettings: ScaleDegreesSettings = {
  mode: 'random' as const,
  tonics: 'all' as const,
  scales: 'majorMinor' as const,
  gameLength: 8,
  gamification: true,
  displayReaction: true,
  displayScaleNotes: false,
  displayDegreeName: true,
  displayRelative: false,
  learningMode: false,
};

export const defaultCircleOfFifthsSettings: CircleOfFifthsSettings = {
  scale: 'major' as const,
  highlightSector: 'chord' as const,
  highlightInScale: true,
  displayMajor: true,
  displayMinor: true,
  displayDiminished: true,
  displayDominants: false,
  displaySuspended: false,
  displayAlterations: true,
  displayModes: false,
  displayDegrees: false,
  displayDegreeLabels: false,
};

export const defaultChordDictionarySettings: ChordDictionarySettings = {
  interactive: 'play',
  hideDisabled: false,
  filterInKey: false,
  groupBy: 'none',
  defaultNotation: 'short',
  disabled: [],
  aliases: [['maj', '']],
};

export const defaultNotationSettings: NotationSettings = {
  key: 'C',
  accidentals: 'flat' as const,
  staffClef: 'both' as const,
  staffTranspose: 0,
};

export const defaults: StoreType = {
  midi: {
    routes: [],
  },
  windowState: {
    x: null,
    y: null,
    width: null,
    height: null,
    maximized: false,
    alwaysOnTop: false,
    changelogDismissed: '100.0.0', // hack: ensure changelog does not blink at startup
    updateDismissed: null,
    path: '/',
  },
  settings: {
    general: {
      launchAtStartup: false,
      startMinimized: false,
      playNotes: false,
      soundVolume: 70,
      soundStyle: 'classical' as const,
    },
    chordDisplay: [defaultChordDisplaySettings],
    chordQuiz: defaultChordQuizSettings,
    scaleQuiz: defaultScaleQuizSettings,
    scaleDegrees: defaultScaleDegreesSettings,
    rhythmGame: defaultRhythmGameSettings,
    circleOfFifths: defaultCircleOfFifthsSettings,
    chordDictionary: defaultChordDictionarySettings,
    notation: defaultNotationSettings,
    server: {
      enabled: true,
      port: 25011,
    },
  },
};
