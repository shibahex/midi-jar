import { Chord } from '@tonaljs/chord';
import { KeyboardSettings } from 'main/types';
import { KeySignatureConfig } from 'renderer/helpers';

export type PianoKeyboardProps = {
  id?: string;
  className?: string;
  keyboard?: KeyboardSettings;
  keySignature?: KeySignatureConfig;
  played?: number[];
  sustained?: number[];
  midi?: number[];
  targets?: number[] | null;
  exactTargets?: boolean;
  softTargets?: number[] | null;
  /** notes played in another octave than the keys to play (they count): shown apart */
  otherOctave?: number[] | null;
  /** keys still held from the notes just played right: green, not red */
  rightPlayed?: number[] | null;
  chord?: Chord;
};
