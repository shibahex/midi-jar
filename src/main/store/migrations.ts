/* eslint-disable @typescript-eslint/ban-ts-comment, camelcase */
import { Migrations } from 'conf/dist/source/types';
import Conf from 'conf';
import { StoreType } from '../types/Store';
import {
  v1_0_0_MidiRouteRaw,
  v1_1_0_Settings,
  v1_2_0_ChordDisplaySettings,
  v1_2_0_Settings,
  v1_3_0_Settings,
  v1_3_1_MidiRouteRaw,
  v1_4_0_Settings,
  v1_4_0_WindowState,
  v1_5_0_ChordDisplaySettings,
  v1_5_0_Settings,
  v1_5_1_WindowState,
  v1_6_0_ChordDisplaySettings,
  v1_6_0_KeyboardSettings,
  v1_6_0_Settings,
  v1_7_0_ChordDisplaySettings,
  v1_7_0_Settings,
} from './legacy-types';
import { RhythmGameSettings, Settings } from '../types/Settings';
import { defaultRhythmGameSettings } from './defaults';

const migrations: Migrations<StoreType> = {
  '1.0.0': (store: Conf<StoreType>) => {
    store.set('version', '1.0.0');
    store.set('settings.chordDisplay', {
      internal: {
        skin: 'classic',
        from: 'C3',
        to: 'C5',
        displayKeyboard: true,
        displayNotes: true,
        displayChord: true,
        displayNotation: false,
        displayAltChords: true,
        displayTonic: true,
        displayDegrees: true,
        displayKeyNames: true,
        colorHighlight: '#315bce',
        colorNoteWhite: '#ffffff',
        colorNoteBlack: '#000000',
      },
      overlay: {
        useInternal: true,
        skin: 'classic',
        from: 'C3',
        to: 'C5',
        displayKeyboard: true,
        displayNotes: true,
        displayChord: true,
        displayNotation: false,
        displayAltChords: true,
        displayTonic: true,
        displayDegrees: true,
        displayKeyNames: true,
        colorHighlight: '#315bce',
        colorNoteWhite: '#ffffff',
        colorNoteBlack: '#000000',
      },
    });
  },
  '1.1.0': (store: Conf<StoreType>) => {
    store.set('version', '1.1.0');
    store.set('settings.chordDisplay.internal.key', 'C');
    store.set('settings.chordDisplay.overlay.key', 'C');
  },
  '1.2.0': (store: Conf<StoreType>) => {
    store.set('version', '1.2.0');

    const settings = store.get('settings') as unknown as v1_1_0_Settings;

    // @ts-ignore
    delete settings.chordDisplay.internal.key;
    // @ts-ignore
    delete settings.chordDisplay.internal.accidentals;

    const newSettings: v1_2_0_Settings = {
      ...settings,
      chordDisplay: {
        internal: settings.chordDisplay.internal,
        overlay: settings.chordDisplay.overlay,
      },
      notation: {
        key: settings.chordDisplay.internal.key || 'C',
        accidentals: settings.chordDisplay.internal.accidentals || 'flat',
        staffClef: 'both',
        staffTranspose: 0,
      },
      circleOfFifths: {
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
      },
    };

    store.set('settings', newSettings);
  },
  '1.3.0': (store: Conf<StoreType>) => {
    store.set('version', '1.3.0');

    const settings = store.get('settings') as unknown as v1_2_0_Settings;

    const newSettings: v1_3_0_Settings = {
      ...settings,
      chordDisplay: {
        internal: {
          ...settings.chordDisplay.internal,
          displayIntervals: false,
        },
        overlay: settings.chordDisplay.overlay
          ? {
              ...settings.chordDisplay.overlay,
              displayIntervals: false,
            }
          : undefined,
      },
      chordQuiz: {
        mode: 'random' as const,
        difficulty: 0,
        gameLength: 16,
        gamification: true,
        displayReaction: true,
        displayIntervals: true,
      },
    };

    store.set('settings', newSettings);
  },
  '1.3.1': (store: Conf<StoreType>) => {
    store.set('version', '1.3.1');

    const routes = store.get('midi.routes', []) as unknown as v1_0_0_MidiRouteRaw[];

    const newRoutes = routes.map((r: v1_0_0_MidiRouteRaw): v1_3_1_MidiRouteRaw => {
      if (r.type === 'websocket' && r.output === 'chord-display') {
        return { ...r, type: 'internal', output: 'chord-display/overlay' };
      }
      if (r.type === 'internal' && r.output === 'chord-display') {
        return { ...r, type: 'internal', output: 'chord-display/internal' };
      }

      return r as v1_3_1_MidiRouteRaw;
    });

    store.set('midi.routes', newRoutes);
  },
  '1.4.0': (store: Conf<StoreType>) => {
    store.set('version', '1.4.0');

    const oldChordDisplaySettings = store.get('settings.chordDisplay', undefined) as unknown as
      | undefined
      | {
          internal: v1_2_0_ChordDisplaySettings;
          overlay: v1_2_0_ChordDisplaySettings;
        };

    if (!oldChordDisplaySettings) {
      store.set('settings.chordDisplay', [
        {
          id: 'default',
          skin: 'classic' as const,
          from: 'C3',
          to: 'C5',
          displayKeyboard: true,
          displayNotes: true,
          displayChord: true,
          displayNotation: false,
          displayAltChords: true,
          displayTonic: true,
          displayDegrees: true,
          displayKeyNames: true,
          displayIntervals: false,
          colorHighlight: '#315bce',
          colorNoteWhite: '#ffffff',
          colorNoteBlack: '#000000',
        },
      ]);
    } else {
      // @ts-ignore
      delete oldChordDisplaySettings.internal.useInternal;
      // @ts-ignore
      delete oldChordDisplaySettings.overlay.useInternal;

      store.set('settings.chordDisplay', [
        {
          id: 'internal',
          ...oldChordDisplaySettings.internal,
        },
        {
          id: 'overlay',
          ...oldChordDisplaySettings.overlay,
        },
      ]);
    }
  },
  '1.5.0': (store: Conf<StoreType>) => {
    store.set('version', '1.5.0');
    store.set('windowState.changelogDismissed', false);

    const settings = store.get('settings') as unknown as v1_4_0_Settings;

    const newSettings: v1_5_0_Settings = {
      ...settings,
      chordDisplay: settings.chordDisplay.map((chordDisplaySettings) => ({
        ...chordDisplaySettings,
        chordNotation: 'short',
        allowOmissions: true,
        highlightAlterations: false,
        displayName: false,
      })),
      chordQuiz: {
        ...settings.chordQuiz,
        chordNotation: 'short',
        displayName: true,
      },
    };

    store.set('settings', newSettings);
  },
  '1.5.1': (store: Conf<StoreType>) => {
    store.set('version', '1.5.1');
    store.set('windowState.changelogDismissed', false);

    const windowState = store.get('windowState') as unknown as v1_4_0_WindowState;

    const newWindowState: v1_5_1_WindowState = {
      ...windowState,
      maximized: false,
      alwaysOnTop: false,
      path: '/',
      updateDismissed: null,
      changelogDismissed: false,
    };

    store.set('windowState', newWindowState);
  },
  '1.6.0': (store: Conf<StoreType>) => {
    store.set('version', '1.6.0');
    store.set('windowState.changelogDismissed', false);
    store.set('windowState.updateDismissed', null);

    const chordDisplay = store.get(
      'settings.chordDisplay',
      undefined
    ) as unknown as v1_5_0_ChordDisplaySettings[];

    const newChordDisplay = chordDisplay.map(
      (chordDisplaySettings): v1_6_0_ChordDisplaySettings => {
        let keyboardInfo: v1_6_0_KeyboardSettings['keyInfo'] = 'none';

        if (chordDisplaySettings.displayDegrees && chordDisplaySettings.displayTonic) {
          keyboardInfo = 'tonicAndInterval';
        }

        if (chordDisplaySettings.displayDegrees && !chordDisplaySettings.displayTonic) {
          keyboardInfo = 'interval';
        }

        if (!chordDisplaySettings.displayDegrees && chordDisplaySettings.displayTonic) {
          keyboardInfo = 'tonic';
        }

        const keyboardSettings: v1_6_0_KeyboardSettings = {
          skin: chordDisplaySettings.skin,
          from: chordDisplaySettings.from,
          to: chordDisplaySettings.to,
          label: chordDisplaySettings.displayNotes ? 'pitchClass' : 'none',
          keyName: chordDisplaySettings.displayKeyNames ? 'note' : 'none',
          keyInfo: keyboardInfo,
          fadeOutDuration: 0,
          textOpacity: 0.5,
          displaySustained: true,
          wrap: false,
          sizes: {
            radius: 0.4,
            height: chordDisplaySettings.skin === 'classic' ? 6 : 1.6,
            ratio: 0.6,
            bevel: true,
          },
          colors: {
            white: chordDisplaySettings.colorNoteWhite,
            black: chordDisplaySettings.colorNoteBlack,
            played: chordDisplaySettings.colorHighlight,
            wrapped: chordDisplaySettings.colorHighlight,
            sustained: '#777777',
          },
        };

        return {
          id: chordDisplaySettings.id,
          chordNotation: chordDisplaySettings.chordNotation,
          allowOmissions: !!chordDisplaySettings.allowOmissions,
          useSustain: true,
          highlightAlterations: !!chordDisplaySettings.highlightAlterations,
          displayKeyboard: !!chordDisplaySettings.displayKeyboard,
          displayChord: !!chordDisplaySettings.displayChord,
          displayName: !!chordDisplaySettings.displayName,
          displayNotation: !!chordDisplaySettings.displayNotation,
          displayAltChords: !!chordDisplaySettings.displayAltChords,
          displayIntervals: !!chordDisplaySettings.displayIntervals,
          keyboard: keyboardSettings,
        };
      }
    );

    store.set('settings.chordDisplay', newChordDisplay);
  },
  '1.7.0': (store: Conf<StoreType>) => {
    store.set('version', '1.7.0');
    store.set('windowState.changelogDismissed', null);

    const settings = store.get('settings') as unknown as v1_6_0_Settings;

    const newSettings: v1_7_0_Settings = {
      ...settings,
      chordDisplay: settings.chordDisplay.map(
        (chordDisplaySettings): v1_7_0_ChordDisplaySettings => ({
          ...chordDisplaySettings,
          detectOnRelease: true,
          chordNotation: 'preferred',
        })
      ),
      chordQuiz: {
        ...settings.chordQuiz,
        chordNotation: 'preferred',
      },
      chordDictionary: {
        interactive: 'play',
        hideDisabled: false,
        filterInKey: false,
        groupBy: 'none',
        defaultNotation: 'short',
        disabled: [],
        aliases: [['maj', '']],
      },
    };

    store.set('settings', newSettings);
  },
  '1.8.0': (store: Conf<StoreType>) => {
    store.set('version', '1.8.0');

    // dev builds may have saved part of the new settings: keep what is there
    const settings = store.get('settings') as unknown as v1_7_0_Settings &
      Partial<Pick<Settings, 'scaleQuiz' | 'scaleDegrees' | 'rhythmGame'>>;

    const newSettings: Settings = {
      ...settings,
      server: settings.server ?? { enabled: true, port: 25011 },
      general: {
        playNotes: false,
        soundVolume: 70,
        soundStyle: 'classical',
        ...settings.general,
      },
      chordQuiz: {
        chords: 'all',
        excludedChords: [],
        tonics: 'all',
        learningMode: false,
        fingering: 'right',
        displayRelative: false,
        retryUntilCorrect: false,
        progressionKey: 'random',
        excludedProgressions: [],
        customProgressions: '',
        ...settings.chordQuiz,
      },
      rhythmGame: settings.rhythmGame ?? defaultRhythmGameSettings,
      scaleQuiz: {
        practice: 'scales',
        soloKey: '9',
        soloScale: 'minor pentatonic',
        soloLength: 'medium',
        excludedMelodies: [],
        mode: 'random',
        tonics: 'all',
        scales: 'majorMinor',
        direction: 'up',
        requiredCleanRuns: 0,
        jumpBack: true,
        learningMode: false,
        fingering: 'right',
        gamification: true,
        displayReaction: true,
        displayNoteNames: false,
        displayFormula: true,
        displayRelative: false,
        ...settings.scaleQuiz,
      },
      scaleDegrees: {
        mode: 'random',
        tonics: 'all',
        scales: 'majorMinor',
        gameLength: 8,
        gamification: true,
        displayReaction: true,
        displayScaleNotes: false,
        displayDegreeName: true,
        displayRelative: false,
        learningMode: false,
        ...settings.scaleDegrees,
      },
    };

    store.set('settings', newSettings);
  },
};

