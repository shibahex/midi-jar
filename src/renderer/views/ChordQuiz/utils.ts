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
