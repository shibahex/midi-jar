import React from 'react';
import classnames from 'classnames/bind';

import styles from './QuizRuns.module.scss';

const cx = classnames.bind(styles);

type Props = {
  className?: string;
  /** runs done in a row */
  done: number;
  /** runs needed in a row */
  required: number;
  label?: string;
};

const defaultProps = {
  className: undefined,
  label: 'Perfect run',
};

/**
 * Shows which run in a row is being played, with a dot per run
 */
export const QuizRuns: React.FC<Props> = ({
  className,
  done,
  required,
  label = defaultProps.label,
}) => (
  <div className={cx('base', className)}>
    <div className={cx('label')}>
      {label} {Math.min(done + 1, required)} / {required}
    </div>
    <div className={cx('dots')}>
      {Array.from({ length: required }, (_, i) => (
        <span
          // eslint-disable-next-line react/no-array-index-key
          key={i}
          className={cx('dot', { 'dot--done': i < done, 'dot--current': i === done })}
        />
      ))}
    </div>
  </div>
);

QuizRuns.defaultProps = defaultProps;

export default QuizRuns;
