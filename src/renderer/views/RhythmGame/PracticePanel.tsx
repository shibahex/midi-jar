import React, { useState } from 'react';
import classnames from 'classnames/bind';
import { Switch } from '@la-jarre-a-son/ui';

import { Icon } from 'renderer/components';

import styles from './PracticePanel.module.scss';

const cx = classnames.bind(styles);

/** speeds offered as shortcuts, in percent */
const PRESETS = [50, 75, 90, 100];
const MIN_SPEED = 50;
const MAX_SPEED = 150;

export type PracticeSection = { name: string; bars: number };

type Props = {
  practicing: boolean;
  onPracticingChange: (practicing: boolean) => void;
  sections: PracticeSection[];
  first: number;
  last: number;
  onRangeChange: (first: number, last: number) => void;
  speed: number;
  onSpeedChange: (speed: number) => void;
  loop: boolean;
  onLoopChange: (loop: boolean) => void;
  ramp: boolean;
  onRampChange: (ramp: boolean) => void;
  /** the bars of the sections picked (from 0), and the ones picked in them (null: all) */
  barRange: { from: number; to: number };
  bars: { from: number; to: number } | null;
  onBarsChange: (bars: { from: number; to: number } | null) => void;
  /** the speed cannot change (Spotify plays at the real speed) */
  speedLocked: boolean;
};

/**
 * Practice: play the whole song, or pick the first then the last section to play,
 * the speed, and loop them (faster after each clean loop)
 */
const PracticePanel: React.FC<Props> = ({
  practicing,
  onPracticingChange,
  sections,
  first,
  last,
  onRangeChange,
  speed,
  onSpeedChange,
  loop,
  onLoopChange,
  ramp,
  onRampChange,
  barRange,
  bars,
  onBarsChange,
  speedLocked,
}) => {
  // a click picks the first section, the next one the last section
  const [picking, setPicking] = useState<'first' | 'last'>('first');
  const [pickingBar, setPickingBar] = useState<'first' | 'last'>('first');

  const pick = (index: number) => {
    setPickingBar('first');
    if (picking === 'first') {
      onRangeChange(index, index);
      setPicking('last');
    } else {
      onRangeChange(Math.min(first, index), Math.max(first, index));
      setPicking('first');
    }
  };

  // bars: a click picks one bar, the next one the last bar
  const pickBar = (bar: number) => {
    if (pickingBar === 'first' || !bars) {
      onBarsChange({ from: bar, to: bar });
      setPickingBar('last');
    } else {
      onBarsChange({ from: Math.min(bars.from, bar), to: Math.max(bars.from, bar) });
      setPickingBar('first');
    }
  };
  const barNumbers = Array.from(
    { length: Math.max(0, Math.min(200, barRange.to - barRange.from + 1)) },
    (_, i) => barRange.from + i
  );

  const barCount = bars
    ? bars.to - bars.from + 1
    : sections.slice(first, last + 1).reduce((sum, s) => sum + s.bars, 0);
  const setSpeed = (value: number) =>
    onSpeedChange(Math.min(MAX_SPEED, Math.max(MIN_SPEED, value)));

  return (
    <div className={cx('base')}>
      <div className={cx('modes')} role="tablist" aria-label="Play mode">
        <button
          type="button"
          role="tab"
          aria-selected={!practicing}
          className={cx('mode', { 'mode--active': !practicing })}
          onClick={() => onPracticingChange(false)}
        >
          <Icon name="music" />
          Full song
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={practicing}
          className={cx('mode', { 'mode--active': practicing })}
          onClick={() => onPracticingChange(true)}
        >
          <Icon name="refresh" />
          Practice
        </button>
      </div>

      {practicing && (
        <div className={cx('practice')}>
          <div className={cx('column')}>
            <div className={cx('heading')}>
              <span>Sections</span>
              <span className={cx('hint')}>
                {picking === 'first' ? 'Click the first section' : 'Now click the last section'}
              </span>
            </div>
            <ol className={cx('sections')}>
              {sections.map((section, index) => {
                const inRange = index >= first && index <= last;
                return (
                  // eslint-disable-next-line react/no-array-index-key
                  <li key={index}>
                    <button
                      type="button"
                      className={cx('section', {
                        'section--in': inRange,
                        'section--first': index === first,
                        'section--last': index === last,
                      })}
                      onClick={() => pick(index)}
                    >
                      <span className={cx('number')}>{index + 1}</span>
                      <span className={cx('name')}>{section.name}</span>
                      {index === first && <span className={cx('badge')}>Start</span>}
                      {index === last && index !== first && (
                        <span className={cx('badge')}>End</span>
                      )}
                      <span className={cx('bars')}>
                        {section.bars} bar{section.bars === 1 ? '' : 's'}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
            <button
              type="button"
              className={cx('all')}
              onClick={() => {
                onRangeChange(0, sections.length - 1);
                setPicking('first');
              }}
            >
              Select all ({sections.reduce((sum, s) => sum + s.bars, 0)} bars)
            </button>

            <div className={cx('heading')}>
              <span>Bars</span>
              <span className={cx('hint')}>
                {pickingBar === 'first' || !bars
                  ? 'Click a bar to play just it'
                  : 'Then the last bar (or play this one)'}
              </span>
            </div>
            <div className={cx('barGrid')}>
              {barNumbers.map((bar) => (
                <button
                  key={bar}
                  type="button"
                  className={cx('bar', {
                    'bar--in': !!bars && bar >= bars.from && bar <= bars.to,
                  })}
                  onClick={() => pickBar(bar)}
                >
                  {bar + 1}
                </button>
              ))}
            </div>
            {bars && (
              <button
                type="button"
                className={cx('all')}
                onClick={() => {
                  onBarsChange(null);
                  setPickingBar('first');
                }}
              >
                All bars of the sections
              </button>
            )}
          </div>

          <div className={cx('column', 'column--side')}>
            <div className={cx('heading')}>
              <span>Speed</span>
              <span className={cx('hint')}>
                {barCount} bar{barCount === 1 ? '' : 's'} selected
              </span>
            </div>
            <div className={cx('speed')}>
              <button
                type="button"
                className={cx('step')}
                aria-label="Slower"
                onClick={() => setSpeed(speed - 5)}
                disabled={speedLocked || speed <= MIN_SPEED}
              >
                <Icon name="minus" />
              </button>
              <span className={cx('speedValue', { 'speedValue--slow': speed < 100 })}>
                {speed}
                <small>%</small>
              </span>
              <button
                type="button"
                className={cx('step')}
                aria-label="Faster"
                onClick={() => setSpeed(speed + 5)}
                disabled={speedLocked || speed >= MAX_SPEED}
              >
                <Icon name="plus" />
              </button>
            </div>
            {speedLocked && (
              <span className={cx('hint')}>With Spotify the song plays at its real speed</span>
            )}
            <div className={cx('presets')}>
              {PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className={cx('preset', { 'preset--active': preset === speed })}
                  onClick={() => setSpeed(preset)}
                  disabled={speedLocked}
                >
                  {preset}%
                </button>
              ))}
            </div>

            <div className={cx('toggle')}>
              <span>
                Loop
                <small>Play the sections again and again</small>
              </span>
              <Switch checked={loop} onChange={onLoopChange} aria-label="Loop" />
            </div>
            <div className={cx('toggle', { 'toggle--off': !loop })}>
              <span>
                Speed up each loop
                <small>+5% after a loop with no miss, up to 100%</small>
              </span>
              <Switch
                checked={ramp}
                onChange={onRampChange}
                disabled={!loop}
                aria-label="Speed up each loop"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PracticePanel;
