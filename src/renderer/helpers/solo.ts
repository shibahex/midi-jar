import { Note } from 'tonal';

import { ScaleInfo } from './scales';

/** Scales to solo with, over a backing track */
export const SOLO_SCALES = [
  'minor pentatonic',
  'major pentatonic',
  'blues',
  'major',
  'minor',
  'dorian',
  'mixolydian',
  'harmonic minor',
];

const PHRASE_LENGTHS = { short: [4, 6], medium: [6, 9], long: [9, 12] } as const;

/** keys of the learning keyboard (C4 to B5) */
const LOWEST = 60;
const HIGHEST = 83;

/** Keys of a scale on the learning keyboard */
export function getScaleKeys(scale: ScaleInfo) {
  const chromas = scale.notes.map((n) => Note.chroma(n));
  const keys: number[] = [];
  for (let midi = LOWEST; midi <= HIGHEST; midi += 1) {
    if (chromas.includes(midi % 12)) keys.push(midi);
  }
  return keys;
}

const randomInt = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1));

// how far a phrase moves from a note to the next, in scale steps
const MOVES: [number, number][] = [
  [1, 50], // step
  [2, 25], // skip
  [3, 12],
  [4, 5], // leap
  [0, 4], // same note again
];

function randomMove() {
  const total = MOVES.reduce((sum, [, weight]) => sum + weight, 0);
  let pick = Math.random() * total;
  const move = MOVES.find(([, weight]) => {
    pick -= weight;
    return pick < 0;
  });
  return move ? move[0] : 1;
}

/**
 * A random phrase in a scale: starts on the tonic or a note of the tonic chord,
 * moves mostly by step, and ends on the tonic or the fifth.
 */
export function generateSoloPhrase(scale: ScaleInfo, length: keyof typeof PHRASE_LENGTHS) {
  const keys = getScaleKeys(scale);
  const degreeOf = (midi: number) =>
    scale.notes.findIndex((n) => Note.chroma(n) === ((midi % 12) + 12) % 12);
  const [min, max] = PHRASE_LENGTHS[length] ?? PHRASE_LENGTHS.medium;
  const count = randomInt(min, max);

  // start in the middle of the keyboard, on the tonic or a note close to it
  const middle = keys.filter((m) => m >= 64 && m <= 76);
  const tonics = middle.filter((m) => degreeOf(m) === 0);
  let index = keys.indexOf(tonics.length ? tonics[0] : middle[0] ?? keys[0]);
  index += randomInt(0, 2);

  const indexes = [index];
  while (indexes.length < count - 1) {
    const move = randomMove() * (Math.random() < 0.5 ? -1 : 1);
    // bounce back from the ends of the keyboard
    const next = Math.min(keys.length - 1, Math.max(0, index + move));
    index = next === index && move !== 0 ? index - Math.sign(move) : next;
    indexes.push(index);
  }

  // end on the closest tonic or fifth (resolves the phrase), moving to it
  const fifth = scale.intervals.indexOf('5P');
  const endings = keys
    .map((midi, i) => ({ midi, i }))
    .filter(({ midi, i }) => (degreeOf(midi) === 0 || degreeOf(midi) === fifth) && i !== index);
  const ending = endings.reduce((best, e) =>
    Math.abs(e.i - index) < Math.abs(best.i - index) ? e : best
  );
  indexes.push(ending.i);

  return indexes.map((i) => {
    const midi = keys[i];
    const degree = degreeOf(midi);
    return { note: scale.notes[degree], degree, midi };
  });
}
