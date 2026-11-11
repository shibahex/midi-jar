import { Note } from 'tonal';

import { STATUSES } from 'renderer/hooks/useQuiz';
import { ScaleDegreesSettings } from 'main/types';
import { getRandomScale, isSamePitchClass, ScaleInfo } from 'renderer/helpers';
import {
  addScore,
  NO_FEEDBACK,
  QuizFeedback,
  ScoreGame,
  startNewGame,
} from 'renderer/helpers/quiz';

/** Wrong attempts before the answer is revealed */
export const REVEAL_AFTER_MISTAKES = 2;

const SCORE_CORRECT = 100;
const SCORE_WRONG = -100;
const SCORE_SPEED_MAX = 400; // bonus when answering instantly, decreasing to 0 after 4s
const SCORE_STREAK = 20; // bonus per correct answer in a row
const FAST_ANSWER_MS = 1500;

export type Feedback = QuizFeedback;

export type State = {
  options: ScaleDegreesSettings;
  key: string;
  scale: ScaleInfo;
  degree: number;
  questionIndex: number;
  askedAt: number;
  mistakes: number;
  found: number[];
  streak: number;
  bestStreak: number;
  games: ScoreGame[];
  feedback: Feedback;
  eventCount: number;
  lastPlayed: { note: string; correct: boolean; id: number } | null;
  lastAnswerMs: number | null;
};

function randomDegree(scale: ScaleInfo, previous: number | null) {
  let degree;
  do {
    degree = Math.floor(Math.random() * scale.notes.length);
  } while (degree === previous && scale.notes.length > 1);
  return degree;
}

function newScale(options: ScaleDegreesSettings, key: string, previous: ScaleInfo | null) {
  const scale = getRandomScale(
    options.scales,
    options.mode === 'randomInKey' ? key : null,
    previous
  );
  return {
    scale,
    degree: randomDegree(scale, null),
    questionIndex: 0,
    found: [] as number[],
  };
}

export function init({
  options,
  key,
  time,
}: {
  options: ScaleDegreesSettings;
  key: string;
  time: number;
}): State {
  return {
    options,
    key,
    ...newScale(options, key, null),
    askedAt: time,
    mistakes: 0,
    streak: 0,
    bestStreak: 0,
    games: [{ score: 0 }],
    feedback: NO_FEEDBACK,
    eventCount: 0,
    lastPlayed: null,
    lastAnswerMs: null,
  };
}

export type Action =
  | { type: 'NOTE_ON'; midi: number; noteName: string; time: number }
  | {
      type: 'OPTIONS_CHANGED';
      options: ScaleDegreesSettings;
      key: string;
      time: number;
    }
  | { type: 'SKIP'; time: number };

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'OPTIONS_CHANGED': {
      const { options, key } = action;

      // display options do not restart the current scale
      if (
        key === state.key &&
        options.scales === state.options.scales &&
        options.mode === state.options.mode
      ) {
        return { ...state, options };
      }

      return {
        ...init({ options, key, time: action.time }),
        games: startNewGame(state.games),
        bestStreak: state.bestStreak,
      };
    }

    case 'SKIP':
      return {
        ...state,
        ...newScale(state.options, state.key, state.scale),
        games: startNewGame(state.games),
        askedAt: action.time,
        mistakes: 0,
        streak: 0,
      };

    case 'NOTE_ON': {
      const target = state.scale.notes[state.degree];
      const correct = isSamePitchClass(action.midi, target);
      const eventCount = state.eventCount + 1;
      const lastPlayed = {
        note: correct ? target : Note.pitchClass(action.noteName),
        correct,
        id: eventCount,
      };

      if (!correct) {
        return {
          ...state,
          eventCount,
          lastPlayed,
          mistakes: state.mistakes + 1,
          streak: 0,
          games: addScore(state.games, SCORE_WRONG),
          feedback: {
            index: eventCount,
            status: STATUSES.different,
            score: SCORE_WRONG,
          },
        };
      }

      const elapsed = Math.max(0, action.time - state.askedAt);
      const clean = state.mistakes === 0;
      const streak = clean ? state.streak + 1 : 0;
      const speedBonus = clean
        ? Math.max(0, Math.round(SCORE_SPEED_MAX * (1 - elapsed / 4000)))
        : 0;
      const points = SCORE_CORRECT + speedBonus + streak * SCORE_STREAK;
      const found = state.found.includes(state.degree)
        ? state.found
        : [...state.found, state.degree];

      let games = addScore(state.games, points);
      let next: Pick<State, 'scale' | 'degree' | 'questionIndex' | 'found'>;

      if (state.questionIndex + 1 >= state.options.gameLength) {
        next = newScale(state.options, state.key, state.scale);
        games = [...games, { score: 0 }];
      } else {
        next = {
          scale: state.scale,
          degree: randomDegree(state.scale, state.degree),
          questionIndex: state.questionIndex + 1,
          found,
        };
      }

      return {
        ...state,
        ...next,
        games,
        eventCount,
        lastPlayed,
        askedAt: action.time,
        mistakes: 0,
        streak,
        bestStreak: Math.max(state.bestStreak, streak),
        lastAnswerMs: elapsed,
        feedback: {
          index: eventCount,
          status: clean && elapsed < FAST_ANSWER_MS ? STATUSES.superset : STATUSES.equal,
          score: points,
        },
      };
    }

    default:
      return state;
  }
}
