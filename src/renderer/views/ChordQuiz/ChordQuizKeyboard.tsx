import React, { useEffect, useMemo, useState } from 'react';
import { Interval, Note } from 'tonal';
import { Chord as TChord } from '@tonaljs/chord';

import { Fingering } from 'main/types';
import { FingerMark, FingerRow, HandChip, KeyLegend, LearningKeyboard } from 'renderer/components';
import { getChordFingering, getFingeringHands, getKeySignatureSpelledLike } from 'renderer/helpers';

import { getChordOctaveShift } from './utils';

/** B5: top of the keyboard before adding an octave */
const KEYBOARD_TOP = 83;

type Props = {
  target: TChord;
  keyName: string;
  sharps: boolean;
  fingering: Fingering;
  playedMidiNotes: number[];
  sustainedMidiNotes: number[];
  midiNotes: number[];
};

/**
 * Keyboard showing the keys of the target chord in root position, in the octave it is played in
 */
const ChordQuizKeyboard: React.FC<Props> = ({
  target,
  keyName,
  sharps,
  fingering,
  playedMidiNotes,
  sustainedMidiNotes,
  midiNotes,
}) => {
  // the keyboard follows the octave the chord is played in, and stays there for the next chords
  const [octaveShift, setOctaveShift] = useState(0);

  const baseChordMidi = useMemo(() => {
    const tonicMidi = 60 + (Note.chroma(target.tonic ?? 'C') ?? 0);
    return target.intervals.map((interval) => tonicMidi + (Interval.semitones(interval) ?? 0));
  }, [target]);

  useEffect(() => {
    const shift = getChordOctaveShift(baseChordMidi, playedMidiNotes);
    if (shift !== null) setOctaveShift(shift);
  }, [baseChordMidi, playedMidiNotes]);

  const chordMidi = useMemo(
    () => baseChordMidi.map((midi) => midi + 12 * octaveShift),
    [baseChordMidi, octaveShift]
  );

  // key names spelled like the chord
  const keySignature = useMemo(
    () => getKeySignatureSpelledLike(keyName, sharps, target.notes),
    [keyName, sharps, target]
  );

  const hands = useMemo(() => getFingeringHands(fingering), [fingering]);

  const fingers = useMemo(
    () =>
      hands.map((hand) => ({
        hand,
        midis: [...chordMidi].sort((a, b) => a - b),
        fingers: getChordFingering(chordMidi, hand),
      })),
    [hands, chordMidi]
  );

  const fingerMarks = useMemo(
    () =>
      fingers.flatMap(({ hand, midis, fingers: f }) =>
        midis.map((midi, i): FingerMark => ({ midi, hand, finger: f[i], next: true }))
      ),
    [fingers]
  );

  return (
    <LearningKeyboard
      octaveShift={octaveShift}
      // big chords (9th, 13th…) can go past the top
      extraOctave={Math.max(...baseChordMidi) > KEYBOARD_TOP}
      keySignature={keySignature}
      targets={chordMidi}
      marks={fingerMarks}
      hideKeyNames={hands.length > 1}
      played={playedMidiNotes}
      sustained={sustainedMidiNotes}
      midi={midiNotes}
    >
      {fingers.length > 0 && (
        <FingerRow>
          {fingers.map(({ hand, fingers: f }) => (
            <HandChip key={hand} hand={hand}>
              <strong>{f.join(' ')}</strong>
            </HandChip>
          ))}
        </FingerRow>
      )}
      <KeyLegend
        items={[
          {
            type: 'target',
            label: 'keys of the chord (follows the octave you play in, any inversion works)',
          },
        ]}
      />
    </LearningKeyboard>
  );
};

export default ChordQuizKeyboard;
