import { ScaleQuizSettings } from 'main/types';
import { getFingeringHands, getScaleFingering, Hand, ScaleInfo } from 'renderer/helpers';

import { Step } from './reducer';

export type Fingers = Record<Hand, number[]>;

export { getOctaveShift } from './reducer';

export const getHands = (settings: ScaleQuizSettings): Hand[] =>
  settings.learningMode ? getFingeringHands(settings.fingering) : [];

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
