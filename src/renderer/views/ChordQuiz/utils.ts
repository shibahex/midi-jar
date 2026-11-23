import { clampOctaveShift } from 'renderer/helpers';

/**
 * Octaves between the chord shown from the 4th octave and the chord being played:
 * the root is placed at or below the lowest played note of the chord.
 *
 * @returns the shift, or null if no note of the chord is played
 */
export const getChordOctaveShift = (chordMidi: number[], playedMidi: number[]): number | null => {
  const chromas = chordMidi.map((m) => m % 12);
  const chordNotes = playedMidi.filter((m) => chromas.includes(m % 12));
  if (chordNotes.length === 0 || chordMidi.length === 0) return null;

  const lowest = Math.min(...chordNotes);
  const tonic = chordMidi[0];
  const playedTonic = lowest - ((((lowest - tonic) % 12) + 12) % 12);
  return clampOctaveShift((playedTonic - tonic) / 12);
};

/**
 * The octave to show a chord in, as the keyboard follows the playing: it moves only when the
 * whole chord is played, outside the keys shown (two octaves from the shift): a stray note, or
 * a chord played within the keys shown, does not move it. Null: it stays.
 */
export const getFollowedOctaveShift = (
  chordMidi: number[],
  playedMidi: number[],
  shownShift: number
): number | null => {
  const chromas = new Set(chordMidi.map((m) => m % 12));
  const chordNotes = playedMidi.filter((m) => chromas.has(m % 12));
  if (!chordNotes.length || new Set(chordNotes.map((m) => m % 12)).size < chromas.size) return null;
  const low = 60 + 12 * shownShift;
  const high = low + 24;
  if (chordNotes.every((m) => m >= low && m < high)) return null;
  const shift = getChordOctaveShift(chordMidi, chordNotes);
  return shift === shownShift ? null : shift;
};
