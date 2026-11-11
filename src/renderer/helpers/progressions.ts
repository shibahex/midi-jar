import { Chord, ChordType, Note } from 'tonal';
import { Chord as TChord } from '@tonaljs/chord';

import { formatSharpsFlats } from './note';

/**
 * A chord of a progression: its numeral, interval from the key tonic and chord type,
 * and an alteration of its root (-1 for bVII, +1 for #iv).
 * A secondary chord (V/V) is counted from the root of another numeral (`of`).
 */
type ProgressionStep = {
  numeral: string;
  interval: string;
  type: string;
  alter?: number;
  of?: ProgressionStep;
};

export type ProgressionInfo = {
  id: string;
  label: string;
  /** the progression belongs to a major or a minor key */
  mode: 'major' | 'minor';
  steps: ProgressionStep[];
};

const step = (numeral: string, interval: string, type: string): ProgressionStep => ({
  numeral,
  interval,
  type,
});

// numerals of the major and minor keys
const I = step('I', '1P', 'M');
const ii = step('ii', '2M', 'm');
const IV = step('IV', '4P', 'M');
const V = step('V', '5P', 'M');
const vi = step('vi', '6M', 'm');
const i = step('i', '1P', 'm');
const iv = step('iv', '4P', 'm');
const v = step('v', '5P', 'm');
const III = step('III', '3m', 'M');
const VI = step('VI', '6m', 'M');
const VII = step('VII', '7m', 'M');

/** Common progressions, in major then minor keys */
export const PROGRESSIONS: ProgressionInfo[] = [
  { id: 'I-IV-V-I', label: 'I–IV–V–I', mode: 'major', steps: [I, IV, V, I] },
  { id: 'I-V-vi-IV', label: 'I–V–vi–IV', mode: 'major', steps: [I, V, vi, IV] },
  { id: 'I-vi-IV-V', label: 'I–vi–IV–V', mode: 'major', steps: [I, vi, IV, V] },
  { id: 'vi-IV-I-V', label: 'vi–IV–I–V', mode: 'major', steps: [vi, IV, I, V] },
  { id: 'ii-V-I', label: 'ii–V–I', mode: 'major', steps: [ii, V, I] },
  {
    id: 'ii7-V7-Imaj7',
    label: 'ii7–V7–Imaj7',
    mode: 'major',
    steps: [step('ii7', '2M', 'm7'), step('V7', '5P', '7'), step('Imaj7', '1P', 'maj7')],
  },
  { id: 'i-iv-v-i', label: 'i–iv–v–i', mode: 'minor', steps: [i, iv, v, i] },
  { id: 'i-iv-V-i', label: 'i–iv–V–i', mode: 'minor', steps: [i, iv, V, i] },
  { id: 'i-VI-III-VII', label: 'i–VI–III–VII', mode: 'minor', steps: [i, VI, III, VII] },
  { id: 'i-VII-VI-V', label: 'i–VII–VI–V', mode: 'minor', steps: [i, VII, VI, V] },
];

/** Custom progressions, one per line: numerals separated by spaces or dashes */

const ROMAN = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii'];
const MAJOR_DEGREES = ['1P', '2M', '3M', '4P', '5P', '6M', '7M'];
const MINOR_DEGREES = ['1P', '2M', '3m', '4P', '5P', '6m', '7m'];

// chord types written after a numeral: [for uppercase numerals, for lowercase numerals]
const NUMERAL_TYPES: Record<string, [string, string]> = {
  '': ['M', 'm'],
  '7': ['7', 'm7'],
  maj7: ['maj7', 'mMaj7'],
  M7: ['maj7', 'mMaj7'],
  Δ: ['maj7', 'mMaj7'],
  Δ7: ['maj7', 'mMaj7'],
  m7: ['m7', 'm7'],
  '6': ['6', 'm6'],
  '9': ['9', 'm9'],
  maj9: ['maj9', 'maj9'],
  m9: ['m9', 'm9'],
  add9: ['add9', 'madd9'],
  sus: ['sus4', 'sus4'],
  sus2: ['sus2', 'sus2'],
  sus4: ['sus4', 'sus4'],
  '7sus4': ['7sus4', '7sus4'],
  o: ['dim', 'dim'],
  '°': ['dim', 'dim'],
  dim: ['dim', 'dim'],
  o7: ['dim7', 'dim7'],
  '°7': ['dim7', 'dim7'],
  dim7: ['dim7', 'dim7'],
  ø: ['m7b5', 'm7b5'],
  ø7: ['m7b5', 'm7b5'],
  m7b5: ['m7b5', 'm7b5'],
  '+': ['aug', 'aug'],
  aug: ['aug', 'aug'],
};

