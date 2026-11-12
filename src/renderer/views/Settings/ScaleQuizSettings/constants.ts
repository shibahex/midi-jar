import { SOLO_SCALES } from 'renderer/helpers';
import { fingeringChoices, tonicsChoices } from '../fields';

export const fields = {
  // key of the melodies: same values as the scales tonic
  melodyKey: {
    choices: [
      { value: 'random', label: 'Random key' },
      { value: 'sequential', label: 'In order (C to B)' },
      { value: 'randomInKey', label: 'Current key (Notation settings)' },
    ],
  },
  practice: {
    choices: [
      { value: 'scales', label: 'Scales' },
      { value: 'melodies', label: 'Melodies (Ode to Joy, Twinkle Twinkle...)' },
      { value: 'solo', label: 'Solo phrases (play over a backing track)' },
    ],
  },
  soloKey: {
    choices: [
      { value: 'current', label: 'Current key (Notation settings)' },
      ...['C', 'C♯ / D♭', 'D', 'E♭', 'E', 'F', 'F♯ / G♭', 'G', 'A♭', 'A', 'B♭', 'B'].map(
        (label, chroma) => ({ value: `${chroma}`, label })
      ),
    ],
  },
  soloScale: {
    choices: SOLO_SCALES.map((value) => ({
      value,
      label: value === 'minor' ? 'Natural Minor' : value.replace(/\b\w/g, (c) => c.toUpperCase()),
    })),
  },
  soloLength: {
    choices: [
      { value: 'short', label: 'Short (4 to 6 notes)' },
      { value: 'medium', label: 'Medium (6 to 9 notes)' },
      { value: 'long', label: 'Long (9 to 12 notes)' },
    ],
  },
  mode: {
    choices: [
      {
        value: 'random',
        label: 'Random',
      },
      {
        value: 'randomInKey',
        label: 'Scales of the current Key',
      },
    ],
  },
  scaleQuizMode: {
    choices: [
      {
        value: 'random',
        label: 'Random',
      },
      {
        value: 'sequential',
        label: 'In order (C to B)',
      },
      {
        value: 'randomInKey',
        label: 'Scales of the current Key',
      },
    ],
  },
  tonics: {
    choices: tonicsChoices,
  },
  scales: {
    choices: [
      {
        value: 'major',
        label: 'Major',
      },
      {
        value: 'minor',
        label: 'Natural Minor',
      },
      {
        value: 'majorMinor',
        label: 'Major & Natural Minor',
      },
      {
        value: 'modes',
        label: 'Modes (Ionian to Locrian)',
      },
      {
        value: 'minors',
        label: 'Natural, Harmonic & Melodic Minor',
      },
      {
        value: 'pentatonics',
        label: 'Pentatonics & Blues',
      },
      {
        value: 'all',
        label: 'All scales',
      },
    ],
  },
  direction: {
    choices: [
      {
        value: 'up',
        label: 'Ascending',
      },
      {
        value: 'down',
        label: 'Descending',
      },
      {
        value: 'upDown',
        label: 'Ascending & Descending',
      },
    ],
  },
  requiredCleanRuns: {
    choices: [
      {
        value: '0',
        label: 'Off',
      },
      {
        value: '1',
        label: '1 run',
      },
      {
        value: '2',
        label: '2 runs in a row',
      },
      {
        value: '3',
        label: '3 runs in a row',
      },
    ],
  },
  fingering: {
    choices: fingeringChoices,
  },
};
