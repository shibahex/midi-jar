import { Note } from 'tonal';

/**
 * Melodies of public domain songs, written as degrees of the major scale:
 * "," is an octave lower, "'" an octave higher (5, = the 5th below the tonic)
 */
export type MelodyInfo = {
  id: string;
  title: string;
  notes: string;
};

export const MELODIES: MelodyInfo[] = [
  {
    id: 'ode-to-joy',
    title: 'Ode to Joy',
    notes: '3 3 4 5 5 4 3 2 1 1 2 3 3 2 2  3 3 4 5 5 4 3 2 1 1 2 3 2 1 1',
  },
  {
    id: 'twinkle',
    title: 'Twinkle Twinkle Little Star',
    notes: '1 1 5 5 6 6 5  4 4 3 3 2 2 1',
  },
  {
    id: 'mary',
    title: 'Mary Had a Little Lamb',
    notes: '3 2 1 2 3 3 3  2 2 2  3 5 5  3 2 1 2 3 3 3 3  2 2 3 2 1',
  },
  {
    id: 'frere-jacques',
    title: 'Frère Jacques',
    notes: '1 2 3 1 1 2 3 1  3 4 5 3 4 5  5 6 5 4 3 1 5 6 5 4 3 1  1 5, 1 1 5, 1',
  },
  {
    id: 'amazing-grace',
    title: 'Amazing Grace',
    notes: '5, 1 3 1 3 2 1 6, 5,  5, 1 3 1 3 2 5  3 5 3 5 3 1 5, 6, 1 1 6, 5,  5, 1 3 1 3 2 1',
  },
  {
    id: 'saints',
    title: 'When the Saints Go Marching In',
    notes: '1 3 4 5 1 3 4 5 1 3 4 5 3 1 3 2  3 3 2 1 1 3 5 5 4  3 4 5 3 1 2 1',
  },
];

const MAJOR_DEGREES = ['1P', '2M', '3M', '4P', '5P', '6M', '7M'];
const SEMITONES = [0, 2, 4, 5, 7, 9, 11];

/**
 * Melodies that are practiced: all of them but the excluded ones
 * (all of them if every melody is excluded)
 */
export const getIncludedMelodies = (excluded: string[] = []) => {
  const included = MELODIES.filter((m) => !excluded.includes(m.id));
  return included.length ? included : MELODIES;
};

/**
 * Notes of a melody in a major key: pitch class, degree (0 = tonic) and key to play.
 * Keys are placed from the tonic in the 4th octave, an octave higher if the melody
 * goes below it, so the melody fits the learning keyboard (C4 to B5).
 */
export function getMelodyNotes(melody: MelodyInfo, tonic: string) {
  const tonicMidi = 60 + (Note.chroma(tonic) ?? 0);
  const notes = melody.notes
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => {
      const degree = Number(token[0]) - 1;
      const octave = (token.match(/'/g)?.length ?? 0) - (token.match(/,/g)?.length ?? 0);
      return {
        note: Note.pitchClass(Note.transpose(tonic, MAJOR_DEGREES[degree])),
        degree,
        midi: tonicMidi + SEMITONES[degree] + 12 * octave,
      };
    });

  const lowest = Math.min(...notes.map((n) => n.midi));
  const shift = lowest < 60 ? 12 : 0;
  return notes.map((n) => ({ ...n, midi: n.midi + shift }));
}
