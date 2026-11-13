import { SongPart } from 'main/types';

import {
  centered,
  chromaOfSamples,
  findKeyShift,
  HeardFrame,
  SongTemplate,
  transposed,
} from './audioSync';
import { Onset, onsetsOfSamples } from './onsets';

/**
 * Syncing with a whole recording: Spotify plays the song once, from its start to its end, and
 * what is heard is lined up with the song all at once (dynamic time warping). The song goes
 * through in order, so a part that repeats is never taken for another one, and every slower
 * or faster part of the recording is found: where each beat of the song is in the recording.
 * The hits heard (onsets) then place each beat finely. Kept with the song: playing it then
 * only reads where each beat is, nothing is guessed while playing.
 */

/** Where each beat of the song is in the recording (ms): beat 0 is the start of its intro */
export type BeatMap = number[];

/**
 * Where the song is in the recording: at recMs (ms of the recording) it is at a beat, and
 * a beat lasts beatMs there (the tempo of the recording there)
 */
export type FollowModel = { recMs: number; beat: number; beatMs: number };

export const beatAt = (model: FollowModel, ms: number) =>
  model.beat + (ms - model.recMs) / model.beatMs;
export const msAt = (model: FollowModel, beat: number) =>
  model.recMs + (beat - model.beat) * model.beatMs;

/** The beat before which a beat is (past the ends: the first or last beat of the map) */
const segmentOf = (map: BeatMap, beat: number) =>
  Math.max(0, Math.min(map.length - 2, Math.floor(beat)));

/** Where a beat is in the recording (ms): past the ends, at the tempo there */
export function msOfBeat(map: BeatMap, beat: number) {
  const i = segmentOf(map, beat);
  return map[i] + (beat - i) * (map[i + 1] - map[i]);
}

/** The beat of the song at a moment of the recording (ms) */
export function beatOfMs(map: BeatMap, ms: number) {
  let low = 0;
  let high = map.length - 2;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (map[middle] <= ms) low = middle;
    else high = middle - 1;
  }
  return low + (ms - map[low]) / (map[low + 1] - map[low]);
}

/** Where the song is at a moment of the recording (ms), and how long a beat lasts there */
export function modelAt(map: BeatMap, ms: number): FollowModel {
  const beat = beatOfMs(map, ms);
  const i = segmentOf(map, beat);
  return { recMs: ms, beat, beatMs: map[i + 1] - map[i] };
}

/** The tempo of a recording, on average (BPM) */
export const mapTempo = (map: BeatMap) =>
  Math.round(((60000 * (map.length - 1)) / (map[map.length - 1] - map[0])) * 100) / 100;

/** A note starting in the song: when (beats) and how loud (0 to 1, more when several) */
export type SongOnset = { beat: number; weight: number };

/** When the chords and the notes of the parts of a song start (from the start of its intro) */
export function buildSongOnsets(
  chords: { beats?: number }[],
  beatsPerBar: number,
  leadIn: number,
  parts: SongPart[] = []
): SongOnset[] {
  const byBeat = new Map<number, number>();
  const add = (beat: number, weight: number) => {
    // notes played together (a strum) are one onset
    const key = Math.round(beat * 48) / 48;
    byBeat.set(key, (byBeat.get(key) ?? 0) + weight);
  };
  let position = leadIn;
  chords.forEach(({ beats = beatsPerBar }) => {
    add(position, 1);
    position += beats;
  });
  parts.forEach((part) => {
    for (let i = 0; i + 3 < part.notes.length; i += 4) add(part.notes[i], part.notes[i + 3] / 127);
  });
  return [...byBeat.entries()]
    .map(([beat, weight]) => ({ beat, weight: Math.min(2, weight) }))
    .sort((a, b) => a.beat - b.beat);
}

/** What was heard of a recording, from its start */
export type Recording = {
  /** the notes heard (silence is not in it), at their place in the recording (ms) */
  frames: HeardFrame[];
  /** the onsets heard, at their place in the recording (ms) */
  onsets: Onset[];
  /** how much of the recording was heard (ms from its start) */
  heardMs: number;
  /** how long the whole recording is (ms) */
  durationMs: number;
};

