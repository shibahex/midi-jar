import React, { useMemo, useRef } from 'react';
import classnames from 'classnames/bind';

import { KeyboardSettings } from 'main/types';
import { defaultKeyboardSettings } from 'main/store/defaults';
import { PianoKeyboard } from 'renderer/components';
import { formatSharpsFlats, Hand, KeySignatureConfig } from 'renderer/helpers';

import FingerBadges, { FingerMark } from './FingerBadges';
import { Step } from './reducer';
import { Fingers } from './utils';

import styles from './ScaleQuiz.module.scss';

const cx = classnames.bind(styles);

const HAND_LABEL: Record<Hand, string> = { right: 'Right hand', left: 'Left hand' };
const FINGER_NAMES = ['', 'thumb', 'index', 'middle', 'ring', 'pinky'];

const baseKeyboardSettings: KeyboardSettings = {
  ...defaultKeyboardSettings,
  label: 'pitchClass',
  keyInfo: 'none',
  textOpacity: 1,
  wrap: true,
  sizes: { ...defaultKeyboardSettings.sizes, height: 5 },
};

type Props = {
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
  const keyboardRef = useRef<HTMLDivElement>(null);

  // two octaves from the octave the scale is played in
  const steps = useMemo(
    () => scaleSteps.map((step) => ({ ...step, midi: step.midi + 12 * octaveShift })),
    [scaleSteps, octaveShift]
  );

  const keyboardSettings = useMemo(
    (): KeyboardSettings => ({
      ...baseKeyboardSettings,
      from: `C${4 + octaveShift}`,
      to: `B${5 + octaveShift}`,
      // with both hands, finger numbers take the place of key names
      keyName: hands.length > 1 ? 'none' : baseKeyboardSettings.keyName,
    }),
    [octaveShift, hands.length]
  );

  const nextStep = steps[position];

  const scaleMidi = useMemo(() => steps.map((step) => step.midi), [steps]);

  // the next key, and accepted keys still held so they are displayed as correct
  const targets = useMemo(
    () => [...(nextStep ? [nextStep.midi] : []), ...acceptedMidi],
    [nextStep, acceptedMidi]
  );

  const fingerMarks = useMemo(
    () =>
      hands.flatMap((hand) =>
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
      ),
    [hands, steps, fingers, nextStep]
  );

  return (
    <div className={cx('learn')}>
      <div className={cx('keyboardContainer')} ref={keyboardRef}>
        <PianoKeyboard
          className={cx('keyboard')}
          keyboard={keyboardSettings}
          keySignature={keySignature}
          softTargets={scaleMidi}
          targets={targets}
          exactTargets
          played={playedMidiNotes}
          sustained={sustainedMidiNotes}
          midi={midiNotes}
        />
        <FingerBadges container={keyboardRef} marks={fingerMarks} />
      </div>
      {nextStep && hands.length > 0 && (
        <div className={cx('nextFinger')}>
          Next: <strong>{formatSharpsFlats(nextStep.note)}</strong>
          {hands.map((hand) => {
            const finger = fingers[hand][nextStep.upIndex];
            return (
              <span key={hand} className={cx('nextHand', `nextHand--${hand}`)}>
                {HAND_LABEL[hand]} <strong>{finger}</strong> ({FINGER_NAMES[finger]})
              </span>
            );
          })}
        </div>
      )}
      <div className={cx('legend')}>
        <span className={cx('legendColor', 'legendColor--next')} /> next key
        <span className={cx('legendColor', 'legendColor--scale')} /> in the scale
      </div>
    </div>
  );
};

export default ScaleQuizKeyboard;
