import React, { useMemo } from 'react';
import classnames from 'classnames/bind';
import { Midi } from 'tonal';

import { KeyboardSettings } from 'main/types';
import { defaultKeyboardSettings } from 'main/store/defaults';
import { Hand, HAND_LABEL, isBlackKey, KeySignatureConfig } from 'renderer/helpers';

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
  /** color of the keys to play (CSS), instead of the usual one */
  targetColor?: string;
  /** a band under the keys naming each octave (the ones with keys to play lit) */
  showOctaves?: boolean;
  /** how many octaves are shown (else 2, 3 with the extra octave) */
  octaves?: number;
  /** the keys shown, from the lowest to the highest (MIDI, white keys), instead of octaves */
  range?: { low: number; high: number };
  /** notes played in another octave than the keys to play (they count): amber */
  otherOctave?: number[];
  /** keys still held from the notes just played right: green */
  rightPlayed?: number[];
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
  targetColor: undefined,
  showOctaves: false,
  octaves: undefined,
  range: undefined,
  otherOctave: undefined,
  rightPlayed: undefined,
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
  targetColor,
  showOctaves = false,
  octaves,
  range,
  otherOctave,
  rightPlayed,
  hideKeyNames = false,
  played,
  sustained,
  midi,
  children,
}) => {
  const octaveCount = octaves ?? (extraOctave ? 3 : 2);
  // the keys shown (MIDI)
  const low = range?.low ?? 60 + 12 * octaveShift;
  const high = range?.high ?? 59 + 12 * (octaveShift + octaveCount);
  const keyboardSettings = useMemo(
    (): KeyboardSettings => ({
      ...baseKeyboardSettings,
      from: Midi.midiToNoteName(low),
      to: Midi.midiToNoteName(high),
      keyName: hideKeyNames ? 'none' : baseKeyboardSettings.keyName,
    }),
    [low, high, hideKeyNames]
  );
  // each octave of the keys shown (a part of one at the ends), as wide as its white keys
  const octaveCells = [];
  for (let octave = Math.floor(low / 12); octave <= Math.floor(high / 12); octave += 1) {
    const from = Math.max(low, 12 * octave);
    const to = Math.min(high, 12 * octave + 11);
    const whites = Array.from({ length: to - from + 1 }, (_, i) => from + i).filter(
      (m) => !isBlackKey(m)
    ).length;
    octaveCells.push({
      octave,
      whites,
      label: `${Midi.midiToNoteName(from)}–${Midi.midiToNoteName(to)}`,
      lit: targets.some((m) => m >= from && m <= to),
    });
  }

  return (
    <div
      className={cx('base')}
      style={targetColor ? ({ '--target-color': targetColor } as React.CSSProperties) : undefined}
    >
      <div className={cx('keyboardContainer')}>
        <PianoKeyboard
          className={cx('keyboard')}
          keyboard={keyboardSettings}
          keySignature={keySignature}
          softTargets={softTargets ?? null}
          targets={targets}
          exactTargets
          played={played}
          otherOctave={otherOctave ?? null}
          rightPlayed={rightPlayed ?? null}
          sustained={sustained}
          midi={midi}
        />
        <FingerBadges marks={marks} />
      </div>
      {showOctaves && (
        <div className={cx('octaves')}>
          {octaveCells.map((cell) => (
            <span
              key={cell.octave}
              className={cx('octavesCell', { 'octavesCell--lit': cell.lit })}
              style={{ flexGrow: cell.whites }}
            >
              {cell.whites > 2 ? cell.label : ''}
            </span>
          ))}
        </div>
      )}
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

/** A hint under the keys (a note played in another octave than shown: which way to go) */
export const KeyboardHint: React.FC<{
  children: React.ReactNode;
  /** warning: it counts all the same; danger: it does not */
  tone?: 'warning' | 'danger';
}> = ({ children, tone = 'danger' }) => (
  <div className={cx('hint', `hint--${tone}`)} role="status">
    {children}
  </div>
);

KeyboardHint.defaultProps = { tone: 'danger' };

/**
 * The keys shown ("C3–B4") and how they move: with the octave played in, or by hand (− and +)
 */
export const OctaveControl: React.FC<{
  label: string;
  title: string;
  onLower?: () => void;
  onHigher?: () => void;
}> = ({ label, title, onLower, onHigher }) => (
  <div className={cx('octave')}>
    {onLower && (
      <button
        type="button"
        className={cx('octaveButton')}
        onClick={onLower}
        title="An octave lower"
        aria-label="An octave lower"
      >
        −
      </button>
    )}
    <span title={title}>{label}</span>
    {onHigher && (
      <button
        type="button"
        className={cx('octaveButton')}
        onClick={onHigher}
        title="An octave higher"
        aria-label="An octave higher"
      >
        +
      </button>
    )}
  </div>
);

OctaveControl.defaultProps = { onLower: undefined, onHigher: undefined };

type LegendItem = { type: 'target' | 'soft' | 'otherOctave'; label: string };

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
