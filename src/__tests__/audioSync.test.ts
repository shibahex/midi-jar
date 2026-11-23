import { Chord, Note } from 'tonal';

import {
  buildSongTemplate,
  chromaOfSamples,
  findKeyShift,
  HeardFrame,
} from '../renderer/helpers/audioSync';

// a song of 4 chords repeated, a bar each, after 2 beats of intro, at 120 BPM
const NAMES = ['C', 'Am', 'F', 'G', 'C', 'Am', 'F', 'G', 'Em', 'Dm', 'G', 'C'];
const chords = NAMES.map((name) => ({ chord: Chord.get(name), beats: 4 }));
const beatMs = 500;
const leadIn = 2;

/** What a recording with its first chord at firstChordMs sounds like, from 0 to lengthMs */
function record(
  firstChordMs: number,
  fromMs: number,
  lengthMs: number,
  noise = 0.3,
  semitones = 0
) {
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
      chroma[((Note.chroma(note) ?? 0) + semitones + 12) % 12] += 1;
    });
    frames.push({ positionMs, chroma });
  }
  return frames;
}

describe('hearing a recording', () => {
  const template = buildSongTemplate(chords, 4, leadIn);

  it('hears the key of the recording', () => {
    expect(findKeyShift(record(2000, 0, 15000), template).semitones).toBe(0);
    const higher = record(2000, 0, 15000, 0.3, 2);
    const key = findKeyShift(higher, template);
    expect(key.semitones).toBe(2);
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
