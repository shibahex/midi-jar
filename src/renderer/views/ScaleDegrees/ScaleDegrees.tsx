import React, { useCallback, useEffect, useReducer } from 'react';
import classnames from 'classnames/bind';
import { Note } from 'tonal';
import { Button } from '@la-jarre-a-son/ui';

import { useSettings } from 'renderer/contexts/Settings';
import useNoteOn from 'renderer/hooks/useNoteOn';
import { Icon, QuizGameList, QuizReaction } from 'renderer/components';
import {
  formatSharpsFlats,
  getDegreeLabel,
  getDegreeName,
  getKeySignature,
  getNoteInKeySignature,
  getOrdinal,
} from 'renderer/helpers';

import { init, reducer, REVEAL_AFTER_MISTAKES } from './reducer';

import styles from './ScaleDegrees.module.scss';

const cx = classnames.bind(styles);

const now = () => performance.now();

const ScaleDegrees: React.FC = () => {
  const { settings } = useSettings();
  const { key, accidentals } = settings.notation;

  const quizSettings = settings.scaleDegrees;

  const [state, dispatch] = useReducer(reducer, { options: quizSettings, key, time: now() }, init);

  useEffect(() => {
    dispatch({ type: 'OPTIONS_CHANGED', options: quizSettings, key, time: now() });
  }, [quizSettings, key]);

  const onNoteOn = useCallback(
    (midi: number) => {
      const keySignature = getKeySignature(key, accidentals === 'sharp');
      const noteName = getNoteInKeySignature(Note.fromMidi(midi), keySignature.notes);
      dispatch({ type: 'NOTE_ON', midi, noteName, time: now() });
    },
    [key, accidentals]
  );

  useNoteOn(onNoteOn);

  const { scale, degree, lastPlayed } = state;
  const degreeName = getDegreeName(scale, degree);
  const revealed = state.mistakes >= REVEAL_AFTER_MISTAKES;

  return (
    <div id="ScaleDegrees" className={cx('base')}>
      <div className={cx('topContainer')}>
        {quizSettings.displayReaction && (
          <div className={cx('reactionContainer')}>
            <QuizReaction gameState={state.feedback} />
          </div>
        )}
        {quizSettings.gamification && (
          <QuizGameList
            className={cx('gameList')}
            games={state.games}
            gameIndex={state.games.length - 1}
            label="SCALE"
          />
        )}
        <Button
          className={cx('skip')}
          aria-label="Skip scale"
          title="Skip scale"
          icon
          variant="ghost"
          intent="neutral"
          onClick={() => dispatch({ type: 'SKIP', time: now() })}
        >
          <Icon name="refresh" />
        </Button>
      </div>

      <div className={cx('scaleName')} key={scale.id}>
        {scale.label}
      </div>

      <div className={cx('question')} key={`${scale.id}-${state.questionIndex}`}>
        <span className={cx('questionLabel')}>play the</span>
        <span className={cx('degree')}>{getOrdinal(degree + 1)}</span>
        {quizSettings.displayDegreeName && degreeName && (
          <span className={cx('degreeName')}>{degreeName}</span>
        )}
      </div>

      <div className={cx('strip')}>
        {scale.notes.map((note, index) => {
          const target = index === degree;
          // the target stays hidden until revealed, unless in easy mode
          const visible =
            quizSettings.displayScaleNotes || (target ? revealed : state.found.includes(index));

          return (
            <div
              key={note}
              className={cx('stripNote', {
                'stripNote--target': target,
                'stripNote--revealed': target && revealed,
              })}
            >
              <span className={cx('stripName')}>{visible ? formatSharpsFlats(note) : '?'}</span>
              <span className={cx('stripDegree')}>{getDegreeLabel(scale.intervals[index])}</span>
            </div>
          );
        })}
      </div>

      <div className={cx('playedContainer')}>
        <div className={cx('progress')}>
          Question {state.questionIndex + 1} / {quizSettings.gameLength}
          {state.streak > 1 && ` · streak ${state.streak}`}
          {state.bestStreak > 1 && ` · best ${state.bestStreak}`}
        </div>
        {quizSettings.gamification && (
          <div className={cx('score')}>{state.games[state.games.length - 1].score} pts</div>
        )}
        <div
          key={lastPlayed?.id}
          className={cx('playedNote', lastPlayed && (lastPlayed.correct ? 'right' : 'wrong'))}
        >
          {lastPlayed ? formatSharpsFlats(lastPlayed.note) : 'Waiting for MIDI input...'}
          {lastPlayed?.correct && state.lastAnswerMs !== null && (
            <span className={cx('time')}> · {(state.lastAnswerMs / 1000).toFixed(2)}s</span>
          )}
        </div>
      </div>
    </div>
  );
};

export default ScaleDegrees;
