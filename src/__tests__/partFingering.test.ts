import { buildNoteHits, getPartFingering, PartEvent } from '../renderer/views/RhythmGame/rhythm';

const TEMPO = 120;
const line = (midis: number[], from = 0): PartEvent[] =>
  midis.map((midi, i) => ({
    time: from + i * 250,
    duration: 200,
    midi,
    velocity: 90,
    role: 'melody',
    part: 'm',
  }));

describe('getPartFingering', () => {
  it('fingers a run up from the thumb, for the notes coming after it', () => {
    // C D E F G: 1 2 3 4 5
    const hits = buildNoteHits(line([60, 62, 64, 65, 67]), TEMPO, true);
    const fingers = getPartFingering(hits, 'right');
    expect(hits.map((h) => fingers.get(h.id)?.[0])).toEqual([1, 2, 3, 4, 5]);
  });

  it('starts a run going down on a high finger', () => {
    const hits = buildNoteHits(line([67, 65, 64, 62, 60]), TEMPO, true);
    const fingers = getPartFingering(hits, 'right');
    expect(fingers.get(hits[0].id)?.[0]).toBe(5);
  });

  it('fingers chords as chords', () => {
    const chord: PartEvent[] = [60, 64, 67].map((midi) => ({ ...line([midi])[0] }));
    const hits = buildNoteHits(chord, TEMPO, true);
    expect(getPartFingering(hits, 'right').get(hits[0].id)).toEqual([1, 3, 5]);
  });
});

describe('getPartFingering, hand kept in place', () => {
  it('plays a loop without moving the hand (F A E A: thumb on F)', () => {
    const loop = [53, 57, 64, 57, 53, 57, 64, 57, 53, 57, 64, 57];
    const hits = buildNoteHits(line(loop), TEMPO, true);
    const fingers = getPartFingering(hits, 'right');
    const byNote = new Map(hits.map((h) => [h.notes?.[0], fingers.get(h.id)?.[0]]));
    expect(byNote.get(53)).toBe(1);
    expect(byNote.get(64)).toBe(5);
    expect(hits.map((h) => fingers.get(h.id)?.[0]).join('')).toMatch(/^(1[23]5[23])+$/);
  });
});
