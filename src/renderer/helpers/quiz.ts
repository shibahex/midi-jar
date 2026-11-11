// Not exported from helpers/index: it depends on the quiz hook, which depends on helpers.
import { STATUSES } from 'renderer/hooks/useQuiz';

/** A game entry in the score list (QuizGameList) */
export type ScoreGame = { score: number };

/** Last answer, shown by QuizReaction */
export type QuizFeedback = { index: number; status: STATUSES; score: number };

export const NO_FEEDBACK: QuizFeedback = { index: -1, status: STATUSES.none, score: 0 };

/** Adds points to the current game */
export const addScore = (games: ScoreGame[], points: number): ScoreGame[] => {
  const next = [...games];
  const last = next[next.length - 1];
  next[next.length - 1] = { ...last, score: last.score + points };
  return next;
};

/** Starts a new game, unless the current one has not been played yet */
export const startNewGame = (games: ScoreGame[]): ScoreGame[] =>
  games[games.length - 1].score ? [...games, { score: 0 }] : games;
