import React, { useLayoutEffect, useState } from 'react';
import classnames from 'classnames/bind';

import { Hand, isBlackKey } from 'renderer/helpers';

import styles from './FingerBadges.module.scss';

const cx = classnames.bind(styles);

export type FingerMark = {
  midi: number;
  hand: Hand;
  finger: number;
  next: boolean;
};

type Props = {
  /** element containing the PianoKeyboard */
  container: React.RefObject<HTMLDivElement>;
  marks: FingerMark[];
};

// white keys: badges sit below the black keys, a bit higher when two are stacked
const whiteY = (stacked: boolean) => (stacked ? 0.78 : 0.76);

type Placed = FingerMark & { x: number; y: number; size: number };

/**
 * Draws finger numbers on top of the keys of a PianoKeyboard.
 * Keys are found by their `midi-<n>` class and measured after each layout.
 */
const FingerBadges: React.FC<Props> = ({ container, marks }) => {
  const [placed, setPlaced] = useState<Placed[]>([]);

  useLayoutEffect(() => {
    const wrap = container.current;
    if (!wrap) return undefined;

    const measure = () => {
      const box = wrap.getBoundingClientRect();
      const result: Placed[] = [];

      marks.forEach((mark) => {
        const key = wrap.querySelector(`.midi-${mark.midi}`);
        if (!key) return;
        const rect = key.getBoundingClientRect();
        const black = isBlackKey(mark.midi);
        const both = marks.some((m) => m.midi === mark.midi && m.hand !== mark.hand);
        // right hand above left hand when both are shown on the same key
        let shift = 0;
        if (both) shift = mark.hand === 'right' ? -0.5 : 0.5;
        const size = Math.max(14, Math.min(26, rect.width * (black ? 0.8 : 0.55)));
        result.push({
          ...mark,
          size,
          x: rect.left - box.left + rect.width / 2,
          y: rect.top - box.top + rect.height * (black ? 0.32 : whiteY(both)) + shift * size * 1.1,
        });
      });

      setPlaced(result);
    };

    measure();
    // measure again once layout and fonts have settled
    const frame = requestAnimationFrame(measure);
    const observer = new ResizeObserver(measure);
    observer.observe(wrap);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [container, marks]);

  return (
    <div className={cx('base')} aria-hidden>
      {placed.map((mark) => (
        <span
          key={`${mark.midi}-${mark.hand}`}
          className={cx('badge', `badge--${mark.hand}`, { 'badge--next': mark.next })}
          style={{
            left: mark.x,
            top: mark.y,
            width: mark.size,
            height: mark.size,
            fontSize: mark.size * 0.62,
          }}
        >
          {mark.finger}
        </span>
      ))}
    </div>
  );
};

export default FingerBadges;