/** The frames lined up: a rough pass over the whole song, then a fine one around it (ms) */
const ROUGH_MS = 100;
const FINE_MS = 50;
/** How far the recording may be from the song at its own tempo (ms, at least, and part of it) */
const ROUGH_BAND_MS = 20000;
const ROUGH_BAND_PART = 0.1;
/** How late the song may start in the recording (ms) */
const INTRO_MS = 15000;
/** How far the fine pass may be from the rough one (ms each way) */
const FINE_BAND_MS = 1500;
/** What a frame of silence costs against notes (notes against notes: 0 to 1) */
const SILENCE_COST = 0.6;
/**
 * What a change of pace costs: where the notes tell nothing (a chord held for bars), the
 * recording keeps its pace rather than wandering
 */
const PACE_COST = 0.06;
/** Further than this from what the lengths say, the song's own tempo is taken (ratio) */
const RATIO_LIMIT = 0.18;
/**
 * What was heard must look like the song at least this much (average correlation), and this
 * much more than like the song moved a tritone away (lined up with anything, it looks a bit
 * like anything)
 */
const MIN_MATCH = 0.1;
const MIN_MARGIN = 0.12;

/** A lined-up pass: where each frame of the song is in the recording (frames), and how well */
type Warp = { cols: Float32Array; rows: number; match: number };

/**
 * Lines up the frames of the song (rows) with the frames of the recording (columns), each
 * row within a band of columns. The recording may go from half to twice as fast as the song
 * (a step goes 1 or 2 frames on each side). The song starts on its first row, anywhere up to
 * startCols in the recording; it ends on its last row (all of it heard) or, when only the
 * start of the recording was heard, on the last frame heard.
 */
function warp(
  song: (Float32Array | null)[],
  heard: (Float32Array | null)[],
  lo: Int32Array,
  hi: Int32Array,
  startCols: number,
  untilEnd: boolean
): Warp | null {
  const rows = song.length;
  const cols = heard.length;
  const offsets = new Int32Array(rows + 1);
  for (let r = 0; r < rows; r += 1) offsets[r + 1] = offsets[r] + Math.max(0, hi[r] - lo[r] + 1);
  const total = new Float32Array(offsets[rows]).fill(Infinity);
  const steps = new Uint8Array(offsets[rows]);
  // frames heard with notes, before each column: skipped at the start, they cost as unmatched
  const sounds = new Int32Array(cols + 1);
  heard.forEach((frame, c) => {
    sounds[c + 1] = sounds[c] + (frame ? 1 : 0);
  });
  const cost = (r: number, c: number) => {
    const a = song[r];
    const b = heard[c];
    if (!a || !b) return a || b ? SILENCE_COST : 0;
    let dot = 0;
    for (let pc = 0; pc < 12; pc += 1) dot += a[pc] * b[pc];
    return (1 - dot) / 2;
  };
  const index = (r: number, c: number) =>
    r >= 0 && c >= lo[r] && c <= hi[r] ? offsets[r] + c - lo[r] : -1;

  for (let r = 0; r < rows; r += 1) {
    for (let c = lo[r]; c <= hi[r]; c += 1) {
      const k = offsets[r] + c - lo[r];
      const here = cost(r, c);
      if (r === 0) {
        if (c <= startCols) total[k] = 2 * here + SILENCE_COST * (sounds[c] - sounds[lo[0]]);
      } else {
        // the same pace (1, 1), the song faster (2 rows, 1 column), the song slower (1, 2):
        // each weighs as many frames as it moves, so no pace is cheaper than another
        const diagonal = index(r - 1, c - 1);
        const faster = index(r - 2, c - 1);
        const slower = index(r - 1, c - 2);
        let best = diagonal >= 0 ? total[diagonal] + 2 * here : Infinity;
        let step = 0;
        if (faster >= 0 && total[faster] < Infinity) {
          const value = total[faster] + 2 * cost(r - 1, c) + here + PACE_COST;
          if (value < best) [best, step] = [value, 1];
        }
        if (slower >= 0 && total[slower] < Infinity) {
          const value = total[slower] + 2 * cost(r, c - 1) + here + PACE_COST;
          if (value < best) [best, step] = [value, 2];
        }
        if (best < Infinity) {
          total[k] = best;
          steps[k] = step;
        }
      }
    }
  }

  // the end: the cheapest for the frames it went through
  const end = { r: -1, c: -1, value: Infinity };
  const consider = (r: number, c: number) => {
    const k = index(r, c);
    if (k < 0 || total[k] === Infinity) return;
    const value = total[k] / (r + 1 + c - lo[0] + 1);
    if (value < end.value) Object.assign(end, { r, c, value });
  };
  if (untilEnd) for (let c = lo[rows - 1]; c <= hi[rows - 1]; c += 1) consider(rows - 1, c);
  if (end.r < 0) for (let r = 0; r < rows; r += 1) consider(r, cols - 1);
  if (end.r < 0) return null;

  // back from the end: the columns of each row
  const { r: endRow, c: endCol } = end;
  const sums = new Float64Array(endRow + 1);
  const counts = new Uint16Array(endRow + 1);
  let matchSum = 0;
  let matchCount = 0;
  const visit = (r: number, c: number) => {
    sums[r] += c;
    counts[r] += 1;
    const a = song[r];
    const b = heard[c];
    if (a && b) {
      matchSum += 1 - 2 * cost(r, c);
      matchCount += 1;
    }
  };
  let r = endRow;
  let c = endCol;
  for (;;) {
    visit(r, c);
    if (r === 0) break;
    const step = steps[index(r, c)];
    if (step === 1) {
      visit(r - 1, c);
      r -= 2;
      c -= 1;
    } else if (step === 2) {
      visit(r, c - 1);
      r -= 1;
      c -= 2;
    } else {
      r -= 1;
      c -= 1;
    }
  }
  const result = new Float32Array(endRow + 1);
  for (let i = 0; i <= endRow; i += 1) result[i] = sums[i] / counts[i];
  return { cols: result, rows: endRow + 1, match: matchCount ? matchSum / matchCount : 0 };
}

