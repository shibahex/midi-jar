import {
  buildNoteHits,
  getHandsFingering,
  PartEvent,
  splitHands,
} from '../renderer/views/RhythmGame/rhythm';

const TEMPO = 120;
const note = (time: number, midi: number): PartEvent => ({
  time,
  duration: 200,
  midi,
  velocity: 90,
  role: 'melody',
  part: 'm',
});
const line = (midis: number[]) => midis.map((midi, i) => note(i * 250, midi));

describe('splitHands', () => {
  it('plays a bass line with the left hand alone, a melody with the right', () => {
    // E2 D2 C2 A1 B1 G1, leaps of more than an octave too
    const bass = buildNoteHits(line([40, 38, 36, 33, 35, 31, 28, 43]), TEMPO, true);
    const bassSplit = splitHands(bass);
    expect(bass.every((h) => bassSplit.get(h.id)?.right.length === 0)).toBe(true);
    const melody = buildNoteHits(line([64, 67, 72, 67, 76, 72]), TEMPO, true);
    const melodySplit = splitHands(melody);
    expect(melody.every((h) => melodySplit.get(h.id)?.left.length === 0)).toBe(true);
  });

  it('splits a wide phrase: a bass note for the left hand, a melody for the right', () => {
    // C2 under E4 F4 G4, twice
    const hits = buildNoteHits(line([36, 64, 65, 67, 36, 64, 65, 67]), TEMPO, true);
    const split = splitHands(hits);
    expect(hits.map((h) => (split.get(h.id)?.left.length ? 'L' : 'R')).join('')).toBe('LRRRLRRR');
  });
});

describe('getHandsFingering', () => {
  it('fingers each hand on its own notes', () => {
    const hits = buildNoteHits(line([36, 64, 65, 67, 36, 64, 65, 67]), TEMPO, true);
    const fingers = getHandsFingering(hits, ['right', 'left']);
    // the right hand plays E F G as 1 2 3, not moved by the bass note in between
    expect([1, 2, 3].map((i) => fingers.get(hits[i].id)?.right?.fingers[0])).toEqual([1, 2, 3]);
    expect(fingers.get(hits[0].id)?.left?.midis).toEqual([36]);
    expect(fingers.get(hits[0].id)?.right).toBeUndefined();
  });
});
