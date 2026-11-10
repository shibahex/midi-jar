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
  getKeySignature,
  getNoteInKeySignature,
  getScaleSequence,
  isSamePitchClass,
} from 'renderer/helpers';

import ScaleQuizSteps from './ScaleQuizSteps';
import ScaleQuizKeyboard from './ScaleQuizKeyboard';
import { init, reducer, SCALES_PER_GAME } from './reducer';
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
  const keySignature = useMemo(() => {
    const keySig = getKeySignature(key, accidentals === 'sharp');
    const notes = [...keySig.notes];
    scale.notes.forEach((note) => {
      const chroma = Note.chroma(note);
      if (chroma !== undefined) notes[chroma] = note;
    });
    return { ...keySig, notes };
  }, [key, accidentals, scale]);

  const [acceptedMidi, setAcceptedMidi] = useState<number[]>([]);

  const onNoteOn = useCallback(
    (midi: number) => {
      const noteName = getNoteInKeySignature(Note.fromMidi(midi), keySignature.notes);
      const accepted =
        (!!steps[position] && isSamePitchClass(midi, steps[position].note)) ||
        (quizSettings.jumpBack &&
          steps.slice(0, position).some((step) => isSamePitchClass(midi, step.note)));

      if (accepted) setAcceptedMidi((list) => [...list, midi]);
      dispatch({ type: 'NOTE_ON', midi, noteName });
    },
    [keySignature, steps, position, quizSettings.jumpBack]
  );

  useNoteOn(onNoteOn);

  useEffect(() => {
    setAcceptedMidi((list) => {
      const held = list.filter((m) => playedMidiNotes.includes(m));
      return held.length === list.length ? list : held;
    });
  }, [playedMidiNotes]);

  const hands = useMemo(() => getHands(quizSettings), [quizSettings]);
  const fingers = useMemo(() => getFingers(scale, steps), [scale, steps]);

  const { requiredCleanRuns } = quizSettings;

  const sequenceLength = useMemo(
    () => getScaleSequence(quizSettings.scales, quizSettings.tonics === 'natural').length,
    [quizSettings.scales, quizSettings.tonics]
  );

  return (
    <div id="ScaleQuiz" className={cx('base', { 'base--learning': quizSettings.learningMode })}>
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
      />

      {quizSettings.learningMode && (
        <ScaleQuizKeyboard
          steps={steps}
          position={position}
          keySignature={keySignature}
          acceptedMidi={acceptedMidi}
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
          {requiredCleanRuns > 0 && ` · perfect runs ${state.cleanRuns} / ${requiredCleanRuns}`}
          {state.perfectStreak > 1 && ` · ${state.perfectStreak} perfect in a row`}
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