/** The song's notes, a frame every few beats (each the notes of its beats, centered) */
function songFrames(template: SongTemplate, beatsPerFrame: number, untilBeat: number) {
  const frames: (Float32Array | null)[] = [];
  for (let beat = 0; beat < untilBeat; beat += beatsPerFrame) {
    const sum = new Float32Array(12);
    let any = false;
    const last = Math.min(
      template.vectors.length - 1,
      Math.ceil((beat + beatsPerFrame) / template.step) - 1
    );
    for (let i = Math.floor(beat / template.step); i <= last; i += 1) {
      const vector = template.vectors[i];
      if (vector) {
        any = true;
        for (let pc = 0; pc < 12; pc += 1) sum[pc] += vector[pc];
      }
    }
    frames.push(any ? centered(sum) : null);
  }
  return frames;
}

/** The notes heard, a frame every few ms (null: silence) */
function heardFrames(frames: HeardFrame[], frameMs: number, heardMs: number, semitones: number) {
  const sums: (Float32Array | null)[] = Array.from(
    { length: Math.ceil(heardMs / frameMs) },
    () => null
  );
  frames.forEach((frame) => {
    const i = Math.floor(frame.positionMs / frameMs);
    if (i < 0 || i >= sums.length) return;
    const sum = sums[i] ?? new Float32Array(12);
    for (let pc = 0; pc < 12; pc += 1) sum[pc] += frame.chroma[pc];
    sums[i] = sum;
  });
  return sums.map((sum) => (sum ? centered(transposed(sum, semitones)) : null));
}

/** Where the beats are along points (beat, ms): a line fitted around each beat */
function beatsAlong(points: { beat: number; ms: number }[], lastBeat: number, around = 2) {
  const map: number[] = [];
  let from = 0;
  for (let beat = 0; beat <= lastBeat; beat += 1) {
    while (from < points.length && points[from].beat < beat - around) from += 1;
    let n = 0;
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let sxy = 0;
    for (let i = from; i < points.length && points[i].beat <= beat + around; i += 1) {
      const x = points[i].beat - beat;
      n += 1;
      sx += x;
      sy += points[i].ms;
      sxx += x * x;
      sxy += x * points[i].ms;
    }
    if (n >= 2) {
      const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx || 1);
      map.push((sy - slope * sx) / n);
    } else {
      map.push(NaN);
    }
  }
  return map;
}

/** How far the hits heard may move a beat (ms each way), and how finely */
const ONSET_RANGE_MS = 60;
const ONSET_STEP_MS = 4;
/** The notes of this many beats around a beat place it */
const ONSET_AROUND = 2;
/** The hits must stand out this much where the notes are (against anywhere around) */
const ONSET_CONFIDENCE = 1.15;
/** The onsets are compared with the ones around (ms each way): loud parts count as quiet ones */
const ONSET_NORMALIZE_MS = 1500;

