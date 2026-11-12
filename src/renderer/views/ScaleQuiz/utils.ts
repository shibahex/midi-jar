import { ScaleQuizSettings } from 'main/types';
import { getFingeringHands, getScaleFingering, Hand, ScaleInfo } from 'renderer/helpers';

import { Step } from './reducer';

export type Fingers = Record<Hand, number[]>;

export { getOctaveShift } from './reducer';

export const getHands = (settings: ScaleQuizSettings): Hand[] =>
  settings.learningMode ? getFingeringHands(settings.fingering) : [];

/**
 * A box per note of the scale (low to high), however the scale is played.
 * - done: played in the direction being played now
 * - passed: played earlier, on the way up, still to play on the way down
 */
export type StepBox = {
  step: Step;
  current: boolean;
  done: boolean;
  passed: boolean;
};

export const getStepBoxes = (steps: Step[], position: number) => {
  // highest step: where "up and back down" turns around
  const top = steps.reduce((best, step, i) => (step.midi > steps[best].midi ? i : best), 0);
  const turnsAround = top > 0 && top < steps.length - 1;
  const goingDown = turnsAround ? position > top : top === 0 && steps.length > 1;
  // steps of the direction being played: [from, to]
  let from = 0;
  let to = steps.length - 1;
  if (turnsAround) {
    if (goingDown) from = top;
    else to = top;
  }
  const currentUpIndex = steps[position]?.upIndex;

  const boxes: StepBox[] = [...new Set(steps.map((step) => step.upIndex))]
    .sort((a, b) => a - b)
    .map((upIndex) => {
      const visits = steps.flatMap((step, i) => (step.upIndex === upIndex ? [i] : []));
      const done = visits.some((i) => i >= from && i <= to && i < position);
      return {
        step: steps[visits[0]],
        current: upIndex === currentUpIndex,
        done,
        passed: !done && visits.some((i) => i < position),
      };
    });

  // the direction is only worth showing when the scale goes down
  return { boxes, goingDown, showDirection: turnsAround || goingDown };
};

/** A box per note, in the order they are played (melodies) */
export const getSequentialBoxes = (steps: Step[], position: number) => ({
  boxes: steps.map(
    (step, index): StepBox => ({
      step,
      current: index === position,
      done: index < position,
      passed: false,
    })
  ),
  goingDown: false,
  showDirection: false,
});

/**
 * Fingers for each note of the ascending octave, indexed by `Step.upIndex`
 */
export const getFingers = (scale: ScaleInfo, steps: Step[]): Fingers => {
  const midis: number[] = [];
  steps.forEach((step) => {
    midis[step.upIndex] = step.midi;
  });

  return {
    right: getScaleFingering(scale.type, midis, 'right'),
    left: getScaleFingering(scale.type, midis, 'left'),
  };
};
