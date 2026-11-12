import { Interval, Note } from 'tonal';

import { STATUSES } from 'renderer/hooks/useQuiz';
import { ScaleQuizSettings } from 'main/types';
import {
  clampOctaveShift,
  generateSoloPhrase,
  getBestScaleForChroma,
  getIncludedMelodies,
  getMelodyNotes,
  getRandomScale,
  getScaleInfo,
  getScaleInSequence,
  isSamePitchClass,
  randomPick,
  ScaleInfo,
} from 'renderer/helpers';
import { addScore, NO_FEEDBACK, QuizFeedback, ScoreGame } from 'renderer/helpers/quiz';

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

export type Feedback = QuizFeedback;
export type Game = ScoreGame;

export type State = {
  options: ScaleQuizSettings;
  key: string;
  scale: ScaleInfo;
  steps: Step[];
  /** index of the scale when playing scales in order */
  sequenceIndex: number;
  position: number;
  mistakes: number;
  positionMistakes: number;
  /** clean runs in a row on the current scale */
  cleanRuns: number;
  /** no mistakes or jumps since the current run started */
  runClean: boolean;
  lastPlayed: { note: string; correct: boolean; back?: boolean; id: number } | null;
  /** last note accepted, kept across scales: striking it again (other hand, other octave) is ignored */
  lastAccepted: string | null;
  feedback: Feedback;
  eventCount: number;
  completed: number;
  games: Game[];
  perfectStreak: number;
  /** furthest step reached in the current run: going back does not score these steps again */
  bestPosition: number;
  /** keys accepted and still held, shown as correct on the learning keyboard */
  acceptedMidi: number[];
  /** octaves between the played keys and the learning keyboard default octave */
  octaveShift: number;
  /** last scale finished and the scale that follows, shown for a moment */
  transition: { id: number; from: string; to: string } | null;
  /**
   * the melody played (melodies, or a solo phrase), in the key of `scale`:
   * shown as `title` and `subtitle`, announced as `name` when done
   */
  melody: { id: string; title: string; subtitle: string; name: string } | null;
};

/**
 * Octaves between the played key and the key displayed for the same step
 */
export const getOctaveShift = (step: Step, midi: number) =>
  clampOctaveShift(Math.round((midi - step.midi) / 12));

/**
 * First step of the direction being played: the top of the scale once going down
 * in "up and back down", the first step otherwise
 */
