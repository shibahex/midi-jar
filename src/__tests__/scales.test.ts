import {
  getBestScaleForChroma,
  getDegreeLabel,
  getDegreeName,
  getOrdinal,
  getRandomScale,
  getScaleInSequence,
  getScaleSequence,
  SCALE_SETS,
} from '../renderer/helpers/scales';

describe('scales helpers', () => {
  it('spells scales with the least accidentals', () => {
    expect(getBestScaleForChroma(1, 'major').label).toBe('D♭ Major');
    expect(getBestScaleForChroma(6, 'major').tonic).toBe('F#');
    expect(getBestScaleForChroma(8, 'minor').label).toBe('G♯ Natural Minor');
    expect(getBestScaleForChroma(2, 'dorian').notes).toEqual(['D', 'E', 'F', 'G', 'A', 'B', 'C']);
  });

  it('never uses double accidentals', () => {
    SCALE_SETS.all.forEach((type) => {
      for (let chroma = 0; chroma < 12; chroma += 1) {
        const scale = getBestScaleForChroma(chroma, type);
        expect(scale.notes.some((note) => /##|bb/.test(note))).toBe(false);
      }
    });
  });

  it('goes through every key from C to B', () => {
    const labels = Array.from({ length: 12 }, (_, i) => getScaleInSequence('major', i).label);
    expect(labels[0]).toBe('C Major');
    expect(labels[1]).toBe('D♭ Major');
    expect(labels[11]).toBe('B Major');
    expect(getScaleInSequence('major', 12).label).toBe('C Major');

    const majorMinor = getScaleSequence('majorMinor');
    expect(majorMinor).toHaveLength(24);
    expect(majorMinor.slice(0, 2)).toEqual([
      { chroma: 0, type: 'major' },
      { chroma: 0, type: 'minor' },
    ]);
  });

  it('can use natural keys only', () => {
    expect(getScaleSequence('major', true)).toHaveLength(7);
    const tonics = Array.from({ length: 7 }, (_, i) => getScaleInSequence('minor', i, true).tonic);
    expect(tonics).toEqual(['C', 'D', 'E', 'F', 'G', 'A', 'B']);
    for (let i = 0; i < 50; i += 1) {
      expect(getRandomScale('all', null, null, true).tonic).toMatch(/^[A-G]$/);
    }
  });

  it('uses the given tonic', () => {
    expect(getRandomScale('modes', 'C').tonic).toBe('C');
  });

  it('formats degrees', () => {
    expect(['1P', '2M', '3m', '4A', '5d', '6m', '7m'].map(getDegreeLabel)).toEqual([
      '1',
      '2',
      '♭3',
      '♯4',
      '♭5',
      '♭6',
      '♭7',
    ]);
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(getOrdinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd',
    ]);
    expect(getDegreeName(getBestScaleForChroma(0, 'major'), 6)).toBe('Leading Tone');
    expect(getDegreeName(getBestScaleForChroma(0, 'minor'), 6)).toBe('Subtonic');
  });
});
