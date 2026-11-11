import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
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
  marks: FingerMark[];
};

// white keys: badges sit below the black keys, a bit higher when two are stacked
const whiteY = (stacked: boolean) => (stacked ? 0.78 : 0.76);

type Placed = FingerMark & { x: number; y: number; size: number };

/**
 * Draws finger numbers on top of the keys of a PianoKeyboard.
 * Must be placed next to the PianoKeyboard, in a positioned element.
 * Keys are found by their `midi-<n>` class and measured after each layout.
 */
const FingerBadges: React.FC<Props> = ({ marks }) => {
  const [placed, setPlaced] = useState<Placed[]>([]);
  const baseRef = useRef<HTMLDivElement>(null);
  // latest marks, read by the watchers set up once below
  const marksRef = useRef(marks);
  marksRef.current = marks;

  const measure = useCallback(() => {
    // the parent's ref is not attached yet on the first render, our own element is
    const wrap = baseRef.current?.parentElement;
    if (!wrap) return;

    const box = wrap.getBoundingClientRect();
    const { current } = marksRef;
    const result: Placed[] = [];

    current.forEach((mark) => {
      const key = wrap.querySelector(`.midi-${mark.midi}`);
      if (!key) return;
      const rect = key.getBoundingClientRect();
      // not laid out yet: a later measure places it
      if (rect.width === 0) return;
      const black = isBlackKey(mark.midi);
      const both = current.some((m) => m.midi === mark.midi && m.hand !== mark.hand);
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
  }, []);

  // watchers are set up once: on startup the window is shown, then maximized,
  // and the keyboard is not always laid out at the first measure
  useLayoutEffect(() => {
    const wrap = baseRef.current?.parentElement;
    let active = true;
    const safeMeasure = () => active && measure();

    const frame = requestAnimationFrame(safeMeasure);
    const timeouts = [100, 300, 1000].map((delay) => setTimeout(safeMeasure, delay));
    const observer = new ResizeObserver(safeMeasure);
    if (wrap) observer.observe(wrap);
    observer.observe(document.body);
    window.addEventListener('resize', safeMeasure);
    document.fonts?.ready.then(safeMeasure).catch(() => {});

    return () => {
      active = false;
      cancelAnimationFrame(frame);
      timeouts.forEach(clearTimeout);
      observer.disconnect();
      window.removeEventListener('resize', safeMeasure);
    };
  }, [measure]);

  // keys to mark changed (next note, other chord, octave): measure again
  useLayoutEffect(measure, [marks, measure]);

  return (
    <div ref={baseRef} className={cx('base')} aria-hidden>
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
