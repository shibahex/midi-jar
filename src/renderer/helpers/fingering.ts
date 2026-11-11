/**
 * Piano fingering for one octave of a scale, ascending (tonic to tonic).
 * Fingers: 1 = thumb … 5 = little finger. Descending uses the same finger per note.
 */

import { Fingering } from 'main/types';

export type Hand = 'right' | 'left';

export const HAND_LABEL: Record<Hand, string> = { right: 'Right hand', left: 'Left hand' };

export const FINGER_NAMES = ['', 'thumb', 'index', 'middle', 'ring', 'pinky'];

/** Hands to show finger numbers for */
export const getFingeringHands = (fingering: Fingering | undefined): Hand[] => {
  if (!fingering) return ['right'];
  if (fingering === 'none') return [];
  if (fingering === 'both') return ['right', 'left'];
  return [fingering];
};

const BLACK_CHROMAS = [1, 3, 6, 8, 10];

export const isBlackKey = (midi: number) => BLACK_CHROMAS.includes(((midi % 12) + 12) % 12);

const digits = (str: string) => str.split('').map(Number);

/**
 * Standard one-octave fingerings, indexed by tonic chroma (C = 0 … B = 11).
 * Enharmonic keys (C#/Db…) share the same black/white pattern, so the same fingering.
 */
const TABLES: Record<'major' | 'minor', Record<Hand, string[]>> = {
  major: {
    right: [
      '12312345', // C
      '23123412', // Db
      '12312345', // D
      '31234123', // Eb
      '12312345', // E
      '12341234', // F
      '23412312', // Gb
      '12312345', // G
      '34123123', // Ab
      '12312345', // A
      '21231234', // Bb
      '12312345', // B
    ],
    left: [
      '54321321', // C
      '32143213', // Db
      '54321321', // D
      '32143213', // Eb
      '54321321', // E
      '54321321', // F
      '43213214', // Gb
      '54321321', // G
      '32143213', // Ab
      '54321321', // A
      '32143213', // Bb
      '43214321', // B
    ],
  },
  minor: {
    right: [
      '12312345', // C
      '34123123', // C#
      '12312345', // D
      '31234123', // D# / Eb
      '12312345', // E
      '12341234', // F
      '34123123', // F#
      '12312345', // G
      '34123123', // G#
      '12312345', // A
      '21231234', // Bb
      '12312345', // B
    ],
    left: [
      '54321321', // C
      '32143213', // C#
      '54321321', // D
      '21432132', // D# / Eb
      '54321321', // E
      '54321321', // F
      '43213214', // F#
      '54321321', // G
      '32132143', // G#
      '54321321', // A
      '21321432', // Bb
      '43214321', // B
    ],
  },
};

const TABLE_FOR_TYPE: Record<string, 'major' | 'minor'> = {
  major: 'major',
  minor: 'minor',
  'harmonic minor': 'minor',
  'melodic minor': 'minor',
};

const INF = Number.POSITIVE_INFINITY;

/**
 * Finds a right-hand fingering for ascending notes with simple piano rules:
 * no thumb on black keys, thumb passes under after finger 3 or 4 (2 at a push),
 * little finger only on the last note.
 */
