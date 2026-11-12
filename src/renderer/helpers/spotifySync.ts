import { ImportedSong } from 'main/types';

const BEATS_PER_BAR = 4;

/** Part of the extra time of a recording (beyond the song's notes) that is before them */
const SILENCE_BEFORE = 0.3;
/** At most this much silence is guessed before the song (ms) */
const MAX_SILENCE = 4000;

/**
 * Where the first chord of a song is in its Spotify recording (ms), estimated from the length
 * of the recording and of the song (at its tempo), and snapped to the nearest bar when
 * Spotify tells where the bars are
 */
export function estimateFirstChordMs(
  song: ImportedSong,
  durationMs: number,
  bars: number[] | null
) {
  if (!song.bpm) return null;
  const beatMs = 60000 / song.bpm;
  const beatsPerBar = song.beatsPerBar ?? BEATS_PER_BAR;
  const leadIn = song.leadIn ?? 0;
  const songBeats =
    leadIn + song.chords.reduce((sum, _, i) => sum + (song.beats?.[i] ?? beatsPerBar), 0);
  // the recording is longer than the song's notes: some of it is silence before them
  const extra = Math.max(0, durationMs - songBeats * beatMs);
  const estimate = Math.min(extra * SILENCE_BEFORE, MAX_SILENCE) + leadIn * beatMs;
  if (!bars?.length) return Math.round(estimate);
  return bars.reduce((best, bar) =>
    Math.abs(bar - estimate) < Math.abs(best - estimate) ? bar : best
  );
}

/** Middle value of timing offsets (ms), or null when there are too few */
export function medianOffset(offsets: number[], minimum = 8) {
  if (offsets.length < minimum) return null;
  const sorted = [...offsets].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}
