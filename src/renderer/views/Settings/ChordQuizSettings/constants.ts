import { getDictionaryChordsByComplexity } from 'renderer/hooks/useQuiz';

import { fingeringChoices, tonicsChoices } from '../fields';

export const fields = {
  fingering: {
    choices: fingeringChoices,
  },
  tonics: {
    choices: tonicsChoices,
  },
  chords: {
    choices: [
      { value: 'majorMinor', label: 'Major & minor triads' },
      { value: 'triads', label: 'Triads (with dim, aug, sus)' },
      { value: 'sevenths', label: '7th chords' },
      { value: 'ninths', label: '9th chords' },
      { value: 'triadsSevenths', label: 'Triads & 7th chords' },
      { value: 'all', label: 'All chords (by difficulty)' },
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
        label: 'Random in Key',
      },
      {
        value: 'progressions',
        label: 'Chord Progressions (I–IV–V, ii–V–I...)',
      },
    ],
  },
  progressionKey: {
    choices: [
      { value: 'random', label: 'Random key' },
      { value: 'current', label: 'Current key (Notation settings)' },
    ],
  },
  difficulty: {
    choices: [
      {
        value: '0',
        label: 'Very Easy',
      },
      {
        value: '1',
        label: 'Easy',
      },
      {
        value: '2',
        label: 'Medium',
      },
      {
        value: '3',
        label: 'Hard',
      },
      {
        value: '4',
        label: 'Very Hard',
      },
      {
        value: '5',
        label: 'All chords',
      },
    ],
  },
  chordNotation: {
    choices: [
      {
        value: 'long',
        label: 'Long (min, maj, dom, aug, dim...)',
      },
      {
        value: 'short',
        label: 'Short (m, M, aug, dim...)',
      },
      {
        value: 'symbol',
        label: 'Symbol (-, Δ, +, °...)',
      },
      {
        value: 'preferred',
        label: 'Preferred (in dictionary)',
      },
    ],
  },
};

export const chordsByComplexity = getDictionaryChordsByComplexity();
