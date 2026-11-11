import React, { useCallback, useEffect, useMemo, useReducer } from 'react';
import classnames from 'classnames/bind';
import { Note } from 'tonal';
import { Button } from '@la-jarre-a-son/ui';

import { useSettings } from 'renderer/contexts/Settings';
import useNoteOn from 'renderer/hooks/useNoteOn';
import useNotes from 'renderer/hooks/useNotes';
import { Icon, QuizGameList, QuizReaction } from 'renderer/components';
import {
  formatSharpsFlats,
  getDegreeLabel,
  getDegreeName,
  getKeySignature,
  getNoteInKeySignature,
  getOrdinal,
  getRelativeScale,
} from 'renderer/helpers';

import { init, reducer, REVEAL_AFTER_MISTAKES } from './reducer';
import ScaleDegreesKeyboard from './ScaleDegreesKeyboard';

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

  // held keys, for the learning keyboard
  const { playedMidiNotes, sustainedMidiNotes, midiNotes } = useNotes({ key, accidentals });

  const { scale, degree, lastPlayed } = state;
  const degreeName = getDegreeName(scale, degree);
  const revealed = state.mistakes >= REVEAL_AFTER_MISTAKES;
  const relative = useMemo(
    () => (quizSettings.displayRelative ? getRelativeScale(scale) : null),
    [quizSettings.displayRelative, scale]
  );

  return (
    <div id="ScaleDegrees" className={cx('base', { 'base--learning': quizSettings.learningMode })}>
      <div className={cx('topContainer')}>
        {quizSettings.displayReaction && (
          <div className={cx('reactionContainer')}>
            <QuizReaction id="ScaleDegreesReaction" gameState={state.feedback} />
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
      {relative && (
        <div className={cx('relative')} key={`relative-${scale.id}`}>
          Relative: {relative.label}
        </div>
      )}

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

      {quizSettings.learningMode && (
        <ScaleDegreesKeyboard
          scale={scale}
          degree={degree}
          keyName={key}
          sharps={accidentals === 'sharp'}
          playedMidiNotes={playedMidiNotes}
          sustainedMidiNotes={sustainedMidiNotes}
          midiNotes={midiNotes}
        />
      )}

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
