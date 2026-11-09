import React, { useMemo } from 'react';
import classnames from 'classnames/bind';

import { Game } from 'renderer/hooks/useQuiz';

import styles from './QuizGameList.module.scss';

const cx = classnames.bind(styles);

type IndexedGame = Pick<Game, 'score'> & {
  index: number;
};

type Props = {
  className?: string;
  games: Pick<Game, 'score'>[];
  gameIndex: number;
  label?: string;
  maxCount?: number;
};

const defaultProps = {
  className: undefined,
  maxCount: 4,
  label: 'GAME',
};

export const QuizGameList: React.FC<Props> = ({
  className,
  games,
  gameIndex,
  maxCount = defaultProps.maxCount,
  label = defaultProps.label,
}: Props) => {
  const displayedGames = useMemo(
    () =>
      games
        .map<IndexedGame>((game, index) => ({ ...game, index }))
        .filter(({ index }) => index >= gameIndex - maxCount && index <= gameIndex),
    [games, gameIndex, maxCount]
  );

  const best = useMemo(
    () =>
      games.reduce<number | null>((b, { score }, index) => {
        if (index > gameIndex) return b;
        if (b === null) return score;

        return score > b ? score : b;
      }, null),
    [games, gameIndex]
  );

  return (
    <ul className={cx('base', className)}>
      {displayedGames.length > maxCount && (
        <li className={cx('game', 'game--best')}>
          <span className={cx('label')}>BEST</span>
          <span className={cx('score')}>{best}</span>
        </li>
      )}
      {displayedGames.map((game, index) => (
        <li
          className={cx('game', {
            'game--hidden': displayedGames.length > maxCount && index === 0,
            'game--current': game.index === gameIndex,
          })}
          key={game.index}
        >
          <span className={cx('label')}>
            {label} {game.index + 1}
          </span>
          <span className={cx('score')}>{game.score}</span>
        </li>
      ))}
    </ul>
  );
};

QuizGameList.defaultProps = defaultProps;

export default QuizGameList;
