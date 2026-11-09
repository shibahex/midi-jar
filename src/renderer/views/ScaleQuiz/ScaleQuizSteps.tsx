import React from 'react';
import classnames from 'classnames/bind';

import { formatSharpsFlats, getDegreeLabel, Hand, ScaleInfo } from 'renderer/helpers';

import { HINT_AFTER_MISTAKES, State, Step } from './reducer';
import { Fingers } from './utils';

import styles from './ScaleQuiz.module.scss';

const cx = classnames.bind(styles);

const HAND_SHORT: Record<Hand, string> = { right: 'R', left: 'L' };

type Props = {
  scale: ScaleInfo;
  steps: Step[];
  position: number;
  positionMistakes: number;
  lastPlayed: State['lastPlayed'];
  displayNoteNames: boolean;
  displayFormula: boolean;
  hands: Hand[];
  fingers: Fingers;
};

const ScaleQuizSteps: React.FC<Props> = ({
  scale,
  steps,
  position,
  positionMistakes,
  lastPlayed,
  displayNoteNames,
  displayFormula,
  hands,
  fingers,
}) => {
  // boxes shrink so that a long scale (up and down) stays on one row
  const fontSize = `clamp(14px, min(4.5vh, 3vw, ${(92 / (steps.length * 3.1)).toFixed(
    2
  )}vw), 44px)`;

  return (
    <div className={cx('steps')} style={{ fontSize }}>
      {steps.map((step, index) => {
        const done = index < position;
        const current = index === position;
        const hint = current && positionMistakes >= HINT_AFTER_MISTAKES;
        const visible = done || hint || displayNoteNames;
        const wrong = current && lastPlayed && !lastPlayed.correct;
        const back = current && lastPlayed?.back;

        return (
          <div
            // eslint-disable-next-line react/no-array-index-key
            key={`${scale.id}-${index}-${wrong ? lastPlayed?.id : ''}`}
            className={cx('step', {
              'step--done': done,
              'step--current': current,
              'step--hint': hint && !done,
              'step--wrong': wrong,
              'step--back': back,
            })}
          >
            <span className={cx('stepNote')}>{visible ? formatSharpsFlats(step.note) : '?'}</span>
            {displayFormula && (
              <span className={cx('stepDegree')}>
                {getDegreeLabel(scale.intervals[step.degree])}
              </span>
            )}
            {hands.length > 0 && (
              <span className={cx('stepFinger')}>
                {hands
                  .map((hand) =>
                    hands.length > 1
                      ? `${HAND_SHORT[hand]}${fingers[hand][step.upIndex]}`
                      : fingers[hand][step.upIndex]
                  )
                  .join(' ')}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default ScaleQuizSteps;
