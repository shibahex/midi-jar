import { fingeringChoices } from '../fields';

export const fields = {
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
    choices: [
      {
        value: 'all',
        label: 'All keys',
      },
      {
        value: 'natural',
        label: 'Natural keys only (no sharps or flats)',
      },
    ],
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