/** Each beat moved to where the hits heard are (the notes of the song starting around it) */
function placeOnHits(map: BeatMap, onsets: Onset[], notes: SongOnset[]) {
  if (onsets.length < 100) return map;
  // the onsets on a grid (parts of the recording not heard stay empty)
  const steps = onsets
    .slice(1, 200)
    .map((onset, i) => onset.positionMs - onsets[i].positionMs)
    .sort((a, b) => a - b);
  const hop = steps[Math.floor(steps.length / 2)];
  const first = onsets[0].positionMs;
  const size = Math.round((onsets[onsets.length - 1].positionMs - first) / hop) + 1;
  const values = new Float32Array(size);
  const heard = new Uint8Array(size);
  onsets.forEach((onset) => {
    const i = Math.round((onset.positionMs - first) / hop);
    values[i] = Math.max(values[i], onset.value);
    heard[i] = 1;
  });
  // each onset against the onsets heard around it
  const sums = new Float64Array(size + 1);
  const counts = new Float64Array(size + 1);
  for (let i = 0; i < size; i += 1) {
    sums[i + 1] = sums[i] + values[i];
    counts[i + 1] = counts[i] + heard[i];
  }
  const reach = Math.round(ONSET_NORMALIZE_MS / hop);
  const strength = Array.from(values, (value, i) => {
    const a = Math.max(0, i - reach);
    const b = Math.min(size, i + reach + 1);
    const mean = (sums[b] - sums[a]) / Math.max(1, counts[b] - counts[a]);
    return mean > 0 ? value / mean : 0;
  });
  const strengthAt = (ms: number) => {
    const i = Math.round((ms - first) / hop);
    let max = 0;
    for (let j = i - 1; j <= i + 1; j += 1) max = Math.max(max, strength[j] ?? 0);
    return max;
  };

  const moves = map.map((_, beat) => {
    const around = notes.filter(
      (note) => note.beat >= beat - ONSET_AROUND && note.beat < beat + ONSET_AROUND
    );
    if (around.length < 3) return NaN;
    const at = around.map((note) => msOfBeat(map, note.beat));
    const scores: number[] = [];
    for (let move = -ONSET_RANGE_MS; move <= ONSET_RANGE_MS; move += ONSET_STEP_MS) {
      scores.push(around.reduce((sum, note, i) => sum + note.weight * strengthAt(at[i] + move), 0));
    }
    const best = Math.max(...scores);
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    if (mean <= 0 || best / mean < ONSET_CONFIDENCE) return NaN;
    return -ONSET_RANGE_MS + scores.indexOf(best) * ONSET_STEP_MS;
  });
  // beats without clear hits: as the nearest ones; then smoothed (one hit does not move a beat)
  const known = moves.map((move, i) => (Number.isNaN(move) ? -1 : i)).filter((i) => i >= 0);
  if (!known.length) return map;
  const filled = moves.map((move, i) => {
    if (!Number.isNaN(move)) return move;
    const next = known.find((k) => k > i);
    const previous = [...known].reverse().find((k) => k < i);
    if (next === undefined) return moves[previous as number];
    if (previous === undefined) return moves[next];
    return moves[previous] + ((moves[next] - moves[previous]) * (i - previous)) / (next - previous);
  });
  const median = filled.map((_, i) => {
    const near = filled.slice(Math.max(0, i - 2), i + 3).sort((a, b) => a - b);
    return near[Math.floor(near.length / 2)];
  });
  return map.map((ms, i) => {
    const near = median.slice(Math.max(0, i - 1), i + 2);
    return ms + near.reduce((a, b) => a + b, 0) / near.length;
  });
}

/** Each beat at least this part of a beat at the song's tempo after the one before it */
const MIN_BEAT_PART = 0.4;

/**
 * How long a song is (beats, and until its last notes: the template has a silent bar after
 * them), and the recording's tempo roughly against the song's (the song lasts about as long)
 */
function songLength(template: SongTemplate, durationMs: number, songBeatMs: number) {
  const songBeats = template.vectors.length * template.step;
  let lastNote = template.vectors.length - 1;
  while (lastNote > 0 && !template.vectors[lastNote]) lastNote -= 1;
  const endBeat = Math.min(songBeats, (lastNote + 1) * template.step + 1);
  const lengthRatio = durationMs / (endBeat * songBeatMs);
  const ratio = Math.abs(lengthRatio - 1) <= RATIO_LIMIT ? lengthRatio : 1;
  return { songBeats, endBeat, ratio };
}

