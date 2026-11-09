import { Interval, Note } from 'tonal';

import { STATUSES } from 'renderer/hooks/useQuiz';
import { ScaleQuizSettings } from 'main/types';
import { getRandomScale, isSamePitchClass, ScaleInfo } from 'renderer/helpers';

/** Wrong attempts on the same note before its name is revealed */
export const HINT_AFTER_MISTAKES = 2;

/** Scales per game in the score list */
export const SCALES_PER_GAME = 5;

const SCORE_NOTE = 100;
const SCORE_WRONG = -100;
const SCORE_PERFECT = 1000;
const SCORE_COMPLETE = 300;

export type Step = {
  /** pitch class to play */
  note: string;
  /** index in scale notes */
  degree: number;
  /** key shown on the learning keyboard (tonic in octave 4) */
  midi: number;
  /** position in the ascending octave (0 = tonic … last = top tonic), for fingering */
  upIndex: number;
};

export type Feedback = {
  index: number;
  status: STATUSES;
  score: number;
};

export type Game = { score: number };

export type State = {
  options: ScaleQuizSettings;
  key: string;
  scale: ScaleInfo;
  steps: Step[];
  position: number;
  mistakes: number;
  positionMistakes: number;
  /** clean runs in a row on the current scale */
  cleanRuns: number;
  /** no mistakes or jumps since the current run started */
  runClean: boolean;
  lastPlayed: { note: string; correct: boolean; back?: boolean; id: number } | null;
  feedback: Feedback;
  eventCount: number;
  completed: number;
  games: Game[];
  perfectStreak: number;
};

export function buildSteps(scale: ScaleInfo, direction: ScaleQuizSettings['direction']): Step[] {
  const tonicMidi = 60 + (Note.chroma(scale.tonic) ?? 0);
  const up = scale.notes.map((note, degree) => ({
    note,
    degree,
    midi: tonicMidi + (Interval.semitones(scale.intervals[degree]) ?? 0),
    upIndex: degree,
  }));
  up.push({ note: scale.notes[0], degree: 0, midi: tonicMidi + 12, upIndex: up.length });

  if (direction === 'down') {
    return [...up].reverse();
  }

  if (direction === 'upDown') {
    const down = [...up].reverse().slice(1);
    return [...up, ...down];
  }

  return up;
}

function newScale(options: ScaleQuizSettings, key: string, previous: ScaleInfo | null) {
  const scale = getRandomScale(
    options.scales,
    options.mode === 'randomInKey' ? key : null,
    previous
  );
  return { scale, steps: buildSteps(scale, options.direction) };
}

export function init({ options, key }: { options: ScaleQuizSettings; key: string }): State {
  return {
    options,
    key,
    ...newScale(options, key, null),
    position: 0,
    mistakes: 0,
    positionMistakes: 0,
    cleanRuns: 0,
    runClean: true,
    lastPlayed: null,
    feedback: { index: -1, status: STATUSES.none, score: 0 },
    eventCount: 0,
    completed: 0,
    games: [{ score: 0 }],
    perfectStreak: 0,
  };
}

export type Action =
  | { type: 'NOTE_ON'; midi: number; noteName: string }
  | { type: 'OPTIONS_CHANGED'; options: ScaleQuizSettings; key: string }
  | { type: 'SKIP' };

const addScore = (games: Game[], points: number) => {
  const next = [...games];
  const last = next[next.length - 1];
  next[next.length - 1] = { ...last, score: last.score + points };
  return next;
};

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'OPTIONS_CHANGED': {
      const { options, key } = action;
      const sameScales =
        key === state.key &&
        options.scales === state.options.scales &&
        options.mode === state.options.mode &&
        options.direction === state.options.direction;

      // display options do not restart the current scale
      if (sameScales) {
        return { ...state, options };
      }

      return {
        ...init({ options, key }),
        games: state.games,
        completed: state.completed,
      };
    }

    case 'SKIP':
      return {
        ...state,
        ...newScale(state.options, state.key, state.scale),
        position: 0,
        mistakes: 0,
        positionMistakes: 0,
        cleanRuns: 0,
        runClean: true,
        perfectStreak: 0,
      };

    case 'NOTE_ON': {
      const step = state.steps[state.position];
      const correct = isSamePitchClass(action.midi, step.note);
      const eventCount = state.eventCount + 1;
      const played = correct ? step.note : Note.pitchClass(action.noteName);
      const lastPlayed = { note: played, correct, id: eventCount };

      if (!correct && state.options.jumpBack) {
        // Find the closest earlier step with this note and continue from there
        let back = -1;
        for (let i = state.position - 1; i >= 0; i -= 1) {
          if (isSamePitchClass(action.midi, state.steps[i].note)) {
            back = i;
            break;
          }
        }

        // Re-striking the note just played: ignore it
        if (back !== -1 && back === state.position - 1) {
          return state;
        }

        if (back !== -1) {
          return {
            ...state,
            eventCount,
            lastPlayed: { note: state.steps[back].note, correct: true, back: true, id: eventCount },
            position: back + 1,
            positionMistakes: 0,
            // going back to the very first note starts a fresh run
            runClean: back === 0,
          };
        }
      }

      if (!correct) {
        return {
          ...state,
          eventCount,
          lastPlayed,
          mistakes: state.mistakes + 1,
          positionMistakes: state.positionMistakes + 1,
          runClean: false,
          perfectStreak: 0,
          games: addScore(state.games, SCORE_WRONG),
          feedback: {
            index: eventCount,
            status: STATUSES.different,
            score: SCORE_WRONG,
          },
        };
      }

      const position = state.position + 1;

      // Scale not finished yet
      if (position < state.steps.length) {
        return {
          ...state,
          eventCount,
          lastPlayed,
          position,
          positionMistakes: 0,
          games: addScore(state.games, SCORE_NOTE),
        };
      }

      // Run finished: check if enough clean runs were played
      const required = state.options.requiredCleanRuns;
      const cleanRuns = state.runClean ? state.cleanRuns + 1 : 0;

      if (required > 0 && cleanRuns < required) {
        return {
          ...state,
          eventCount,
          lastPlayed,
          position: 0,
          positionMistakes: 0,
          cleanRuns,
          runClean: true,
          games: addScore(state.games, SCORE_NOTE),
          feedback: {
            index: eventCount,
            status: state.runClean ? STATUSES.equal : STATUSES.different,
            score: SCORE_NOTE,
          },
        };
      }

      // Scale completed
      const perfect = state.mistakes === 0 && state.runClean;
      const bonus = perfect ? SCORE_PERFECT * (1 + state.perfectStreak * 0.25) : SCORE_COMPLETE;
      const points = Math.round(SCORE_NOTE + bonus);
      const completed = state.completed + 1;
      let games = addScore(state.games, points);
      if (completed % SCALES_PER_GAME === 0) {
        games = [...games, { score: 0 }];
      }

      return {
        ...state,
        ...newScale(state.options, state.key, state.scale),
        eventCount,
        lastPlayed,
        position: 0,
        mistakes: 0,
        positionMistakes: 0,
        cleanRuns: 0,
        runClean: true,
        completed,
        games,
        perfectStreak: perfect ? state.perfectStreak + 1 : 0,
        feedback: {
          index: eventCount,
          status: perfect ? STATUSES.superset : STATUSES.equal,
          score: points,
        },
      };
    }

    default:
      return state;
  }
}
