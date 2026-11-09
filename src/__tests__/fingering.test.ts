import { Interval, Note, Scale } from 'tonal';

import { getScaleFingering, isBlackKey } from '../renderer/helpers/fingering';
import { SCALE_SETS } from '../renderer/helpers/scales';

const TONICS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

const octaveOf = (tonic: string, type: string) => {
  const scale = Scale.get(`${tonic} ${type}`);
  const tonicMidi = 60 + (Note.chroma(tonic) ?? 0);
  return [
    ...scale.intervals.map((interval) => tonicMidi + (Interval.semitones(interval) ?? 0)),
    tonicMidi + 12,
  ];
};

describe('fingering', () => {
  it('uses standard fingerings for major scales', () => {
    expect(getScaleFingering('major', octaveOf('C', 'major'), 'right')).toEqual([
      1, 2, 3, 1, 2, 3, 4, 5,
    ]);
    expect(getScaleFingering('major', octaveOf('C', 'major'), 'left')).toEqual([
      5, 4, 3, 2, 1, 3, 2, 1,
    ]);
    expect(getScaleFingering('major', octaveOf('Eb', 'major'), 'right')).toEqual([
      3, 1, 2, 3, 4, 1, 2, 3,
    ]);
    expect(getScaleFingering('major', octaveOf('B', 'major'), 'left')).toEqual([
      4, 3, 2, 1, 4, 3, 2, 1,
    ]);
  });

  it('computes a playable fingering for every scale', () => {
    SCALE_SETS.all.forEach((type) => {
      TONICS.forEach((tonic) => {
        const midis = octaveOf(tonic, type);
        const whiteKeys = midis.filter((midi) => !isBlackKey(midi)).length;

        (['right', 'left'] as const).forEach((hand) => {
          const fingers = getScaleFingering(type, midis, hand);
          expect(fingers).toHaveLength(midis.length);
          fingers.forEach((finger, i) => {
            expect(finger).toBeGreaterThanOrEqual(1);
            expect(finger).toBeLessThanOrEqual(5);
            // thumb on a black key only when there is almost no white key
            expect(whiteKeys > 2 && finger === 1 && isBlackKey(midis[i])).toBe(false);
          });
        });
      });
    });
  });
});
