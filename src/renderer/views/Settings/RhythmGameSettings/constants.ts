import { fingeringChoices, tonicsChoices } from '../fields';

export const fields = {
  showTitle: {
    choices: [
      { value: 'start', label: 'Show it from the start' },
      { value: 'end', label: 'Mystery song (revealed at the end)' },
    ],
  },
  onMiss: {
    choices: [
      { value: 'continue', label: 'Keep going' },
      { value: 'wait', label: 'Wait for the chord' },
      { value: 'slowDown', label: 'Slow down' },
    ],
  },
  pattern: {
    choices: [
      { value: 'song', label: "The song's rhythm" },
      { value: 'bar', label: 'Once per bar' },
      { value: 'half', label: 'Twice per bar' },
      { value: 'beat', label: 'On every beat' },
    ],
  },
  songKey: {
    choices: [
      { value: 'random', label: 'Random key' },
      { value: 'current', label: 'Current key (Notation settings)' },
    ],
  },
  tonics: {
    choices: tonicsChoices,
  },
  fingering: {
    choices: fingeringChoices,
  },
};
