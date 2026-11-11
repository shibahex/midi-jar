import React, { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import classnames from 'classnames/bind';
import { Note } from 'tonal';
import { Button } from '@la-jarre-a-son/ui';

import { useSettings } from 'renderer/contexts/Settings';
import useNoteOn from 'renderer/hooks/useNoteOn';
import useNotes from 'renderer/hooks/useNotes';
import { Icon, QuizGameList, QuizReaction } from 'renderer/components';
import {
  formatSharpsFlats,
  getKeySignatureSpelledLike,
  getNoteInKeySignature,
  getRelativeScale,
  getScaleSequence,
} from 'renderer/helpers';

import ScaleQuizSteps from './ScaleQuizSteps';
import ScaleQuizKeyboard from './ScaleQuizKeyboard';
import { init, reducer, SCALES_PER_GAME, State } from './reducer';
import { getFingers, getHands } from './utils';

import styles from './ScaleQuiz.module.scss';

const cx = classnames.bind(styles);

const DIRECTIONS = {
  up: 'ascending',
  down: 'descending',
  upDown: 'up and back down',
};

const ScaleQuiz: React.FC = () => {
  const { settings } = useSettings();
  const quizSettings = settings.scaleQuiz;
  const { key, accidentals } = settings.notation;

  const [state, dispatch] = useReducer(reducer, { options: quizSettings, key }, init);
  const { scale, steps, position, lastPlayed } = state;

  useEffect(() => {
    dispatch({ type: 'OPTIONS_CHANGED', options: quizSettings, key });
  }, [quizSettings, key]);

  const { playedMidiNotes, sustainedMidiNotes, midiNotes } = useNotes({ key, accidentals });

  // key signature spelled like the scale, so that note names match
  const keySignature = useMemo(
    () => getKeySignatureSpelledLike(key, accidentals === 'sharp', scale.notes),
    [key, accidentals, scale]
  );

  // the reducer matches played keys: accepted keys and the octave of the learning keyboard
  const { acceptedMidi, octaveShift } = state;

  const onNoteOn = useCallback(
    (midi: number) => {
      const noteName = getNoteInKeySignature(Note.fromMidi(midi), keySignature.notes);
      dispatch({ type: 'NOTE_ON', midi, noteName });
    },
    [keySignature]
  );

  useNoteOn(onNoteOn);

  useEffect(() => {
    dispatch({ type: 'NOTES_HELD', midi: playedMidiNotes });
  }, [playedMidiNotes]);

  const hands = useMemo(() => getHands(quizSettings), [quizSettings]);
  const fingers = useMemo(() => getFingers(scale, steps), [scale, steps]);

  const { requiredCleanRuns } = quizSettings;

  const relative = useMemo(
    () => (quizSettings.displayRelative ? getRelativeScale(scale) : null),
    [quizSettings.displayRelative, scale]
  );

  // a finished scale is announced for a moment, with the scale that follows
  const [transition, setTransition] = useState<State['transition']>(null);
  useEffect(() => {
    if (!state.transition) return undefined;
    setTransition(state.transition);
    const timeout = setTimeout(() => setTransition(null), 2600);
    return () => clearTimeout(timeout);
  }, [state.transition]);

  // after a clean run, until the next one starts
  const runs =
    requiredCleanRuns > 1
      ? {
          done: state.cleanRuns,
          required: requiredCleanRuns,
          message: state.cleanRuns > 0 && position === 0 ? '✓ Once more!' : null,
        }
      : null;

  const sequenceLength = useMemo(
    () => getScaleSequence(quizSettings.scales, quizSettings.tonics === 'natural').length,
    [quizSettings.scales, quizSettings.tonics]
  );

  return (
    <div id="ScaleQuiz" className={cx('base', { 'base--learning': quizSettings.learningMode })}>
      <div className={cx('topContainer')}>
        <div className={cx('reactionContainer')}>
          {quizSettings.displayReaction && (
            <div className={cx('reaction')}>
              <QuizReaction id="ScaleQuizReaction" gameState={state.feedback} />
            </div>
          )}
          {transition && (
            <div className={cx('transition')} key={transition.id}>
              <span className={cx('transitionDone')}>✓ {transition.from} done</span>
              <span className={cx('transitionNext')}>Next: {transition.to}</span>
            </div>
          )}
        </div>
        {quizSettings.gamification && (
          <QuizGameList
            className={cx('gameList')}
            games={state.games}
            gameIndex={state.games.length - 1}
          />
        )}
        <Button
          className={cx('skip')}
          aria-label="Skip scale"
          title="Skip scale"
          icon
          variant="ghost"
          intent="neutral"
          onClick={() => dispatch({ type: 'SKIP' })}
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
      <div className={cx('instruction')}>
        Play the scale {DIRECTIONS[quizSettings.direction]}, one note at a time
        {requiredCleanRuns > 0 &&
          ` · ${requiredCleanRuns} perfect run${requiredCleanRuns > 1 ? 's' : ''} in a row`}
      </div>

      <ScaleQuizSteps
        scale={scale}
        steps={steps}
        position={position}
        positionMistakes={state.positionMistakes}
        lastPlayed={lastPlayed}
        displayNoteNames={quizSettings.displayNoteNames || quizSettings.learningMode}
        displayFormula={quizSettings.displayFormula}
        hands={hands}
        fingers={fingers}
        compact={quizSettings.learningMode}
        runs={runs}
      />

      {quizSettings.learningMode && (
        <ScaleQuizKeyboard
          steps={steps}
          position={position}
          keySignature={keySignature}
          acceptedMidi={acceptedMidi}
          octaveShift={octaveShift}
          hands={hands}
          fingers={fingers}
          playedMidiNotes={playedMidiNotes}
          sustainedMidiNotes={sustainedMidiNotes}
          midiNotes={midiNotes}
        />
      )}

      <div className={cx('playedContainer')}>
        <div className={cx('progress')}>
          Scale {(state.completed % SCALES_PER_GAME) + 1} / {SCALES_PER_GAME}
          {quizSettings.mode === 'sequential' &&
            ` · C to B ${(state.sequenceIndex % sequenceLength) + 1} / ${sequenceLength}`}
          {` · ${state.mistakes} mistake${state.mistakes === 1 ? '' : 's'}`}
        </div>
        {quizSettings.gamification && (
          <div className={cx('score')}>{state.games[state.games.length - 1].score} pts</div>
        )}
        <div
          key={lastPlayed?.id}
          className={cx('playedNote', {
            back: lastPlayed?.back,
            right: lastPlayed?.correct && !lastPlayed.back,
            wrong: lastPlayed && !lastPlayed.correct,
          })}
        >
          {lastPlayed
            ? `${lastPlayed.back ? 'Back to ' : ''}${formatSharpsFlats(lastPlayed.note)}`
            : 'Waiting for MIDI input...'}
        </div>
      </div>
    </div>
  );
};

export default ScaleQuiz;
