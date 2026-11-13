import { Chord, Note } from 'tonal';

import { SongPart } from 'main/types';
import { buildSongTemplate } from '../renderer/helpers/audioSync';
import {
  alignClips,
  alignSong,
  beatOfMs,
  buildSongOnsets,
  hearSamples,
  modelAt,
  msOfBeat,
  Recording,
} from '../renderer/helpers/alignment';

/**
 * A song like a slow indie song played without a click: the same 3 chords all along (it looks
 * the same every 4 bars), recorded with a band slowing down and speeding up
 */
const RATE = 22050;
const BPM = 78;
const BEAT_MS = 60000 / BPM;
const LOOP = [
  ['G#m', 4],
  ['B', 4],
  ['E', 8],
] as const;
const LOOPS = 7;
const chords = Array.from({ length: LOOPS }, () => LOOP)
  .flat()
  .map(([name, beats]) => ({ chord: Chord.get(name), beats }));

/** an arpeggio (8th notes) over each chord, and its root in the bass on each beat */
function buildParts(): SongPart[] {
  const guitar: number[] = [];
  const bass: number[] = [];
  let position = 0;
  chords.forEach(({ chord, beats }) => {
    const midis = chord.notes.map((note) => 60 + (Note.chroma(note) ?? 0) - 12);
    for (let i = 0; i < beats * 2; i += 1) {
      guitar.push(position + i / 2, 0.5, midis[i % midis.length] + 12 * (i % 4 === 3 ? 1 : 0), 90);
    }
    for (let i = 0; i < beats; i += 1) bass.push(position + i, 1, midis[0] - 12, 100);
    position += beats;
  });
  return [
    { role: 'rhythm', name: 'Guitar', notes: guitar },
    { role: 'bass', name: 'Bass', notes: bass },
  ];
}
const parts = buildParts();
const songBeats = chords.reduce((sum, c) => sum + c.beats, 0);

/**
 * where each beat really is in the recording: after an intro, at a tempo going up and down
 * (slower than the song's by a part: the band plays slower than the tab says)
 */
function realBeats(introMs: number, swing: number, slower = 0) {
  const times = [introMs];
  for (let beat = 0; beat < songBeats + 4; beat += 1) {
    const swung = 1 + swing * Math.sin((2 * Math.PI * beat) / 40);
    times.push(times[beat] + BEAT_MS * (1 + slower) * swung);
  }
  return times;
}

/** The recording: plucked notes (with harmonics) at their real time, and a little noise */
function play(beats: number[], lengthMs: number) {
  const samples = new Float32Array(Math.round((lengthMs / 1000) * RATE));
  const at = (beat: number) => {
    const i = Math.floor(beat);
    return beats[i] + (beat - i) * (beats[i + 1] - beats[i]);
  };
  parts.forEach((part) => {
    for (let i = 0; i + 3 < part.notes.length; i += 4) {
      const [start, length, midi, velocity] = part.notes.slice(i, i + 4);
      const from = Math.round((at(start) / 1000) * RATE);
      const to = Math.min(samples.length, Math.round((at(start + length) / 1000) * RATE) + 2000);
      const hz = 440 * 2 ** ((midi - 69) / 12);
      for (let s = from; s < to; s += 1) {
        const t = (s - from) / RATE;
        const level = (velocity / 127) * 0.1 * Math.exp(-t / 0.35);
        samples[s] +=
          level *
          (Math.sin(2 * Math.PI * hz * t) +
            0.5 * Math.sin(4 * Math.PI * hz * t) +
            0.25 * Math.sin(6 * Math.PI * hz * t));
      }
    }
  });
  let seed = 7;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed / 2147483647) * 2 - 1;
  };
  // drums (not in the song's parts): a loud hit of noise on every beat
  for (let beat = 0; beat < songBeats; beat += 1) {
    const from = Math.round((at(beat) / 1000) * RATE);
    for (let s = from; s < Math.min(samples.length, from + 3000); s += 1) {
      samples[s] += random() * 0.25 * Math.exp(-(s - from) / 600);
    }
  }
  // a voice (not in the song's parts either): a slow line, sliding
  for (let s = Math.round((beats[0] / 1000) * RATE); s < samples.length; s += 1) {
    const t = s / RATE;
    samples[s] += 0.05 * Math.sin(2 * Math.PI * (330 + 40 * Math.sin(t / 3)) * t);
  }
  for (let s = 0; s < samples.length; s += 1) samples[s] += random() * 0.002;
  return samples;
}

/** How far the beats found are from the real ones (ms): the median and the worst */
function errors(map: number[], real: number[], fromBeat: number, toBeat: number) {
  const diffs: number[] = [];
  for (let beat = fromBeat; beat < toBeat; beat += 1) diffs.push(Math.abs(map[beat] - real[beat]));
  diffs.sort((a, b) => a - b);
  return { median: diffs[Math.floor(diffs.length / 2)], worst: diffs[diffs.length - 1] };
}

