import React, { useMemo } from 'react';

import { FingerMark, FingerRow, HandChip, KeyLegend, LearningKeyboard } from 'renderer/components';
import { FINGER_NAMES, formatSharpsFlats, Hand, KeySignatureConfig } from 'renderer/helpers';

import { Step } from './reducer';
import { Fingers } from './utils';

type Props = {
  /** keys shown as "in the scale" (default: the keys of the steps) */
  scaleKeys?: number[];
  /** notes played in order (melodies): only the next note shows its finger */
  sequential?: boolean;
  steps: Step[];
  position: number;
  keySignature: KeySignatureConfig;
  acceptedMidi: number[];
  octaveShift: number;
  hands: Hand[];
  fingers: Fingers;
  playedMidiNotes: number[];
  sustainedMidiNotes: number[];
  midiNotes: number[];
};

const ScaleQuizKeyboard: React.FC<Props> = ({
  scaleKeys,
  sequential = false,
  steps: scaleSteps,
  position,
  keySignature,
  acceptedMidi,
  octaveShift,
  hands,
  fingers,
  playedMidiNotes,
  sustainedMidiNotes,
  midiNotes,
}) => {
  // two octaves from the octave the scale is played in
  const steps = useMemo(
    () => scaleSteps.map((step) => ({ ...step, midi: step.midi + 12 * octaveShift })),
    [scaleSteps, octaveShift]
  );

  const nextStep = steps[position];

  const scaleMidi = useMemo(
    () =>
      scaleKeys ? scaleKeys.map((midi) => midi + 12 * octaveShift) : steps.map((step) => step.midi),
    [scaleKeys, steps, octaveShift]
  );

  // the next key, and accepted keys still held so they are displayed as correct
  const targets = useMemo(
    () => [...(nextStep ? [nextStep.midi] : []), ...acceptedMidi],
    [nextStep, acceptedMidi]
  );

  const fingerMarks = useMemo(() => {
    // a melody comes back to the same key with other fingers: only the next note is marked
    if (sequential) {
      return nextStep
        ? hands.map(
            (hand): FingerMark => ({
              midi: nextStep.midi,
              hand,
              finger: fingers[hand][nextStep.upIndex],
              next: true,
            })
          )
        : [];
    }
    return hands.flatMap((hand) =>
      steps
        .filter((step, index) => steps.findIndex((s) => s.upIndex === step.upIndex) === index)
        .map(
          (step): FingerMark => ({
            midi: step.midi,
            hand,
            finger: fingers[hand][step.upIndex],
            next: !!nextStep && nextStep.upIndex === step.upIndex,
          })
        )
    );
  }, [sequential, hands, steps, fingers, nextStep]);

  return (
    <LearningKeyboard
      octaveShift={octaveShift}
      keySignature={keySignature}
      targets={targets}
      softTargets={scaleMidi}
      marks={fingerMarks}
      hideKeyNames={hands.length > 1}
      played={playedMidiNotes}
      sustained={sustainedMidiNotes}
      midi={midiNotes}
    >
      {nextStep && hands.length > 0 && (
        <FingerRow>
          <span>
            Next: <strong>{formatSharpsFlats(nextStep.note)}</strong>
          </span>
          {hands.map((hand) => {
            const finger = fingers[hand][nextStep.upIndex];
            return (
              <HandChip key={hand} hand={hand}>
                <strong>{finger}</strong> ({FINGER_NAMES[finger]})
              </HandChip>
            );
          })}
        </FingerRow>
      )}
      <KeyLegend
        items={[
          { type: 'target', label: 'next key' },
          { type: 'soft', label: 'in the scale' },
        ]}
      />
    </LearningKeyboard>
  );
};

ScaleQuizKeyboard.defaultProps = {
  scaleKeys: undefined,
  sequential: false,
};

export default ScaleQuizKeyboard;
