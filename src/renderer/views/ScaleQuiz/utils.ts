import { ScaleQuizSettings } from 'main/types';
import { getScaleFingering, Hand, isSamePitchClass, ScaleInfo } from 'renderer/helpers';

import { Step } from './reducer';

export type Fingers = Record<Hand, number[]>;

/**
 * Step matched by a played key: the expected one, or an earlier one when jumping back
 */
export const getPlayedStep = (
  steps: Step[],
  position: number,
  midi: number,
  jumpBack: boolean
): Step | undefined => {
  if (steps[position] && isSamePitchClass(midi, steps[position].note)) return steps[position];
  if (!jumpBack) return undefined;
  return steps
    .slice(0, position)
    .reverse()
    .find((step) => isSamePitchClass(midi, step.note));
};

const MIN_OCTAVE_SHIFT = -3;
const MAX_OCTAVE_SHIFT = 2;

/**
 * Octaves between the played key and the key displayed for the same step
 */
export const getOctaveShift = (step: Step, midi: number) =>
  Math.min(MAX_OCTAVE_SHIFT, Math.max(MIN_OCTAVE_SHIFT, Math.round((midi - step.midi) / 12)));

export const getHands = (settings: ScaleQuizSettings): Hand[] => {
  if (!settings.learningMode || settings.fingering === 'none') return [];
  if (settings.fingering === 'both') return ['right', 'left'];
  return [settings.fingering];
};

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
