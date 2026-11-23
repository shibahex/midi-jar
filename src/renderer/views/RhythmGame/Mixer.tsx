import React, { useEffect, useRef, useState } from 'react';
import classnames from 'classnames/bind';

import styles from './Mixer.module.scss';

const cx = classnames.bind(styles);

export type MixerChannel = {
  id: string;
  label: string;
  value: number;
  muted?: boolean;
  /** the instrument playing it, and the ones to pick from ("" : the default one) */
  instrument?: string;
  instruments?: { value: string; label: string }[];
};

type Props = {
  channels: MixerChannel[];
  /** while dragging (to hear it right away) */
  onInput: (id: string, value: number) => void;
  /** when let go (to save it) */
  onChange: (id: string, value: number) => void;
  /** an instrument is picked for a part */
  onInstrument?: (id: string, instrument: string) => void;
};

const VolumeBar: React.FC<{
  channel: MixerChannel;
  onInput: Props['onInput'];
  onChange: Props['onChange'];
  onInstrument: Props['onInstrument'];
}> = ({ channel, onInput, onChange, onInstrument }) => {
  const track = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState(channel.value);
  const dragging = useRef(false);

  // follows the settings when not dragging
  useEffect(() => {
    if (!dragging.current) setValue(channel.value);
  }, [channel.value]);

  const valueAt = (clientY: number) => {
    const rect = track.current?.getBoundingClientRect();
    if (!rect) return value;
    const ratio = 1 - (clientY - rect.top) / rect.height;
    return Math.round(Math.max(0, Math.min(1, ratio)) * 20) * 5;
  };

  const set = (next: number) => {
    setValue(next);
    onInput(channel.id, next);
  };

  return (
    <div className={cx('channel', { 'channel--muted': channel.muted })}>
      <span className={cx('value')}>{value}</span>
      <div
        ref={track}
        className={cx('track')}
        role="slider"
        tabIndex={0}
        aria-label={`${channel.label} volume`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        onPointerDown={(e) => {
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          set(valueAt(e.clientY));
        }}
        onPointerMove={(e) => {
          if (dragging.current) set(valueAt(e.clientY));
        }}
        onPointerUp={(e) => {
          dragging.current = false;
          onChange(channel.id, valueAt(e.clientY));
        }}
        onKeyDown={(e) => {
          const step = { ArrowUp: 5, ArrowRight: 5, ArrowDown: -5, ArrowLeft: -5 }[e.key];
          if (step === undefined) return;
          e.preventDefault();
          const next = Math.max(0, Math.min(100, value + step));
          set(next);
          onChange(channel.id, next);
        }}
      >
        <div className={cx('fill')} style={{ height: `${value}%` }} />
      </div>
      <span className={cx('label')}>{channel.label}</span>
      {channel.instruments && (
        <select
          className={cx('instrument')}
          value={channel.instrument ?? ''}
          aria-label={`${channel.label} instrument`}
          title="Instrument"
          onChange={(e) => onInstrument?.(channel.id, e.target.value)}
        >
          {channel.instruments.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
};

/**
 * Volume bars, one per part: drag a bar (or use the arrow keys) to set its volume
 */
const Mixer: React.FC<Props> = ({ channels, onInput, onChange, onInstrument }) => {
  return (
    <div className={cx('base')} role="group" aria-label="Volumes">
      {channels.map((channel) => (
        <VolumeBar
          key={channel.id}
          channel={channel}
          onInput={onInput}
          onChange={onChange}
          onInstrument={onInstrument}
        />
      ))}
    </div>
  );
};

Mixer.defaultProps = {
  onInstrument: undefined,
};

export default Mixer;