const NUMERAL_REGEX = /^([b#♭♯]*)(vii|iii|vi|iv|ii|v|i)(.*)$/i;

/**
 * Reads a numeral like "bVII", "ii7", "V7sus4" or "viiø"
 *
 * @param minor - the progression is in a minor key: III, VI and VII are those of the minor scale
 */
function parseNumeral(token: string, minor: boolean): ProgressionStep | null {
  const match = token.match(NUMERAL_REGEX);
  if (!match) return null;
  const [, accidentals, roman, suffix] = match;

  const degree = ROMAN.indexOf(roman.toLowerCase());
  const upper = roman === roman.toUpperCase();
  if (roman !== roman.toUpperCase() && roman !== roman.toLowerCase()) return null;

  const known = NUMERAL_TYPES[suffix];
  let type = known ? known[upper ? 0 : 1] : null;
  // other chord types written as such ("V13", "Imaj7#11"...)
  if (!type) {
    const name = upper ? suffix : `m${suffix}`;
    type = ChordType.get(name).empty ? null : name;
  }
  if (!type) return null;

  const alter = [...accidentals].reduce((sum, a) => sum + (a === 'b' || a === '♭' ? -1 : 1), 0);

  // in a minor key, "VI" and "bVI" are the same chord: flats count from the major scale,
  // sharps (#vii°) from the minor scale
  const degrees = minor && alter >= 0 ? MINOR_DEGREES : MAJOR_DEGREES;

  return {
    numeral: `${accidentals.replace(/b/g, '♭').replace(/#/g, '♯')}${roman}${suffix}`,
    interval: degrees[degree],
    type,
    alter,
  };
}

/** Reads a numeral, or a secondary one like "V/V" or "vii°7/ii" */
function parseChordNumeral(token: string, minor: boolean): ProgressionStep | null {
  const [chord, of, extra] = token.split('/');
  if (extra !== undefined) return null;
  if (of === undefined) return parseNumeral(chord, minor);

  const target = parseNumeral(of, minor);
  // counted from the root of the target, in its major scale
  const secondary = parseNumeral(chord, false);
  if (!target || !secondary) return null;
  return { ...secondary, numeral: `${secondary.numeral}/${target.numeral}`, of: target };
}

const TONIC_MINOR = /^i(?![iv])/;

/**
 * Reads a custom progression, e.g. "I vi ii V", "i - bVI - bIII - bVII" or "ii7 V7 Imaj7"
 *
 * @returns the progression, or the first part that could not be read
 */
export function parseProgression(
  line: string
):
  | { progression: ProgressionInfo; error?: undefined }
  | { progression?: undefined; error: string } {
  const tokens = line
    .split(/[\s,|–—-]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (!tokens.length) return { error: 'empty' };

  // a minor tonic (i, i7...) makes the progression a minor key one
  const minor = tokens.some((t) => TONIC_MINOR.test(t.replace(/^[b#♭♯]+/, '')));

  const parsed = tokens.map((token) => parseChordNumeral(token, minor));
  const unread = parsed.findIndex((st) => !st);
  if (unread !== -1) return { error: tokens[unread] };
  const steps = parsed as ProgressionStep[];

  const label = steps.map((st) => st.numeral).join('–');
  return {
    progression: {
      id: `custom:${tokens.join(' ')}`,
      label,
      mode: minor ? 'minor' : 'major',
      steps,
    },
  };
}

/** Custom progressions of a text, one per line (lines that can't be read are skipped) */
export const parseCustomProgressions = (text = '') =>
  text
    .split(/\n/)
    .map((line) => parseProgression(line).progression)
    .filter((p): p is ProgressionInfo => !!p);

/**
 * Progressions that are practiced: the built-in ones but the excluded ones, and the custom ones
 * (all the built-in ones if nothing is left)
 */
export const getIncludedProgressions = (excluded: string[] = [], custom = '') => {
  const included = [
    ...PROGRESSIONS.filter((p) => !excluded.includes(p.id)),
    ...parseCustomProgressions(custom),
  ];
  return included.length ? included : PROGRESSIONS;
};

// how chord types are written next to the root
const SUFFIX: Record<string, string> = { M: '', m: 'm' };

/** Short name of a progression chord, e.g. "Em", "F♯", "B♭maj7" */
export const getProgressionChordName = (root: string, type: string) =>
  `${formatSharpsFlats(root)}${SUFFIX[type] ?? type}`;

/** Root of a progression chord in a key */
function getStepRoot(s: ProgressionStep, tonic: string): string {
  const from = s.of ? getStepRoot(s.of, tonic) : tonic;
  // an augmented unison up or down keeps the letter: B -> Bb, F -> F#
  let root = Note.transpose(from, s.interval);
  for (let a = 0; a < Math.abs(s.alter ?? 0); a += 1) {
    root = Note.transpose(root, (s.alter ?? 0) < 0 ? '-1A' : '1A');
  }
  return root;
}

/**
 * Chords of a progression in a key
 *
 * @param tonic - tonic of the key (major or minor, as the progression)
 */
export function getProgressionChords(progression: ProgressionInfo, tonic: string) {
  return progression.steps.map((s) => {
    const root = getStepRoot(s, tonic);
    return {
      numeral: s.numeral,
      name: getProgressionChordName(root, s.type),
      chord: Chord.getChord(s.type, root) as TChord,
    };
  });
}
