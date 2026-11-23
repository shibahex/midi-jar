import { buildNoteHits, mergeRepeats, PartEvent } from '../renderer/views/RhythmGame/rhythm';

// 120 BPM: a beat is 500 ms, an eighth 250 ms
const TEMPO = 120;
const strum = (time: number, midis: number[]): PartEvent[] =>
  midis.map((midi) => ({ time, duration: 200, midi, velocity: 90, role: 'rhythm', part: 'g' }));

const hitsOf = (events: PartEvent[]) => buildNoteHits(events, TEMPO, true);

describe('mergeRepeats', () => {
  it('holds eighth strums of the same chord as one, its strums still heard', () => {
    const events = [0, 250, 500, 750].flatMap((t) => strum(t, [52, 55, 59]));
    const merged = mergeRepeats(hitsOf(events), TEMPO);
    expect(merged).toHaveLength(1);
    // (to the end of the last strum)
    expect(merged[0].length).toBeCloseTo(1.9);
    expect(merged[0].strums?.map((s) => s.time)).toEqual([250, 500, 750]);
  });

  it('holds a strum missing strings with the chord before it', () => {
    const events = [...strum(0, [52, 55, 59]), ...strum(250, [55, 59])];
    const merged = mergeRepeats(hitsOf(events), TEMPO);
    expect(merged).toHaveLength(1);
    expect(merged[0].strums?.[0].notes).toEqual([55, 59]);
  });

  it('plays another chord, and slow repeats, each', () => {
    const events = [
      ...strum(0, [52, 55, 59]),
      ...strum(250, [53, 57, 60]),
      ...strum(1250, [53, 57, 60]),
    ];
    const merged = mergeRepeats(hitsOf(events), TEMPO);
    expect(merged.map((h) => h.time)).toEqual([0, 250, 1250]);
    expect(merged.map((h) => h.id)).toEqual([0, 1, 2]);
  });

  it('plays single notes played again each (a bass line)', () => {
    const events = [0, 250, 500, 750].flatMap((t) => strum(t, [45]));
    expect(mergeRepeats(hitsOf(events), TEMPO)).toHaveLength(4);
  });

  it('strikes a held chord again after 4 beats', () => {
    const events = Array.from({ length: 12 }, (_, i) => strum(i * 250, [52, 59])).flat();
    expect(mergeRepeats(hitsOf(events), TEMPO).map((h) => h.time)).toEqual([0, 2000]);
  });
});