const getDirectionStart = (steps: Step[], position: number) => {
  const top = steps.reduce((best, step, i) => (step.midi > steps[best].midi ? i : best), 0);
  return position > top ? top : 0;
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

const NATURAL_CHROMAS = [0, 2, 4, 5, 7, 9, 11];
const ALL_CHROMAS = Array.from({ length: 12 }, (_, chroma) => chroma);

/**
 * A melody in a major key: random, in order from C to B, or the current key
 */
function newMelody(
  options: ScaleQuizSettings,
  key: string,
  sequenceIndex: number,
  previousMelody: string | null
) {
  const chromas = options.tonics === 'natural' ? NATURAL_CHROMAS : ALL_CHROMAS;
  let scale: ScaleInfo;
  if (options.mode === 'randomInKey') scale = getScaleInfo(key, 'major');
  else if (options.mode === 'sequential')
    scale = getBestScaleForChroma(chromas[sequenceIndex % chromas.length], 'major');
  else scale = getBestScaleForChroma(randomPick(chromas), 'major');

  // not the same melody twice in a row
  const melodies = getIncludedMelodies(options.excludedMelodies);
  const melody = randomPick(
    melodies.length > 1 ? melodies.filter((m) => m.id !== previousMelody) : melodies
  );

  const steps: Step[] = getMelodyNotes(melody, scale.tonic).map((n, upIndex) => ({
    ...n,
    upIndex,
  }));
  return {
    scale,
    steps,
    sequenceIndex,
    melody: {
      id: melody.id,
      title: melody.title,
      subtitle: `in ${scale.label}`,
      name: melody.title,
    },
  };
}

/**
 * A random phrase in the key and scale of the backing track
 *
 * @param phrase - number of the phrase, from 0
 */
function newSoloPhrase(options: ScaleQuizSettings, key: string, phrase: number) {
  const type = options.soloScale || 'minor pentatonic';
  const scale =
    options.soloKey === 'current'
      ? getScaleInfo(key, type)
      : getBestScaleForChroma(Number(options.soloKey ?? 9), type);

  const steps: Step[] = generateSoloPhrase(scale, options.soloLength ?? 'medium').map(
    (n, upIndex) => ({ ...n, upIndex })
  );
  return {
    scale,
    steps,
    sequenceIndex: phrase,
    melody: {
      id: `solo-${phrase}`,
      title: scale.label,
      subtitle: `Solo · phrase ${phrase + 1}`,
      name: `Phrase ${phrase + 1}`,
    },
  };
}

function newScale(
  options: ScaleQuizSettings,
  key: string,
  previous: ScaleInfo | null,
  sequenceIndex: number,
  previousMelody: string | null = null
) {
  if (options.practice === 'melodies') {
    return newMelody(options, key, sequenceIndex, previousMelody);
  }
  if (options.practice === 'solo') {
    return newSoloPhrase(options, key, sequenceIndex);
  }

  const naturalOnly = options.tonics === 'natural';
  const scale =
    options.mode === 'sequential'
      ? getScaleInSequence(options.scales, sequenceIndex, naturalOnly)
      : getRandomScale(
          options.scales,
          options.mode === 'randomInKey' ? key : null,
          previous,
          naturalOnly
        );
  return { scale, steps: buildSteps(scale, options.direction), sequenceIndex, melody: null };
}

export function init({ options, key }: { options: ScaleQuizSettings; key: string }): State {
  return {
    options,
    key,
    ...newScale(options, key, null, 0),
    position: 0,
    mistakes: 0,
    positionMistakes: 0,
    cleanRuns: 0,
    runClean: true,
    lastPlayed: null,
    lastAccepted: null,
    feedback: NO_FEEDBACK,
    eventCount: 0,
    completed: 0,
    games: [{ score: 0 }],
    perfectStreak: 0,
    bestPosition: 0,
    acceptedMidi: [],
    octaveShift: 0,
    transition: null,
  };
}

export type Action =
  | { type: 'NOTE_ON'; midi: number; noteName: string }
  | { type: 'OPTIONS_CHANGED'; options: ScaleQuizSettings; key: string }
  | { type: 'SKIP' }
  /** keys currently held: released keys are no longer shown as accepted */
  | { type: 'NOTES_HELD'; midi: number[] };

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'OPTIONS_CHANGED': {
      const { options, key } = action;
      const sameScales =
        key === state.key &&
        options.scales === state.options.scales &&
        options.mode === state.options.mode &&
        options.tonics === state.options.tonics &&
        options.direction === state.options.direction &&
        options.practice === state.options.practice &&
        options.soloKey === state.options.soloKey &&
        options.soloScale === state.options.soloScale &&
        options.soloLength === state.options.soloLength &&
        (options.excludedMelodies ?? []).join() === (state.options.excludedMelodies ?? []).join();

      // display options do not restart the current scale
      if (sameScales) {
        return { ...state, options };
      }

      return {
        ...init({ options, key }),
        games: state.games,
        completed: state.completed,
        octaveShift: state.octaveShift,
      };
    }

    case 'SKIP':
      return {
        ...state,
        ...newScale(
          state.options,
          state.key,
          state.scale,
          state.sequenceIndex + 1,
          state.melody?.id
        ),
        position: 0,
        mistakes: 0,
        positionMistakes: 0,
        cleanRuns: 0,
        runClean: true,
        perfectStreak: 0,
        bestPosition: 0,
      };

    case 'NOTES_HELD': {
      const acceptedMidi = state.acceptedMidi.filter((m) => action.midi.includes(m));
      return acceptedMidi.length === state.acceptedMidi.length ? state : { ...state, acceptedMidi };
    }

    case 'NOTE_ON': {
      const step = state.steps[state.position];
      const correct = isSamePitchClass(action.midi, step.note);
      const eventCount = state.eventCount + 1;
      const played = correct ? step.note : Note.pitchClass(action.noteName);
      const lastPlayed = { note: played, correct, id: eventCount };
      const acceptedMidi = [...state.acceptedMidi, action.midi];

      // Re-striking the note just played (other hand, other octave, double trigger): not a mistake,
      // even when that note ended the previous scale
      if (!correct && state.lastAccepted && isSamePitchClass(action.midi, state.lastAccepted)) {
        return { ...state, acceptedMidi };
      }

      // melodies go back and forth: no jumping back, a wrong note is a mistake
      if (!correct && state.options.jumpBack && !state.melody) {
        // Find the closest earlier step with this note, in the direction being played
        // (a wrong note on the way down does not go back to the way up)
        const start = getDirectionStart(state.steps, state.position);
        let back = -1;
        for (let i = state.position - 1; i >= start; i -= 1) {
          if (isSamePitchClass(action.midi, state.steps[i].note)) {
            back = i;
            break;
          }
        }

        if (back !== -1) {
          return {
            ...state,
            eventCount,
            acceptedMidi,
            octaveShift: getOctaveShift(state.steps[back], action.midi),
            lastPlayed: { note: state.steps[back].note, correct: true, back: true, id: eventCount },
            lastAccepted: state.steps[back].note,
            position: back + 1,
            positionMistakes: 0,
            // going back to the very first note starts a fresh run, anywhere else breaks the streak
            runClean: back === 0,
            cleanRuns: back === 0 ? state.cleanRuns : 0,
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
          // a mistake breaks the streak right away
          runClean: false,
          cleanRuns: 0,
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
      // steps already scored in this run (before jumping back) give no points
      const notePoints = position > state.bestPosition ? SCORE_NOTE : 0;
      const bestPosition = Math.max(position, state.bestPosition);
      const octaveShift = getOctaveShift(step, action.midi);

      // Scale not finished yet
      if (position < state.steps.length) {
        return {
          ...state,
          eventCount,
          lastPlayed,
          lastAccepted: step.note,
          acceptedMidi,
          octaveShift,
          position,
          bestPosition,
          positionMistakes: 0,
          games: addScore(state.games, notePoints),
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
          lastAccepted: step.note,
          acceptedMidi,
          octaveShift,
          position: 0,
          bestPosition: 0,
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

      const next = newScale(
        state.options,
        state.key,
        state.scale,
        state.sequenceIndex + 1,
        state.melody?.id
      );

      return {
        ...state,
        ...next,
        transition: {
          id: completed,
          from: state.melody?.name ?? state.scale.label,
          to: next.melody?.name ?? next.scale.label,
        },
        eventCount,
        lastPlayed,
        lastAccepted: step.note,
        acceptedMidi,
        octaveShift,
        position: 0,
        bestPosition: 0,
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