export default migrations;

/** Rhythm game settings, as they were in the chord quiz (development builds of 1.8.0) */
type ChordQuizRhythmSettings = {
  mode?: string;
  tempo?: number;
  rhythmPattern?: RhythmGameSettings['pattern'];
  rhythmSongTempo?: boolean;
  excludedSongs?: string[];
  customSongs?: RhythmGameSettings['customSongs'];
  rhythmShowTitle?: RhythmGameSettings['showTitle'];
  rhythmSpeedUp?: boolean;
  rhythmOnMiss?: RhythmGameSettings['onMiss'];
  progressionKey?: RhythmGameSettings['songKey'];
  tonics?: RhythmGameSettings['tonics'];
  learningMode?: boolean;
  fingering?: RhythmGameSettings['fingering'];
  gamification?: boolean;
};

/**
 * The rhythm game moved from the chord quiz to its own module: its settings are moved
 * (on every start, as builds of the same version may not have them yet)
 */
export function upgradeSettings(store: Conf<StoreType>) {
  // MIDI devices routed to the chord quiz are also routed to the rhythm game
  const routes = (store.get('midi.routes') ?? []) as { input: string; output: string }[];
  const missing = routes.filter(
    (route) =>
      route.output === 'chord-quiz' &&
      !routes.some((r) => r.input === route.input && r.output === 'rhythm-game')
  );
  if (missing.length) {
    store.set('midi.routes', [
      ...routes,
      ...missing.map((route) => ({ ...route, output: 'rhythm-game' })),
    ]);
  }

  const settings = store.get('settings') as Settings;
  const chordQuiz = settings.chordQuiz as Settings['chordQuiz'] & ChordQuizRhythmSettings;
  if (settings.rhythmGame && chordQuiz.mode !== 'rhythm') return;

  const wasRhythm = chordQuiz.mode === 'rhythm';
  const rhythmGame: RhythmGameSettings = settings.rhythmGame ?? {
    ...defaultRhythmGameSettings,
    tempo: chordQuiz.tempo ?? defaultRhythmGameSettings.tempo,
    pattern: chordQuiz.rhythmPattern ?? defaultRhythmGameSettings.pattern,
    songTempo: chordQuiz.rhythmSongTempo ?? false,
    excludedSongs: chordQuiz.excludedSongs ?? [],
    customSongs: chordQuiz.customSongs ?? [],
    showTitle: chordQuiz.rhythmShowTitle ?? 'start',
    speedUp: chordQuiz.rhythmSpeedUp ?? false,
    onMiss: chordQuiz.rhythmOnMiss ?? 'continue',
    // the quiz options that applied to the rhythm game
    ...(wasRhythm && {
      songKey: chordQuiz.progressionKey ?? 'random',
      tonics: chordQuiz.tonics ?? 'all',
      learningMode: chordQuiz.learningMode ?? false,
      fingering: chordQuiz.fingering ?? 'right',
      gamification: chordQuiz.gamification ?? true,
    }),
  };

  store.set('settings', {
    ...settings,
    chordQuiz: { ...settings.chordQuiz, mode: wasRhythm ? 'random' : settings.chordQuiz.mode },
    rhythmGame,
  });
}
