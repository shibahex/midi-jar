import { Note } from 'tonal';

import { defaultScaleDegreesSettings, defaultScaleQuizSettings } from '../main/store/defaults';
import { STATUSES } from '../renderer/hooks/useQuiz';
import * as ScaleQuiz from '../renderer/views/ScaleQuiz/reducer';
import * as ScaleDegrees from '../renderer/views/ScaleDegrees/reducer';

const midiOf = (note: string) => Note.midi(`${note}4`) as number;

const play = (state: ScaleQuiz.State, note: string) =>
  ScaleQuiz.reducer(state, {
    type: 'NOTE_ON',
    midi: midiOf(note),
    noteName: note,
  });

const playRun = (state: ScaleQuiz.State) =>
  state.steps.reduce((s, step) => play(s, step.note), state);

describe('ScaleQuiz reducer', () => {
  it('plays a scale up and down', () => {
    let state = ScaleQuiz.init({
      options: { ...defaultScaleQuizSettings, direction: 'upDown' },
      key: 'C',
    });
    expect(state.steps).toHaveLength(state.scale.notes.length * 2 + 1);

    state = play(state, Note.transpose(state.steps[0].note, '2m'));
    expect(state.mistakes).toBe(1);
    expect(state.feedback.status).toBe(STATUSES.different);

    state = playRun(state);
    expect(state.completed).toBe(1);
    expect(state.feedback.status).toBe(STATUSES.equal);

    state = playRun(state);
    expect(state.feedback.status).toBe(STATUSES.superset);
    expect(state.perfectStreak).toBe(1);
  });

  it('plays a scale descending', () => {
    const state = ScaleQuiz.init({
      options: { ...defaultScaleQuizSettings, direction: 'down' },
      key: 'C',
    });
    expect(state.steps[0].note).toBe(state.scale.notes[0]);
    expect(state.steps[1].note).toBe(state.scale.notes[state.scale.notes.length - 1]);
  });

  it('needs perfect runs in a row', () => {
    let state = ScaleQuiz.init({
      options: { ...defaultScaleQuizSettings, requiredCleanRuns: 2 },
      key: 'C',
    });
    const scaleId = state.scale.id;

    state = playRun(state);
    expect(state.scale.id).toBe(scaleId);
    expect(state.cleanRuns).toBe(1);

    state = play(state, Note.transpose(state.steps[0].note, '2m'));
    state = playRun(state);
    expect(state.cleanRuns).toBe(0);
    expect(state.completed).toBe(0);

    state = playRun(state);
    state = playRun(state);
    expect(state.completed).toBe(1);
  });

  it('jumps back to a note already played', () => {
    let state = ScaleQuiz.init({ options: defaultScaleQuizSettings, key: 'C' });
    state = [0, 1, 2, 3].reduce((s, i) => play(s, s.steps[i].note), state);
    const { score } = state.games[0];

    state = play(state, state.steps[0].note);
    expect(state.position).toBe(1);
    expect(state.lastPlayed?.back).toBe(true);
    expect(state.games[0].score).toBe(score);
    expect(state.runClean).toBe(true);

    state = play(state, state.steps[1].note);
    state = play(state, state.steps[2].note);
    state = play(state, state.steps[1].note);
    expect(state.position).toBe(2);
    expect(state.runClean).toBe(false);

    // playing the same note again is ignored
    expect(play(state, state.steps[1].note)).toBe(state);
  });

  it('plays scales in order', () => {
    let state = ScaleQuiz.init({
      options: { ...defaultScaleQuizSettings, mode: 'sequential', scales: 'major' },
      key: 'C',
    });
    expect(state.scale.label).toBe('C Major');
    state = playRun(state);
    expect(state.scale.label).toBe('D♭ Major');
    state = ScaleQuiz.reducer(state, { type: 'SKIP' });
    expect(state.scale.label).toBe('D Major');
  });

  it('does not restart the scale when a display option changes', () => {
    const state = ScaleQuiz.init({
      options: defaultScaleQuizSettings,
      key: 'C',
    });
    const next = ScaleQuiz.reducer(play(state, state.steps[0].note), {
      type: 'OPTIONS_CHANGED',
      options: { ...defaultScaleQuizSettings, learningMode: true },
      key: 'C',
    });
    expect(next.scale).toBe(state.scale);
    expect(next.position).toBe(1);
  });
});

describe('ScaleDegrees reducer', () => {
  it('asks degrees of a scale then moves to the next one', () => {
    let state = ScaleDegrees.init({
      options: { ...defaultScaleDegreesSettings, gameLength: 4 },
      key: 'C',
      time: 0,
    });
    const firstScale = state.scale;

    const wrong = Note.transpose(state.scale.notes[state.degree], '2m');
    state = ScaleDegrees.reducer(state, {
      type: 'NOTE_ON',
      midi: midiOf(wrong),
      noteName: wrong,
      time: 100,
    });
    expect(state.mistakes).toBe(1);

    let time = 100;
    const degrees = [state.degree];
    const scales = [];
    for (let i = 0; i < 4; i += 1) {
      const note = state.scale.notes[state.degree];
      time += 500;
      state = ScaleDegrees.reducer(state, {
        type: 'NOTE_ON',
        midi: midiOf(note),
        noteName: note,
        time,
      });
      degrees.push(state.degree);
      scales.push(state.scale);
    }

    // a new degree for each question of the same scale
    for (let i = 1; i < 4; i += 1) {
      expect(degrees[i]).not.toBe(degrees[i - 1]);
    }
    expect(scales.slice(0, 3)).toEqual([firstScale, firstScale, firstScale]);

    expect(state.questionIndex).toBe(0);
    expect(state.games).toHaveLength(2);
    expect(state.games[0].score).toBeGreaterThan(0);
    expect(state.bestStreak).toBe(3);
  });
});
