import React, { useMemo } from 'react';
import classnames from 'classnames/bind';

import { KeyboardSettings } from 'main/types';
import { defaultKeyboardSettings } from 'main/store/defaults';
import { Hand, HAND_LABEL, KeySignatureConfig } from 'renderer/helpers';

import { PianoKeyboard } from '../PianoKeyboard';
import { FingerBadges, FingerMark } from '../FingerBadges';

import styles from './LearningKeyboard.module.scss';

const cx = classnames.bind(styles);

const baseKeyboardSettings: KeyboardSettings = {
  ...defaultKeyboardSettings,
  label: 'pitchClass',
  keyInfo: 'none',
  textOpacity: 1,
  wrap: true,
  sizes: { ...defaultKeyboardSettings.sizes, height: 5 },
};

type Props = {
  /** octaves from the default C4–B5 range */
  octaveShift: number;
  /** adds an octave on top, for notes going past B5 */
  extraOctave?: boolean;
  keySignature: KeySignatureConfig;
  /** keys to play */
  targets: number[];
  /** keys shown lighter (e.g. the rest of the scale) */
  softTargets?: number[];
  marks: FingerMark[];
  /** finger numbers of both hands take the place of key names */
  hideKeyNames?: boolean;
  played: number[];
  sustained: number[];
  midi: number[];
  /** shown below the keyboard */
  children?: React.ReactNode;
};

const defaultProps = {
  extraOctave: false,
  softTargets: undefined,
  hideKeyNames: false,
  children: undefined,
};

/**
 * Piano keyboard of the learning modes: keys to play and finger numbers, following the octave
 * played in
 */
export const LearningKeyboard: React.FC<Props> = ({
  octaveShift,
  extraOctave = false,
  keySignature,
  targets,
  softTargets,
  marks,
  hideKeyNames = false,
  played,
  sustained,
  midi,
  children,
}) => {
  const keyboardSettings = useMemo(
    (): KeyboardSettings => ({
      ...baseKeyboardSettings,
      from: `C${4 + octaveShift}`,
      to: `B${(extraOctave ? 6 : 5) + octaveShift}`,
      keyName: hideKeyNames ? 'none' : baseKeyboardSettings.keyName,
    }),
    [octaveShift, extraOctave, hideKeyNames]
  );

  return (
    <div className={cx('base')}>
      <div className={cx('keyboardContainer')}>
        <PianoKeyboard
          className={cx('keyboard')}
          keyboard={keyboardSettings}
          keySignature={keySignature}
          softTargets={softTargets ?? null}
          targets={targets}
          exactTargets
          played={played}
          sustained={sustained}
          midi={midi}
        />
        <FingerBadges marks={marks} />
      </div>
      {children}
    </div>
  );
};

LearningKeyboard.defaultProps = defaultProps;

/** Label of a hand with its finger numbers, colored like its finger badges */
export const HandChip: React.FC<{ hand: Hand; children: React.ReactNode }> = ({
  hand,
  children,
}) => (
  <span className={cx('hand', `hand--${hand}`)}>
    {HAND_LABEL[hand]} {children}
  </span>
);

/** Row of hand chips or other finger info */
export const FingerRow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className={cx('fingers')}>{children}</div>
);

type LegendItem = { type: 'target' | 'soft'; label: string };

/** Explains the key colors */
export const KeyLegend: React.FC<{ items: LegendItem[] }> = ({ items }) => (
  <div className={cx('legend')}>
    {items.map(({ type, label }) => (
      <span key={label} className={cx('legendItem')}>
        <span className={cx('legendColor', `legendColor--${type}`)} /> {label}
      </span>
    ))}
  </div>
);

export default LearningKeyboard;
