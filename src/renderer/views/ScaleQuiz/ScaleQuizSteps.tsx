import React, { useMemo } from 'react';
import classnames from 'classnames/bind';

import { QuizRuns } from 'renderer/components';
import { formatSharpsFlats, getDegreeLabel, Hand, ScaleInfo } from 'renderer/helpers';

import { HINT_AFTER_MISTAKES, State, Step } from './reducer';
import { Fingers, getSequentialBoxes, getStepBoxes } from './utils';

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
  /** smaller boxes, to leave room for the learning keyboard */
  compact?: boolean;
  /** runs in a row, shown above the notes when several are needed */
  runs?: { done: number; required: number; message: string | null } | null;
  /** every note in the order played (melodies), instead of one box per note of the scale */
  sequential?: boolean;
};

const defaultProps = {
  compact: false,
  runs: null,
  sequential: false,
};

/**
 * The notes of the scale, low to high, with the direction being played:
 * going down, boxes fill again from right to left
 */
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
  compact = false,
  runs = null,
  sequential = false,
}) => {
  const { boxes, goingDown, showDirection } = useMemo(
    () => (sequential ? getSequentialBoxes(steps, position) : getStepBoxes(steps, position)),
    [sequential, steps, position]
  );

  // boxes shrink so that long scales stay on one row
  const fontSize = `clamp(14px, min(${compact ? 3.4 : 4.5}vh, 3vw, ${(
    92 /
    // long melodies wrap on several rows
    (Math.min(boxes.length, 15) * 3.1)
  ).toFixed(2)}vw), 44px)`;

  return (
    <>
      {(showDirection || runs) && (
        <div className={cx('stepsHeader')}>
          {runs && <QuizRuns done={runs.done} required={runs.required} message={runs.message} />}
          {showDirection && (
            <div
              className={cx('direction', { 'direction--down': goingDown })}
              key={String(goingDown)}
            >
              {goingDown ? '← Down' : 'Up →'}
            </div>
          )}
        </div>
      )}
      <div className={cx('steps')} style={{ fontSize }}>
        {boxes.map(({ step, current, done, passed }) => {
          const hint = current && positionMistakes >= HINT_AFTER_MISTAKES;
          const visible = done || passed || hint || displayNoteNames;
          const wrong = current && lastPlayed && !lastPlayed.correct;
          const back = current && lastPlayed?.back;

          return (
            <div
              key={`${scale.id}-${step.upIndex}-${wrong ? lastPlayed?.id : ''}`}
              className={cx('step', {
                'step--done': done && !current,
                'step--passed': passed && !current,
                'step--current': current,
                'step--hint': hint,
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
    </>
  );
};

ScaleQuizSteps.defaultProps = defaultProps;

export default ScaleQuizSteps;
