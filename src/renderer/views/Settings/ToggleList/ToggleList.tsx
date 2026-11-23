import React, { useEffect, useRef, useState } from 'react';
import classnames from 'classnames/bind';

import { useSettings } from 'renderer/contexts/Settings';

import styles from './ToggleList.module.scss';

const cx = classnames.bind(styles);

/**
 * A list of left out items (a setting), toggled by clicks.
 * Settings come back from the main process a moment after each change:
 * clicks build on this local list, which follows the settings when nothing is pending.
 */
export function useExcludedList(saved: string[], settingKey: string) {
  const { updateSetting } = useSettings();
  const [excluded, setExcluded] = useState(saved);
  const pending = useRef(0);
  useEffect(() => {
    if (pending.current === 0) setExcluded(saved);
  }, [saved]);

  const toggle = (item: string) => {
    const next = excluded.includes(item) ? excluded.filter((c) => c !== item) : [...excluded, item];
    setExcluded(next);
    pending.current += 1;
    updateSetting(settingKey, next)
      .finally(() => {
        pending.current -= 1;
      })
      // not saved: the list follows the settings again
      .catch(() => setExcluded(saved));
  };

  return [excluded, toggle] as const;
}

type Item = { id: string; label: string; title?: string };

type Props = {
  items: Item[];
  /** ids of the items that are on */
  included: string[];
  onToggle: (id: string) => void;
  /** the last item on can't be turned off */
  keepOne?: boolean;
  hint?: string;
};

const defaultProps = {
  keepOne: true,
  hint: undefined,
};

/** Items turned on and off by clicking them (chords, progressions, songs...) */
const ToggleList: React.FC<Props> = ({
  items,
  included,
  onToggle,
  keepOne = true,
  hint = undefined,
}) => (
  <>
    <div className={cx('list')}>
      {items.map(({ id, label, title }) => {
        const on = included.includes(id);
        return (
          <button
            type="button"
            key={id}
            className={cx('item', { 'item--off': !on })}
            aria-pressed={on}
            disabled={keepOne && on && included.length === 1}
            title={title ?? (on ? 'Leave it out' : 'Ask it again')}
            onClick={() => onToggle(id)}
          >
            {label}
          </button>
        );
      })}
    </div>
    {hint && <div className={cx('hint')}>{hint}</div>}
  </>
);

ToggleList.defaultProps = defaultProps;

export default ToggleList;