/** Beats in order, never too close, and as many as the song has (past the last, on time) */
function finishMap(map: number[], songBeats: number, minGap: number) {
  for (let i = 1; i < map.length; i += 1) map[i] = Math.max(map[i], map[i - 1] + minGap);
  const tail = Math.min(8, map.length - 1);
  const lastGap = (map[map.length - 1] - map[map.length - 1 - tail]) / tail;
  while (map.length < Math.ceil(songBeats) + 1) map.push(map[map.length - 1] + lastGap);
  return map.map((ms) => Math.round(ms));
}

/**
 * Where each beat of a song is in a recording, from what was heard of it (from its start).
 * Beats past what was heard go on at the tempo of the last ones. Null when what was heard
 * does not look like the song.
 * songBeatMs: a beat at the song's own tempo
 */
export function alignSong(
  recording: Recording,
  template: SongTemplate,
  notes: SongOnset[],
  songBeatMs: number
): { map: BeatMap; heardBeats: number; match: number } | null {
  const { frames, onsets, heardMs, durationMs } = recording;
  if (frames.length < 100) return null;
  const { songBeats, endBeat, ratio } = songLength(template, durationMs, songBeatMs);
  const frameBeats = (frameMs: number) => frameMs / (songBeatMs * ratio);
  const all = heardMs >= durationMs - 5000;
  const { semitones } = findKeyShift(frames, template);

  // roughly, the whole song
  const roughSong = songFrames(template, frameBeats(ROUGH_MS), endBeat);
  const roughHeard = heardFrames(frames, ROUGH_MS, heardMs, semitones);
  const band = Math.round(Math.max(ROUGH_BAND_MS, durationMs * ROUGH_BAND_PART) / ROUGH_MS);
  const intro = Math.round(INTRO_MS / ROUGH_MS);
  const roughLo = new Int32Array(roughSong.length);
  const roughHi = new Int32Array(roughSong.length);
  roughSong.forEach((_, r) => {
    roughLo[r] = Math.max(0, r - band);
    roughHi[r] = Math.min(roughHeard.length - 1, r + band + intro);
  });
  const rough = warp(roughSong, roughHeard, roughLo, roughHi, intro, all);
  if (!rough || rough.match < MIN_MATCH) return null;
  const elsewhere = heardFrames(frames, ROUGH_MS, heardMs, semitones + 6);
  const baseline = warp(roughSong, elsewhere, roughLo, roughHi, intro, all)?.match ?? 0;
  if (rough.match - baseline < MIN_MARGIN) return null;
  const roughBeats = frameBeats(ROUGH_MS);
  const roughMsAt = (beat: number) => {
    const i = Math.max(0, Math.min(rough.rows - 1, beat / roughBeats - 0.5));
    const a = Math.floor(i);
    const b = Math.min(rough.rows - 1, a + 1);
    return (rough.cols[a] + (rough.cols[b] - rough.cols[a]) * (i - a) + 0.5) * ROUGH_MS;
  };
  const heardBeats = rough.rows * roughBeats;

  // finely, around the rough pass
  const fineBeats = frameBeats(FINE_MS);
  const fineSong = songFrames(template, fineBeats, heardBeats);
  const fineHeard = heardFrames(frames, FINE_MS, heardMs, semitones);
  const reach = Math.round(FINE_BAND_MS / FINE_MS);
  const fineLo = new Int32Array(fineSong.length);
  const fineHi = new Int32Array(fineSong.length);
  fineSong.forEach((_, r) => {
    const center = Math.round(roughMsAt((r + 0.5) * fineBeats) / FINE_MS - 0.5);
    fineLo[r] = Math.max(0, center - reach);
    fineHi[r] = Math.min(fineHeard.length - 1, center + reach);
  });
  const fine = warp(fineSong, fineHeard, fineLo, fineHi, fineHi[0], true) ?? rough;
  const fineFrameBeats = fine === rough ? roughBeats : fineBeats;
  const frameMs = fine === rough ? ROUGH_MS : FINE_MS;
  const points = Array.from(fine.cols, (col, r) => ({
    beat: (r + 0.5) * fineFrameBeats,
    ms: (col + 0.5) * frameMs,
  }));

  // each beat, then placed on the hits heard
  const lastBeat = Math.max(1, Math.floor(points[points.length - 1].beat));
  let map = beatsAlong(points, lastBeat);
  if (map.some(Number.isNaN)) return null;
  map = placeOnHits(map, onsets, notes);

  // past what was heard, at the tempo of the last beats
  return {
    map: finishMap(map, songBeats, songBeatMs * ratio * MIN_BEAT_PART),
    match: Math.round((rough.match - baseline) * 100) / 100,
    heardBeats: Math.min(heardBeats, songBeats),
  };
}

