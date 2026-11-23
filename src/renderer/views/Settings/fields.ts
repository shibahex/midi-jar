/** Choices shared by several settings pages */

export const fingeringChoices = [
  { value: 'right', label: 'Right hand' },
  { value: 'left', label: 'Left hand' },
  { value: 'both', label: 'Both hands' },
  { value: 'none', label: 'None' },
];

/** Tonics asked: every key, natural keys only, or sharps and flats only */
export const tonicsChoices = [
  { value: 'all', label: 'All keys' },
  { value: 'natural', label: 'Natural keys only (no sharps or flats)' },
  { value: 'accidentals', label: 'Sharps and flats only' },
];
