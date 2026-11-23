import { fingeringChoices, tonicsChoices } from '../fields';

export const fields = {
  showTitle: {
    choices: [
      { value: 'start', label: 'Show it from the start' },
      { value: 'end', label: 'Mystery song (revealed at the end)' },
    ],
  },
  playOn: {
    choices: [
      { value: 'youtube', label: 'YouTube' },
      { value: 'spotify', label: 'Spotify' },
      { value: 'none', label: "Don't play" },
    ],
  },
  view: {
    choices: [
      { value: 'lane', label: 'Lane (from right to left)' },
      { value: 'highway', label: 'Highway (falling down 7 lanes)' },
    ],
  },
  keyboardKeys: {
    choices: [
      { value: 'fit', label: 'Fit each song' },
      { value: '25', label: '25 keys (C3–C5)' },
      { value: '37', label: '37 keys (C3–C6)' },
      { value: '49', label: '49 keys (C2–C6)' },
      { value: '61', label: '61 keys (C2–C7)' },
      { value: '76', label: '76 keys (E1–G7)' },
      { value: '88', label: '88 keys (A0–C8)' },
    ],
  },
  repeatedNotes: {
    choices: [
      { value: 'hold', label: 'Strike once a bar, hold for the rest' },
      { value: 'each', label: 'Strike every strum' },
    ],
  },
  keyboardOctave: {
    choices: [
      { value: 'song', label: "The song's notes, where it plays them" },
      { value: 'follow', label: 'Follows the octave you play in' },
      { value: 'fixed', label: 'Stays in one octave' },
    ],
  },
  spotifySlowDown: {
    choices: [
      { value: 'game', label: 'Pause Spotify, the game plays it slower' },
      { value: 'wait', label: 'Wait for the note' },
    ],
  },
  onMiss: {
    choices: [
      { value: 'continue', label: 'Keep going' },
      { value: 'wait', label: 'Wait for the note' },
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
  playPart: {
    choices: [
      { value: 'chords', label: 'The chords' },
      { value: 'lead', label: 'The lead guitar' },
      { value: 'melody', label: 'The melody' },
      { value: 'bass', label: 'The bass' },
    ],
  },
  sound: {
    choices: [
      { value: 'chords', label: 'The chords of the song' },
      { value: 'click', label: 'A click on the beat' },
      { value: 'both', label: 'Chords and click' },
      { value: 'off', label: 'No sound' },
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