describe('syncing with a whole recording', () => {
  const template = buildSongTemplate(chords, 4, 0, parts);
  const notes = buildSongOnsets(chords, 4, 0, parts);
  const real = realBeats(2600, 0.07);
  const lengthMs = real[songBeats] + 3000;
  const recording = hearSamples(play(real, lengthMs), RATE);

  it('finds every beat of a song repeating itself, played faster and slower', () => {
    const result = alignSong(recording, template, notes, BEAT_MS);
    expect(result).not.toBeNull();
    const { median, worst } = errors(result?.map ?? [], real, 1, songBeats - 1);
    expect(median).toBeLessThanOrEqual(20);
    expect(worst).toBeLessThanOrEqual(60);
  });

  it('works with the start of the recording only', () => {
    const heardMs = real[60];
    const partial: Recording = {
      frames: recording.frames.filter((f) => f.positionMs < heardMs),
      onsets: recording.onsets.filter((o) => o.positionMs < heardMs),
      heardMs,
      durationMs: lengthMs,
    };
    const result = alignSong(partial, template, notes, BEAT_MS);
    expect(result).not.toBeNull();
    expect(result?.heardBeats).toBeGreaterThan(50);
    expect(result?.heardBeats).toBeLessThan(70);
    const { median } = errors(result?.map ?? [], real, 1, 55);
    expect(median).toBeLessThanOrEqual(20);
    // the beats after go on: in order, as many as the song has
    expect(result?.map.length).toBeGreaterThanOrEqual(songBeats + 1);
  });

  it('does not take another song for this one', () => {
    const other = buildSongTemplate(
      Array.from({ length: 56 }, (_, i) => ({
        chord: Chord.get(['F#', 'C#m', 'A', 'D#m', 'G', 'Cm'][i % 6]),
        beats: 2,
      })),
      4,
      0
    );
    // (the recording is heard against a song in the same tempo with other chords)
    const result = alignSong(recording, other, [], BEAT_MS);
    expect(result).toBeNull();
  });
});

describe('the beats of a recording', () => {
  const map = [1000, 1500, 2000, 2600, 3200];

  it('tells where a beat is, and the beat at a moment', () => {
    expect(msOfBeat(map, 2.5)).toBe(2300);
    expect(msOfBeat(map, -1)).toBe(500);
    expect(msOfBeat(map, 5)).toBe(3800);
    expect(beatOfMs(map, 2300)).toBeCloseTo(2.5);
    expect(beatOfMs(map, 500)).toBeCloseTo(-1);
    expect(beatOfMs(map, 3800)).toBeCloseTo(5);
  });

  it('tells the tempo there', () => {
    expect(modelAt(map, 1200).beatMs).toBe(500);
    expect(modelAt(map, 2900).beatMs).toBe(600);
  });
});

/** Clips of a recording heard: 4 of 12 s, from its start to near its end */
function clipsOf(
  recording: Recording,
  count = 4,
  clipMs = 12000
): Recording & { clips: [number, number][] } {
  const clips = Array.from({ length: count }, (_, i): [number, number] => {
    const from = (i / (count - 1)) * (recording.durationMs - clipMs - 3000);
    return [from, from + clipMs];
  });
  const inClips = (ms: number) => clips.some(([from, to]) => ms >= from && ms < to);
  return {
    ...recording,
    frames: recording.frames.filter((f) => inClips(f.positionMs)),
    onsets: recording.onsets.filter((o) => inClips(o.positionMs)),
    heardMs: clips[count - 1][1],
    clips,
  };
}

describe('syncing with clips of a recording', () => {
  const template = buildSongTemplate(chords, 4, 0, parts);
  const notes = buildSongOnsets(chords, 4, 0, parts);

  it('finds each clip in a song repeating itself, and the beats between them', () => {
    // steady, but slower than the tab says, and after a longer silence
    const real = realBeats(3100, 0, 0.05);
    const lengthMs = real[songBeats] + 3000;
    const result = alignClips(
      clipsOf(hearSamples(play(real, lengthMs), RATE)),
      template,
      notes,
      BEAT_MS
    );
    expect(result).not.toBeNull();
    expect(result?.used).toBe(4);
    const { median, worst } = errors(result?.map ?? [], real, 1, songBeats - 1);
    expect(median).toBeLessThanOrEqual(25);
    expect(worst).toBeLessThanOrEqual(80);
  });

  it('places the clips of a band going faster and slower, roughly between them', () => {
    const real = realBeats(2600, 0.07);
    const lengthMs = real[songBeats] + 3000;
    const heard = clipsOf(hearSamples(play(real, lengthMs), RATE));
    const result = alignClips(heard, template, notes, BEAT_MS);
    expect(result).not.toBeNull();
    // in the clips: on the beat
    const inClips = Array.from({ length: songBeats }, (_, beat) => beat).filter((beat) =>
      heard.clips.some(([from, to]) => real[beat] >= from + 1000 && real[beat] < to - 1000)
    );
    const diffs = inClips.map((beat) => Math.abs((result?.map[beat] ?? 0) - real[beat]));
    diffs.sort((a, b) => a - b);
    expect(diffs[Math.floor(diffs.length / 2)]).toBeLessThanOrEqual(25);
    // between them: the tempo there is guessed (but never a loop off: 16 beats, 12 s)
    expect(errors(result?.map ?? [], real, 1, songBeats - 1).worst).toBeLessThanOrEqual(500);
  });
});