export function computeRightHandFingering(midis: number[]): number[] {
  const n = midis.length;
  const last = n - 1;

  const noteCost = (i: number, f: number) => {
    const black = isBlackKey(midis[i]);
    // hard rules are only very expensive, so odd scales still get a fingering
    let c = f === 1 && black ? 30 : 0;
    if (f === 5 && i !== last) c += 30;
    if (f === 5 && black) c += 2;
    if (i === 0) {
      if (black) c += ({ 2: 0, 3: 0.5, 4: 1 } as Record<number, number>)[f] ?? INF;
      else c += f === 1 ? 0 : 3;
    }
    if (i === last) c += ({ 5: 0, 1: 3 } as Record<number, number>)[f] ?? 1;
    return c;
  };

  const moveCost = (i: number, prev: number, f: number) => {
    if (f === prev + 1) return 0;
    if (f === 1 && prev >= 2 && prev <= 4) {
      // thumb passes under after 4 or 3 (2 at a push), easiest right after a black key
      const after = ({ 2: 1, 3: 0.6, 4: 0 } as Record<number, number>)[prev];
      return after + (isBlackKey(midis[i - 1]) ? 0 : 0.5);
    }
    // stretch, only as a last resort
    if (f === prev + 2) return 4;
    return INF;
  };

  const cost: number[][] = midis.map(() => Array(6).fill(INF));
  const from: number[][] = midis.map(() => Array(6).fill(0));

  for (let f = 1; f <= 5; f += 1) cost[0][f] = noteCost(0, f);

  for (let i = 1; i < n; i += 1) {
    for (let f = 1; f <= 5; f += 1) {
      const nc = noteCost(i, f);
      if (nc !== INF) {
        for (let p = 1; p <= 5; p += 1) {
          const c = cost[i - 1][p] + moveCost(i, p, f) + nc;
          if (c < cost[i][f]) {
            cost[i][f] = c;
            from[i][f] = p;
          }
        }
      }
    }
  }

  let best = 1;
  for (let f = 2; f <= 5; f += 1) if (cost[last][f] < cost[last][best]) best = f;

  const fingers = Array(n).fill(0);
  fingers[last] = best;
  for (let i = last; i > 0; i -= 1) fingers[i - 1] = from[i][fingers[i]];
  return fingers;
}

/** Left hand going up mirrors the right hand going down: mirror the keyboard around D */
export function computeLeftHandFingering(midis: number[]): number[] {
  const mirrored = [...midis].reverse().map((m) => 124 - m);
  return computeRightHandFingering(mirrored).reverse();
}

const isPlayable = (midis: number[], fingers: number[]) =>
  fingers.length === midis.length &&
  fingers.every((f, i) => f >= 1 && f <= 5 && !(f === 1 && isBlackKey(midis[i])));

/**
 * Fingering for an ascending octave of a scale (midis from tonic to tonic).
 * Uses standard fingerings for major and minor scales, computed ones otherwise.
 */
export function getScaleFingering(type: string, midis: number[], hand: Hand): number[] {
  const tableName = TABLE_FOR_TYPE[type];
  if (tableName && midis.length === 8) {
    const chroma = ((midis[0] % 12) + 12) % 12;
    const fingers = digits(TABLES[tableName][hand][chroma]);
    if (isPlayable(midis, fingers)) return fingers;
  }

  return hand === 'right' ? computeRightHandFingering(midis) : computeLeftHandFingering(midis);
}

/** Right hand fingers for chord notes counted from the lowest note */
const rightChordFingers = (midis: number[]): number[] => {
  const n = midis.length;
  const span = midis[n - 1] - midis[0];

  if (n === 1) return [1];
  if (n === 2) return [1, span <= 4 ? 3 : 5];
  if (n === 3) {
    if (span <= 5) return [1, 2, 3];
    const second = midis[1] - midis[0];
    // sus2 → 2, sus4 → 4, thirds → 3
    let middle = 3;
    if (second <= 2) middle = 2;
    else if (second >= 5) middle = 4;
    return [1, middle, 5];
  }
  if (n === 4) return [1, 2, 3, 5];
  if (n === 5) return [1, 2, 3, 4, 5];

  // too many notes for one hand: spread the fingers over the keys
  return midis.map((_, i) => 1 + Math.round((i * 4) / (n - 1)));
};

/**
 * Fingering for the notes of a chord (midis ascending), e.g. 1-3-5 for a right hand triad
 * and 5-3-1 for a left hand triad
 */
export function getChordFingering(midis: number[], hand: Hand): number[] {
  const sorted = [...midis].sort((a, b) => a - b);
  if (sorted.length === 0) return [];
  if (hand === 'right') return rightChordFingers(sorted);

  // left hand mirrors the right hand: thumb on the top note
  const mirrored = sorted.map((m) => -m).reverse();
  return rightChordFingers(mirrored).reverse();
}
