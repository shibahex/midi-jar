/* eslint-disable no-bitwise */
import { MidiMessage } from 'main/types';

export const getMidiCommand = (m: MidiMessage) => (m[0] >> 4) << 4;

export const getMidiChannel = (m: MidiMessage) => (m[0] & 0xf) + 1;

export const getMidiNote = (m: MidiMessage) => m[1];

export const getMidiValue = (m: MidiMessage) => m[2];

// MSB and LSB values
export const getMidiMultiWordValue = (m: MidiMessage) => m[2] * 128 + m[1];

const MIN_OCTAVE_SHIFT = -3;
const MAX_OCTAVE_SHIFT = 2;

/** Keeps a learning keyboard octave shift within the range of a piano */
export const clampOctaveShift = (shift: number) =>
  Math.min(MAX_OCTAVE_SHIFT, Math.max(MIN_OCTAVE_SHIFT, shift));
