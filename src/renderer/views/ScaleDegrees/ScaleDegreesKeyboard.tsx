import React, { useMemo } from 'react';
import { Interval, Note } from 'tonal';

import { FingerMark, KeyLegend, LearningKeyboard } from 'renderer/components';
import { getKeySignatureSpelledLike, ScaleInfo } from 'renderer/helpers';

type Props = {
  scale: ScaleInfo;
  /** index of the degree asked */
  degree: number;
  keyName: string;
  sharps: boolean;
  playedMidiNotes: number[];
  sustainedMidiNotes: number[];
  midiNotes: number[];
};

/**
 * Keyboard of the scale: each key shows its degree, the asked degree is the key to play
 */
const ScaleDegreesKeyboard: React.FC<Props> = ({
  scale,
  degree,
  keyName,
  sharps,
  playedMidiNotes,
  sustainedMidiNotes,
  midiNotes,
}) => {
  // the scale from its tonic in the 4th octave
  const scaleMidi = useMemo(() => {
    const tonicMidi = 60 + (Note.chroma(scale.tonic) ?? 0);
    return scale.intervals.map((interval) => tonicMidi + (Interval.semitones(interval) ?? 0));
  }, [scale]);

  const keySignature = useMemo(
    () => getKeySignatureSpelledLike(keyName, sharps, scale.notes),
    [keyName, sharps, scale]
  );

  // degree numbers take the place of finger numbers
  const marks = useMemo(
    () =>
      scaleMidi.map(
        (midi, index): FingerMark => ({
          midi,
          hand: 'right',
          finger: index + 1,
          next: index === degree,
        })
      ),
    [scaleMidi, degree]
  );

  return (
    <LearningKeyboard
      octaveShift={0}
      keySignature={keySignature}
      targets={[scaleMidi[degree]]}
      softTargets={scaleMidi}
      marks={marks}
      played={playedMidiNotes}
      sustained={sustainedMidiNotes}
      midi={midiNotes}
    >
      <KeyLegend
        items={[
          { type: 'target', label: 'degree to play' },
          { type: 'soft', label: 'in the scale (numbers are degrees)' },
        ]}
      />
    </LearningKeyboard>
  );
};

export default ScaleDegreesKeyboard;