/** A place in the song where a clip of the recording fits */
type ClipFit = {
  /** how much it costs on average (0: the same notes all along, 1: other notes) */
  value: number;
  /** where the song is at each frame of the clip */
  points: { beat: number; ms: number }[];
};

/**
 * What a frame at the start or the end of a clip costs left out (noise before the song, a
 * part the song does not have): a little less than notes not looking much like the song's
 */
const CLIP_SKIP_COST = 0.4;
/** Places in the song a clip may be at: as many, each at least this far from the others */
const CLIP_PLACES = 6;
const CLIP_PLACES_APART = 4;

/**
 * Where a clip of the recording (columns, each frameMs from firstMs) fits in the song (rows,
 * each beatsPerRow): anywhere in it, at half to twice its pace. The places that fit best,
 * best first (a part of the song that repeats fits as well each time), and how well the
 * best one fits.
 */
function fitClip(
  song: (Float32Array | null)[],
  clip: (Float32Array | null)[],
  beatsPerRow: number,
  firstMs: number,
  frameMs: number,
  places: number
): { fits: ClipFit[]; best: number } {
  const rows = song.length;
  const cols = clip.length;
  const costs = new Float32Array(rows * cols);
  for (let r = 0; r < rows; r += 1) {
    const a = song[r];
    for (let c = 0; c < cols; c += 1) {
      const b = clip[c];
      let cost = 0;
      if (a && b) {
        let dot = 0;
        for (let pc = 0; pc < 12; pc += 1) dot += a[pc] * b[pc];
        cost = (1 - dot) / 2;
      } else if (a || b) {
        cost = SILENCE_COST;
      }
      costs[r * cols + c] = cost;
    }
  }
  // the clip starts anywhere in the song: each way through it (each frame of the clip counts
  // once, however many frames of the song go with it: no way is cheaper for being longer)
  const total = new Float32Array(rows * cols).fill(Infinity);
  const steps = new Uint8Array(rows * cols);
  for (let c = 0; c < cols; c += 1) {
    for (let r = 0; r < rows; r += 1) {
      const k = r * cols + c;
      const here = costs[k];
      // (it may start a few frames in: the frames before left out)
      if (c === 0) {
        total[k] = here;
      } else {
        let best = c * CLIP_SKIP_COST + here;
        let step = 3;
        if (r >= 1 && total[k - cols - 1] + here < best)
          [best, step] = [total[k - cols - 1] + here, 0];
        if (r >= 2 && total[k - 2 * cols - 1] < Infinity) {
          const value = total[k - 2 * cols - 1] + (costs[k - cols] + here) / 2 + PACE_COST;
          if (value < best) [best, step] = [value, 1];
        }
        if (r >= 1 && c >= 2 && total[k - cols - 2] < Infinity) {
          const value = total[k - cols - 2] + costs[k - 1] + here + PACE_COST;
          if (value < best) [best, step] = [value, 2];
        }
        total[k] = best;
        steps[k] = step;
      }
    }
  }
  // where the clip ends in the song (it may end a few frames early: the frames after left
  // out), on average for each frame of the clip
  const endCols = new Int32Array(rows);
  const ends = Array.from({ length: rows }, (_, r) => {
    let best = Infinity;
    for (let c = 0; c < cols; c += 1) {
      const value = total[r * cols + c] + (cols - 1 - c) * CLIP_SKIP_COST;
      if (value < best) {
        best = value;
        endCols[r] = c;
      }
    }
    return best / cols;
  });
  const apart = Math.round(CLIP_PLACES_APART / beatsPerRow);
  const chosen: number[] = [];
  Array.from(ends.keys())
    .filter((r) => Number.isFinite(ends[r]))
    .sort((a, b) => ends[a] - ends[b])
    .forEach((r) => {
      if (chosen.length < places && chosen.every((o) => Math.abs(o - r) > apart)) chosen.push(r);
    });
  const fits = chosen.map((end) => {
    // back from the end: the rows of each frame of the clip (not the ones left out)
    const sums = new Float64Array(cols);
    const counts = new Uint8Array(cols);
    const visit = (r: number, c: number) => {
      sums[c] += r;
      counts[c] += 1;
    };
    let r = end;
    let c = endCols[end];
    for (;;) {
      visit(r, c);
      const step = steps[r * cols + c];
      if (c === 0 || step === 3) break;
      if (step === 1) {
        visit(r - 1, c);
        r -= 2;
        c -= 1;
      } else if (step === 2) {
        visit(r, c - 1);
        r -= 1;
        c -= 2;
      } else {
        r -= 1;
        c -= 1;
      }
    }
    return {
      value: ends[end],
      points: Array.from(sums, (sum, i) => ({
        beat: (sum / counts[i] + 0.5) * beatsPerRow,
        ms: firstMs + (i + 0.5) * frameMs,
      })).filter((_, i) => counts[i] > 0),
    };
  });
  return { fits, best: fits[0]?.value ?? Infinity };
}

