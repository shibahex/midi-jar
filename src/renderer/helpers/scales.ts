import { Interval, Note, Scale } from 'tonal';

import { ScaleSet } from 'main/types';

import { randomPick } from './array';
import { formatSharpsFlats } from './note';

export type ScaleInfo = {
  /** e.g. "D dorian" (tonal name) */
  id: string;
  /** Display name, e.g. "D Dorian" */
  label: string;
  tonic: string;
  type: string;
  notes: string[];
  intervals: string[];
};

const MODES = ['major', 'dorian', 'phrygian', 'lydian', 'mixolydian', 'minor', 'locrian'];
const MINORS = ['minor', 'harmonic minor', 'melodic minor'];
const PENTATONICS = ['major pentatonic', 'minor pentatonic', 'blues'];

export const SCALE_SETS: Record<ScaleSet, string[]> = {
  major: ['major'],
  minor: ['minor'],
  majorMinor: ['major', 'minor'],
  modes: MODES,
  minors: MINORS,
  pentatonics: PENTATONICS,
  all: Array.from(new Set([...MODES, ...MINORS, ...PENTATONICS])),
};

// Possible spellings for each chroma, the least altered resulting scale wins.
const TONIC_SPELLINGS = [
  ['C', 'B#'],
  ['Db', 'C#'],
  ['D'],
  ['Eb', 'D#'],
  ['E', 'Fb'],
  ['F', 'E#'],
  ['F#', 'Gb'],
  ['G'],
  ['Ab', 'G#'],
  ['A'],
  ['Bb', 'A#'],
  ['B', 'Cb'],
];

const titleCase = (str: string) => str.replace(/\b\w/g, (c) => c.toUpperCase());

/** Counts accidentals of a scale, double accidentals are heavily penalized */
const alterationCost = (notes: string[]) =>
  notes.reduce((cost, note) => {
    const { acc } = Note.get(note);
    return cost + (acc.length > 1 ? 10 : acc.length);
  }, 0);

export function getScaleInfo(tonic: string, type: string): ScaleInfo {
  const scale = Scale.get(`${tonic} ${type}`);
  const typeLabel = type === 'minor' ? 'Natural Minor' : titleCase(type);

  return {
    id: `${tonic} ${type}`,
    label: `${formatSharpsFlats(tonic)} ${typeLabel}`,
    tonic,
    type,
    notes: scale.notes,
    intervals: scale.intervals,
  };
}

/**
 * Returns the most readable spelling of a scale for a given tonic chroma.
 */
export function getBestScaleForChroma(chroma: number, type: string): ScaleInfo {
  const candidates = TONIC_SPELLINGS[((chroma % 12) + 12) % 12].map((t) => getScaleInfo(t, type));

  return candidates.reduce((best, s) =>
    alterationCost(s.notes) < alterationCost(best.notes) ? s : best
  );
}

/**
 * Picks a random scale in a scale set.
 *
 * @param set - the scale set to pick from
 * @param tonic - a fixed tonic, or null for a random one
 * @param previous - a scale to avoid picking twice in a row
 */
export function getRandomScale(
  set: ScaleSet,
  tonic: string | null,
  previous?: ScaleInfo | null
): ScaleInfo {
  const types = SCALE_SETS[set] ?? SCALE_SETS.majorMinor;
  let scale: ScaleInfo;
  let attempts = 0;

  do {
    const type = randomPick(types);
    const chroma = tonic !== null ? Note.chroma(tonic) ?? 0 : Math.floor(Math.random() * 12);
    scale = getBestScaleForChroma(chroma, type);
    attempts += 1;
  } while (previous && previous.id === scale.id && attempts < 10);

  return scale;
}

/**
 * Returns a degree label for a scale interval (e.g. "3m" => "♭3", "4A" => "♯4")
 */
export function getDegreeLabel(interval: string) {
  const { num, q } = Interval.get(interval);
  if (q === 'm' || q === 'd') return `♭${num}`;
  if (q === 'A') return `♯${num}`;
  return `${num}`;
}

export function getOrdinal(n: number) {
  const suffix = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${suffix[(v - 20) % 10] || suffix[v] || suffix[0]}`;
}

const DEGREE_NAMES = ['Tonic', 'Supertonic', 'Mediant', 'Subdominant', 'Dominant', 'Submediant'];

/**
 * Returns the functional name of a scale degree (heptatonic scales only)
 */
export function getDegreeName(scale: ScaleInfo, degreeIndex: number) {
  if (scale.intervals.length !== 7) return null;
  if (degreeIndex === 6) return scale.intervals[6] === '7M' ? 'Leading Tone' : 'Subtonic';
  return DEGREE_NAMES[degreeIndex] ?? null;
}

export const isSamePitchClass = (a: string | number, b: string | number) => {
  const ca = typeof a === 'number' ? a % 12 : Note.chroma(a);
  const cb = typeof b === 'number' ? b % 12 : Note.chroma(b);
  return ca !== undefined && ca === cb;
};
