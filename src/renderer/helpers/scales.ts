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

const NATURAL_CHROMAS = [0, 2, 4, 5, 7, 9, 11];

const getChromas = (naturalOnly: boolean) =>
  naturalOnly ? NATURAL_CHROMAS : Array.from({ length: 12 }, (_, chroma) => chroma);

// Degree of the major key each scale type starts on (C major / A minor → D dorian, A minor…)
const DEGREE_IN_KEY: Record<string, number> = {
  major: 0,
  dorian: 1,
  phrygian: 2,
  lydian: 3,
  mixolydian: 4,
  minor: 5,
  locrian: 6,
  'harmonic minor': 5,
  'melodic minor': 5,
  'major pentatonic': 0,
  'minor pentatonic': 5,
  blues: 5,
};

/**
 * Scale of a type that belongs to a key: E phrygian or A minor for the key of C
 *
 * @param key - the tonic of the major key (notation key setting)
 */
export function getScaleInKey(key: string, type: string): ScaleInfo {
  const keyNotes = Scale.get(`${key} major`).notes;
  const tonic = keyNotes[DEGREE_IN_KEY[type] ?? 0] ?? key;
  return getScaleInfo(tonic, type);
}

/**
 * Picks a random scale in a scale set.
 *
 * @param set - the scale set to pick from
 * @param tonic - the major key the scale belongs to, or null for a random tonic
 * @param previous - a scale to avoid picking twice in a row
 * @param naturalOnly - only pick tonics without sharps or flats
 */
export function getRandomScale(
  set: ScaleSet,
  tonic: string | null,
  previous?: ScaleInfo | null,
  naturalOnly = false
): ScaleInfo {
  const types = SCALE_SETS[set] ?? SCALE_SETS.majorMinor;
  let scale: ScaleInfo;
  let attempts = 0;

  do {
    const type = randomPick(types);
    scale =
      tonic !== null
        ? getScaleInKey(tonic, type)
        : getBestScaleForChroma(randomPick(getChromas(naturalOnly)), type);
    attempts += 1;
  } while (previous && previous.id === scale.id && attempts < 10);

  return scale;
}

/**
 * Scales in order, from C to B, every type of the set for each tonic
 */
export function getScaleSequence(set: ScaleSet, naturalOnly = false) {
  const types = SCALE_SETS[set] ?? SCALE_SETS.majorMinor;
  return getChromas(naturalOnly).flatMap((chroma) => types.map((type) => ({ chroma, type })));
}

export function getScaleInSequence(set: ScaleSet, index: number, naturalOnly = false) {
  const sequence = getScaleSequence(set, naturalOnly);
  const { chroma, type } = sequence[index % sequence.length];
  return getBestScaleForChroma(chroma, type);
}

// Degree of a scale where its relative scale starts, and the type of that scale
const RELATIVES: Record<string, { degree: number; type: string }> = {
  major: { degree: 5, type: 'minor' },
  minor: { degree: 2, type: 'major' },
  'harmonic minor': { degree: 2, type: 'major' },
  'melodic minor': { degree: 2, type: 'major' },
  'major pentatonic': { degree: 4, type: 'minor pentatonic' },
  'minor pentatonic': { degree: 1, type: 'major pentatonic' },
  blues: { degree: 1, type: 'major pentatonic' },
  // modes share the notes of their parent major scale
  ...Object.fromEntries(
    MODES.filter((mode) => mode !== 'major' && mode !== 'minor').map((mode) => [
      mode,
      { degree: 7 - MODES.indexOf(mode), type: 'major' },
    ])
  ),
};

/**
 * Returns the relative scale (A minor for C major, C major for D dorian...), or null if there is none
 */
export function getRelativeScale(scale: ScaleInfo): ScaleInfo | null {
  const relative = RELATIVES[scale.type];
  const tonic = relative && scale.notes[relative.degree];
  return tonic ? getScaleInfo(tonic, relative.type) : null;
}

/**
 * Returns the relative key of a major or minor chord (A minor for C, C major for Am),
 * or null for other chords (diminished, augmented, sus...)
 */
export function getChordRelativeKey(tonic: string | null | undefined, quality: string) {
  if (!tonic || (quality !== 'Major' && quality !== 'Minor')) return null;
  let relative = getRelativeScale(getScaleInfo(tonic, quality === 'Major' ? 'major' : 'minor'));
  if (!relative) return null;
  // B# minor for D# major: use the simpler spelling (C minor)
  if (relative.notes.some((note) => /##|bb/.test(note))) {
    relative = getBestScaleForChroma(Note.chroma(relative.tonic) ?? 0, relative.type);
  }
  return `${formatSharpsFlats(relative.tonic)} ${relative.type}`;
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
