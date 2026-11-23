import { Chord, Note } from 'tonal';

import {
  buildSongTemplate,
  chromaOfSamples,
  findFirstChordMs,
  HeardFrame,
} from '../renderer/helpers/audioSync';

// a song of 4 chords repeated, a bar each, after 2 beats of intro, at 120 BPM
const NAMES = ['C', 'Am', 'F', 'G', 'C', 'Am', 'F', 'G', 'Em', 'Dm', 'G', 'C'];
const chords = NAMES.map((name) => ({ chord: Chord.get(name), beats: 4 }));
const beatMs = 500;
const leadIn = 2;

/** What a recording with its first chord at firstChordMs sounds like, from 0 to lengthMs */
function record(firstChordMs: number, fromMs: number, lengthMs: number, noise = 0.3) {
  let seed = 1;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const frames: HeardFrame[] = [];
  for (let positionMs = fromMs; positionMs < fromMs + lengthMs; positionMs += 50) {
    const bar = Math.floor((positionMs - firstChordMs) / (4 * beatMs));
    const chroma = new Float32Array(12).map(() => random() * noise);
    const chord = chords[bar]?.chord;
    chord?.notes.forEach((note) => {
      chroma[Note.chroma(note) ?? 0] += 1;
    });
    frames.push({ positionMs, chroma });
  }
  return frames;
}

describe('syncing by listening', () => {
  const template = buildSongTemplate(chords, 4, leadIn);

  it('finds the first chord near a wrong guess', () => {
    const heard = record(3200, 0, 15000);
    const found = findFirstChordMs(heard, template, beatMs, leadIn, 2500, 1500);
    expect(found).not.toBeNull();
    expect(Math.abs((found?.firstChordMs ?? 0) - 3200)).toBeLessThanOrEqual(40);
  });

  it('works from the middle of the song', () => {
    const heard = record(1800, 9000, 10000);
    const found = findFirstChordMs(heard, template, beatMs, leadIn, 2100, 1000);
    expect(Math.abs((found?.firstChordMs ?? 0) - 1800)).toBeLessThanOrEqual(40);
  });

  it('keeps the nearest place when the song repeats', () => {
    // the first 2 loops are the same: a guess near the right place stays there
    const heard = record(2000, 2000, 7500, 0.05);
    const found = findFirstChordMs(heard, template, beatMs, leadIn, 2100, 8000);
    expect(Math.abs((found?.firstChordMs ?? 0) - 2000)).toBeLessThanOrEqual(40);
  });

  it('finds nothing in noise', () => {
    const heard = record(-1e9, 0, 10000, 1);
    expect(findFirstChordMs(heard, template, beatMs, leadIn, 2000, 1000)).toBeNull();
  });

  it('hears the notes of a chord', () => {
    // C E G (with a few harmonics) at 22050 Hz
    const rate = 22050;
    const samples = new Float32Array(4096).map((_, i) =>
      [261.63, 329.63, 392].reduce(
        (sum, hz) =>
          sum +
          [1, 2, 3].reduce((h, k) => h + Math.sin((2 * Math.PI * hz * k * i) / rate) / k, 0) * 0.1,
        0
      )
    );
    const chroma = chromaOfSamples(samples, rate);
    const loudest = Array.from(chroma ?? [])
      .map((value, pc) => ({ value, pc }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 3)
      .map(({ pc }) => pc)
      .sort((a, b) => a - b);
    expect(loudest).toEqual([0, 4, 7]);
    expect(chromaOfSamples(new Float32Array(4096), rate)).toBeNull();
  });
});
