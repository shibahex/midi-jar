import React, { useMemo } from 'react';
import classnames from 'classnames/bind';

import { useSettings } from 'renderer/contexts/Settings';
import useQuiz, { STATUSES, Game } from 'renderer/hooks/useQuiz';
import useNotes from 'renderer/hooks/useNotes';
import { ChordIntervals, ChordName, QuizGameList, QuizReaction } from 'renderer/components';
import { getChordRelativeKey } from 'renderer/helpers';

import ChordQuizKeyboard from './ChordQuizKeyboard';

import styles from './ChordQuiz.module.scss';

const cx = classnames.bind(styles);

const ChordQuiz: React.FC = () => {
  const { settings } = useSettings();

  const quizSettings = settings.chordQuiz;
  const notationSettings = settings.notation;

  const { chords, pitchClasses, playedMidiNotes, sustainedMidiNotes, midiNotes } = useNotes();

  const { games, gameState, attempts } = useQuiz(
    pitchClasses,
    chords,
    quizSettings,
    notationSettings
  );

  const chordElements = useMemo(
    () =>
      [
        ...(games[gameState.gameIndex] ? games[gameState.gameIndex].chords : []),
        ...(games[gameState.gameIndex + 1] ? games[gameState.gameIndex + 1].chords : []),
      ].reduce(
        (acc, chord, index) => {
          let type = null;
          if (index === gameState.index - 1) {
            type = 'prevChord';
          }

          if (index === gameState.index) {
            type = 'targetChord';
          }

          if (index === gameState.index + 1) {
            type = 'nextChord';
          }

          if (type) {
            return [
              ...acc,
              {
                index: games[gameState.gameIndex]
                  ? index % games[gameState.gameIndex].chords.length
                  : index,
                chord,
                type,
              },
            ];
          }

          return acc;
        },
        [] as Array<{
          index: number;
          chord: Game['chords'][number];
          type: string;
        }>
      ),
    [games, gameState.index, gameState.gameIndex]
  );

  const target = games[gameState.gameIndex]?.chords[gameState.index];
  // progressions mode: the progression of the game, and where we are in it
  const progression = games[gameState.gameIndex]?.progression;
  const progressionStep = progression ? gameState.index % progression.numerals.length : -1;
  const relativeKey = useMemo(
    () => (target ? getChordRelativeKey(target.tonic, target.quality) : null),
    [target]
  );

  if (!settings) return null;

  if (!games.length)
    return (
      <div id="ChordQuiz" className={cx('base')}>
        Game will start
      </div>
    );

  return (
    <div id="ChordQuiz" className={cx('base', { 'base--learning': quizSettings.learningMode })}>
      <div className={cx('topContainer')}>
        {quizSettings.displayReaction && (
          <div className={cx('reactionContainer')}>
            <QuizReaction id="ChordQuizReaction" gameState={gameState} />
          </div>
        )}
        {quizSettings.gamification && (
          <QuizGameList className={cx('gameList')} games={games} gameIndex={gameState.gameIndex} />
        )}
      </div>

      <div className={cx('chordContainer')}>
        {chordElements.map((c) => (
          <div
            key={c.index}
            className={cx(
              'chord',
              c.type === 'targetChord' && `status--${STATUSES[gameState.status]}`,
              c.type
            )}
          >
            <ChordName chord={c.chord} notation={quizSettings.chordNotation} />
          </div>
        ))}
      </div>
      {quizSettings.displayName && (
        <div className={cx('chordName')}>
          {games[gameState.gameIndex].chords[gameState.index].name}
        </div>
      )}
      {quizSettings.displayRelative && relativeKey && (
        <div className={cx('relativeKey')}>Relative key: {relativeKey}</div>
      )}
      {progression && (
        <div className={cx('progression')}>
          <div className={cx('progressionTitle')}>
            Key of <strong>{progression.keyLabel}</strong> · {progression.label}
          </div>
          <div className={cx('progressionSteps')}>
            {progression.numerals.map((numeral, i) => (
              <div
                // eslint-disable-next-line react/no-array-index-key
                key={i}
                className={cx('progressionStep', {
                  'progressionStep--done': i < progressionStep,
                  'progressionStep--current': i === progressionStep,
                })}
              >
                <span className={cx('numeral')}>{numeral}</span>
                <span className={cx('progressionChord')}>{progression.names[i]}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {quizSettings.displayIntervals && (
        <div className={cx('intervalsContainer')}>
          <ChordIntervals
            targets={games[gameState.gameIndex].chords[gameState.index].intervals}
            intervals={gameState.status > 0 ? gameState.chord?.intervals : []}
            pitchClasses={pitchClasses}
            tonic={games[gameState.gameIndex].chords[gameState.index].tonic}
            quizMode
          />
        </div>
      )}
      {quizSettings.learningMode && (
        <ChordQuizKeyboard
          target={games[gameState.gameIndex].chords[gameState.index]}
          keyName={notationSettings.key}
          sharps={notationSettings.accidentals === 'sharp'}
          fingering={quizSettings.fingering}
          playedMidiNotes={playedMidiNotes}
          sustainedMidiNotes={sustainedMidiNotes}
          midiNotes={midiNotes}
        />
      )}
      <div className={cx('playedContainer')}>
        <div className={cx('progress')}>
          {gameState.index + 1} / {games[gameState.gameIndex].chords.length}
          {quizSettings.retryUntilCorrect && attempts > 0 && (
            <span className={cx('retry')}>
              {' · '}Try again ({attempts} {attempts === 1 ? 'miss' : 'misses'})
            </span>
          )}
        </div>
        {quizSettings.gamification && <div className={cx('score')}>{gameState.score} pts</div>}
        <div className={cx('playedChord')}>
          <ChordName chord={gameState.chord} notation={quizSettings.chordNotation} />
        </div>
      </div>
    </div>
  );
};

export default ChordQuiz;
