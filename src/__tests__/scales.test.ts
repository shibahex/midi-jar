import {
  getBestScaleForChroma,
  getDegreeLabel,
  getDegreeName,
  getOrdinal,
  getRandomScale,
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
