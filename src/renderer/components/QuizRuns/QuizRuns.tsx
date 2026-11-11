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
  /** shown instead of the label, e.g. after a run is done */
  message?: string | null;
};

const defaultProps = {
  className: undefined,
  label: 'Perfect run',
  message: null,
};

/**
 * Pill showing which run in a row is being played, with a dot per run
 */
export const QuizRuns: React.FC<Props> = ({
  className,
  done,
  required,
  label = defaultProps.label,
  message = defaultProps.message,
}) => (
  <div className={cx('base', { 'base--message': !!message }, className)}>
    <span className={cx('label')} key={message ?? 'label'}>
      {message ?? `${label} ${Math.min(done + 1, required)} / ${required}`}
    </span>
    <span className={cx('dots')}>
      {Array.from({ length: required }, (_, i) => (
        <span
          // eslint-disable-next-line react/no-array-index-key
          key={i}
          className={cx('dot', { 'dot--done': i < done, 'dot--current': i === done })}
        />
      ))}
    </span>
  </div>
);

QuizRuns.defaultProps = defaultProps;

export default QuizRuns;