/**
 * Picking a place for each clip: the tempo between clips must not change much from one gap
 * to the next (per change of the log of the tempo), nor be far from the song's (less)
 */
const GAP_CHANGE_COST = 1;
const GAP_TEMPO_COST = 0.4;
/** a clip must fit this much better than moved a tritone away (half the correlation margin) */
const CLIP_MARGIN = MIN_MARGIN / 2;

/**
 * Where each beat of a song is in a recording, from clips of it (a few seconds here and
 * there): each clip is found in the song, a place among the ones it fits for each clip (the
 * tempo going on steadily between them), then the beats between clips at the tempo between
 * them. Null when the clips do not look like the song.
 */
export function alignClips(
  recording: Recording & { clips: [number, number][] },
  template: SongTemplate,
  notes: SongOnset[],
  songBeatMs: number
): { map: BeatMap; match: number; used: number } | null {
  const { frames, onsets, durationMs, clips } = recording;
  if (frames.length < 100) return null;
  const { songBeats, endBeat, ratio } = songLength(template, durationMs, songBeatMs);
  const beatMs = songBeatMs * ratio;
  const rowBeats = FINE_MS / beatMs;
  const song = songFrames(template, rowBeats, endBeat);
  const { semitones } = findKeyShift(frames, template);

  // each clip: the places in the song it fits (the ones fitting clearly better than moved)
  const found = clips
    .map(([fromMs, toMs]) => {
      const inClip = frames.filter((f) => f.positionMs >= fromMs && f.positionMs < toMs);
      if (inClip.length < 40) return null;
      // (without the silence at its ends: before the song starts, after it ends)
      const first = Math.floor(inClip[0].positionMs / FINE_MS);
      const last = Math.floor(inClip[inClip.length - 1].positionMs / FINE_MS);
      const heard = (shift: number) =>
        heardFrames(inClip, FINE_MS, (last + 1) * FINE_MS, shift).slice(first);
      const clip = heard(semitones);
      const { fits, best } = fitClip(song, clip, rowBeats, first * FINE_MS, FINE_MS, CLIP_PLACES);
      const moved = fitClip(song, heard(semitones + 6), rowBeats, 0, FINE_MS, 1).best;
      return moved - best >= CLIP_MARGIN ? { fits, margin: moved - best } : null;
    })
    .filter((clip): clip is { fits: ClipFit[]; margin: number } => !!clip?.fits.length);
  if (!found.length) return null;

  // a place for each clip: every way tried (a few places for a few clips)
  const startOf = (fit: ClipFit) => fit.points[0];
  const endOf = (fit: ClipFit) => fit.points[fit.points.length - 1];
  let best: { value: number; fits: ClipFit[] } | null = null;
  const pick = (i: number, fits: ClipFit[], value: number, gapLog: number | null) => {
    if (best && value >= best.value) return;
    if (i === found.length) {
      best = { value, fits };
      return;
    }
    found[i].fits.forEach((fit) => {
      let next = value + fit.value;
      let log: number | null = null;
      const previous = fits[fits.length - 1];
      if (previous) {
        const beats = startOf(fit).beat - endOf(previous).beat;
        if (beats <= 0) return;
        log = Math.log((startOf(fit).ms - endOf(previous).ms) / beats / beatMs);
        next += GAP_TEMPO_COST * Math.abs(log);
        if (gapLog !== null) next += GAP_CHANGE_COST * Math.abs(log - gapLog);
      } else {
        // the first clip: the song starts about when the recording does (an intro of silence)
        const startMs = startOf(fit).ms - startOf(fit).beat * beatMs;
        const off = Math.max(0, -startMs - 1000, startMs - INTRO_MS);
        next += GAP_TEMPO_COST * (off / Math.max(startOf(fit).ms, 10000));
      }
      pick(i + 1, [...fits, fit], next, log ?? gapLog);
    });
  };
  pick(0, [], 0, null);
  const chosen = (best as { value: number; fits: ClipFit[] } | null)?.fits;
  if (!chosen) return null;

  // the beats in each clip, then between clips at the tempo between them
  const lastBeat = Math.max(1, Math.ceil(endBeat));
  const map: number[] = new Array(lastBeat + 1).fill(NaN);
  const known = new Uint8Array(lastBeat + 1);
  chosen.forEach((fit) => {
    const inClip = beatsAlong(fit.points, lastBeat);
    const from = Math.ceil(startOf(fit).beat);
    const to = Math.floor(endOf(fit).beat);
    for (let beat = Math.max(0, from); beat <= Math.min(lastBeat, to); beat += 1) {
      if (!Number.isNaN(inClip[beat])) {
        map[beat] = inClip[beat];
        known[beat] = 1;
      }
    }
  });
  const anchors = Array.from(known.keys()).filter((beat) => known[beat]);
  // the first beat of the second clip, and the last beat of the clip before the last one
  const clipStarts = anchors.filter((beat) => beat === 0 || !known[beat - 1]);
  if (clipStarts.length < 2) return null;
  const secondClip = clipStarts[1];
  const beforeLastClip = anchors.filter((beat) => beat < clipStarts[clipStarts.length - 1]).pop();
  if (beforeLastClip === undefined) return null;
  const fillBetween = (beats: number[]) => {
    const firstKnown = anchors[0];
    const lastKnown = anchors[anchors.length - 1];
    // before the first clip and after the last one: at the tempo from it to the next clip
    const headTempo = (beats[secondClip] - beats[firstKnown]) / (secondClip - firstKnown);
    const tailTempo = (beats[lastKnown] - beats[beforeLastClip]) / (lastKnown - beforeLastClip);
    return beats.map((ms, beat) => {
      if (known[beat]) return ms;
      if (beat < firstKnown) return beats[firstKnown] - (firstKnown - beat) * headTempo;
      if (beat > lastKnown) return beats[lastKnown] + (beat - lastKnown) * tailTempo;
      let before = beat - 1;
      while (!known[before]) before -= 1;
      let after = beat + 1;
      while (!known[after]) after += 1;
      return beats[before] + ((beats[after] - beats[before]) * (beat - before)) / (after - before);
    });
  };
  const filled = fillBetween(map);
  // placed on the hits heard (in the clips), the beats between clips again between them
  const placed = fillBetween(placeOnHits(filled, onsets, notes));
  return {
    map: finishMap(placed, songBeats, beatMs * MIN_BEAT_PART),
    match:
      Math.round((found.reduce((sum, clip) => sum + clip.margin, 0) / found.length) * 200) / 100,
    used: chosen.length,
  };
}

/** How often the notes are read in a recording (ms), and the samples analysed at once */
const HEAR_MS = 50;
const HEAR_SIZE = 4096;

/** What is heard in a whole recording (to test) */
export function hearSamples(samples: Float32Array, rate: number): Recording {
  const frames: HeardFrame[] = [];
  const hop = Math.round((rate * HEAR_MS) / 1000);
  for (let start = 0; start + HEAR_SIZE <= samples.length; start += hop) {
    const chroma = chromaOfSamples(samples.subarray(start, start + HEAR_SIZE), rate);
    if (chroma) frames.push({ positionMs: ((start + HEAR_SIZE / 2) / rate) * 1000, chroma });
  }
  const heardMs = (samples.length / rate) * 1000;
  return { frames, onsets: onsetsOfSamples(samples, rate), heardMs, durationMs: heardMs };
}
