import { buildNoteHits, nameNotes, PartEvent } from '../renderer/views/RhythmGame/rhythm';

describe('nameNotes', () => {
  it('names the chord the notes make', () => {
    expect(nameNotes(['E', 'B', 'G#'])).toBe('E');
    expect(nameNotes(['G#', 'E', 'B'])).toBe('E/G#');
    expect(nameNotes(['D', 'A', 'F#', 'C'])).toBe('D7');
    expect(nameNotes(['G#', 'D#', 'B'])).toBe('G#m');
  });

  it('names no chord for one note, or notes making none', () => {
    expect(nameNotes(['E'])).toBeUndefined();
    expect(nameNotes(['F', 'A', 'E'])).toBeUndefined();
  });
});

describe('buildNoteHits', () => {
  it('names a strum by its chord, its notes under it', () => {
    const strum: PartEvent[] = [40, 47, 52, 56].map((midi) => ({
      time: 0,
      duration: 500,
      midi,
      velocity: 90,
      role: 'rhythm',
      part: 'g',
    }));
    const [hit] = buildNoteHits(strum, 120, true);
    expect(hit.name).toBe('E');
    expect(hit.numeral).toBe('E2 B2 E3 G#3');
  });
});
