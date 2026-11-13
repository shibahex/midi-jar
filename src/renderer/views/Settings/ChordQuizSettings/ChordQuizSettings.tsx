import React, { useEffect, useRef, useState } from 'react';
import classnames from 'classnames/bind';
import {
  Button,
  Container,
  Switch,
  FormField,
  FormControlLabel,
  Slider,
  Select,
  Toolbar,
} from '@la-jarre-a-son/ui';

import { useSettings } from 'renderer/contexts/Settings';
import { CHORD_SETS, getIncludedChords } from 'renderer/hooks/useQuiz';
import { Icon, ScrollContainer } from 'renderer/components';
import {
  getIncludedProgressions,
  getProgressionChords,
  parseProgression,
  PROGRESSIONS,
} from 'renderer/helpers';

import ToggleList, { useExcludedList } from '../ToggleList';
import { chordsByComplexity, fields } from './constants';

import styles from './ChordQuizSettings.module.scss';

const cx = classnames.bind(styles);

// clearer names for the triads
const CHORD_LABELS: Record<string, string> = { M: 'maj', m: 'min' };

const NO_ITEMS: string[] = [];

/**
 * Custom progressions, typed one per line: saved shortly after typing stops,
 * with each line read in C (or A minor) below
 */
const CustomProgressions: React.FC<{ value: string }> = ({ value }) => {
  const { updateSetting } = useSettings();
  const [text, setText] = useState(value);
  const editing = useRef(false);
  const timeout = useRef<ReturnType<typeof setTimeout>>();

  // follows the settings when not typing (e.g. reset to defaults)
  useEffect(() => {
    if (!editing.current) setText(value);
  }, [value]);

  useEffect(() => () => clearTimeout(timeout.current), []);

  const onChange = (next: string) => {
    setText(next);
    editing.current = true;
    clearTimeout(timeout.current);
    timeout.current = setTimeout(() => {
      updateSetting('chordQuiz.customProgressions', next)
        .finally(() => {
          editing.current = false;
        })
        .catch(() => {});
    }, 400);
  };

  const lines = text.split('\n').filter((line) => line.trim());

  return (
    <>
      <textarea
        className={cx('customProgressions')}
        value={text}
        onChange={(e) => onChange(e.target.value)}
        placeholder={'I vi ii V\nI bVII IV I\nii7 V7 Imaj7'}
        rows={4}
        spellCheck={false}
      />
      {lines.length > 0 && (
        <ul className={cx('customPreview')}>
          {lines.map((line, index) => {
            const { progression, error } = parseProgression(line);
            const tonic = progression?.mode === 'minor' ? 'A' : 'C';
            return (
              // eslint-disable-next-line react/no-array-index-key
              <li key={index} className={cx({ customError: !progression })}>
                {progression
                  ? `${progression.label} → ${getProgressionChords(progression, tonic)
                      .map((c) => c.name)
                      .join(' ')} (in ${tonic} ${progression.mode})`
                  : `"${line.trim()}": "${error}" is not a numeral`}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
};

const ChordQuizSettings: React.FC = () => {
  const { settings, updateSetting, resetSettings } = useSettings();
  const { chords, mode } = settings.chordQuiz;
  const progressionsMode = mode === 'progressions';
  // chords come from progressions: no chord sets
  const chordsMode = !progressionsMode;

  // a chord or a progression is left out or asked again; the last one stays
  const [excluded, toggleChord] = useExcludedList(
    settings.chordQuiz.excludedChords ?? NO_ITEMS,
    'chordQuiz.excludedChords'
  );
  const included = chords !== 'all' ? getIncludedChords(chords, excluded) : [];

  const [excludedProgressions, toggleProgression] = useExcludedList(
    settings.chordQuiz.excludedProgressions ?? NO_ITEMS,
    'chordQuiz.excludedProgressions'
  );
  // built-in progressions asked (none if all are left out for custom ones)
  const includedProgressions = PROGRESSIONS.filter((p) => !excludedProgressions.includes(p.id));
  // custom progressions can replace all the built-in ones
  const hasCustom = getIncludedProgressions(
    PROGRESSIONS.map((p) => p.id),
    settings.chordQuiz.customProgressions
  ).some((p) => !PROGRESSIONS.includes(p));

  return (
    <>
      <ScrollContainer pad="md">
        <Container size="md">
          <FormField label="Mode" hint="Choose what alorithm is used to generate chords">
            <Select
              options={fields.mode.choices}
              onChange={(value) => updateSetting('chordQuiz.mode', value)}
              value={settings.chordQuiz.mode}
            />
          </FormField>

          {progressionsMode && (
            <FormField
              label="Key"
              hint="Choose the key of the progressions (a minor progression in the current key is played in its relative minor)"
            >
              <Select
                options={fields.progressionKey.choices}
                onChange={(value) => updateSetting('chordQuiz.progressionKey', value)}
                value={settings.chordQuiz.progressionKey}
              />
            </FormField>
          )}

          {progressionsMode && (
            <>
              <FormField
                as="div"
                label="Progressions"
                hint="Choose which progressions can be asked"
              >
                <ToggleList
                  items={PROGRESSIONS.map((p) => ({
                    id: p.id,
                    label: p.label,
                    title: `${p.mode} key`,
                  }))}
                  // nothing left at all: every built-in progression is asked
                  included={(includedProgressions.length || hasCustom
                    ? includedProgressions
                    : PROGRESSIONS
                  ).map((p) => p.id)}
                  onToggle={toggleProgression}
                  // custom progressions can replace all the built-in ones
                  keepOne={!hasCustom}
                  hint="Click a progression to leave it out or ask it again (lowercase: minor chords)"
                />
              </FormField>

              <FormField
                label="Custom Progressions"
                hint="Your own progressions, one per line: numerals separated by spaces or dashes. Uppercase is major, lowercase minor (a lowercase i makes a minor key). Add 7, maj7, m7, dim (°), ø, aug (+), sus2, sus4, 6, 9... b/# borrow a chord (bVII, #iv°), V/V is a secondary dominant."
              >
                <CustomProgressions value={settings.chordQuiz.customProgressions ?? ''} />
              </FormField>
            </>
          )}

          {(mode === 'random' ||
            (progressionsMode && settings.chordQuiz.progressionKey !== 'current')) && (
            <FormField
              label="Keys"
              hint="Choose if chords can be built on sharp or flat notes (C#, Bb...)"
            >
              <Select
                options={fields.tonics.choices}
                onChange={(value) => updateSetting('chordQuiz.tonics', value)}
                value={settings.chordQuiz.tonics}
              />
            </FormField>
          )}

          {chordsMode && (
            <FormField label="Chords" hint="Choose which chords can be asked">
              <Select
                options={fields.chords.choices}
                onChange={(value) => updateSetting('chordQuiz.chords', value)}
                value={settings.chordQuiz.chords}
              />
            </FormField>
          )}

          {chordsMode && chords === 'all' && (
            <>
              <FormField
                label="Difficulty"
                hint="An arbitrary complexity score is given to chords, the more intervals and alterations a chord has, the more it is complex."
              >
                <Select
                  options={fields.difficulty.choices}
                  onChange={(value: string) => updateSetting('chordQuiz.difficulty', Number(value))}
                  value={`${settings.chordQuiz.difficulty}`}
                />
              </FormField>

              <div className={cx('chordList')}>
                {settings.chordQuiz.difficulty > 0 && (
                  <span className={cx('previousLevel')}>Previous level +</span>
                )}
                {chordsByComplexity[settings.chordQuiz.difficulty]?.map((chord) => (
                  <span className={cx('chord')} key={chord}>
                    {chord}
                  </span>
                ))}
              </div>
            </>
          )}
          {chordsMode && chords !== 'all' && (
            <ToggleList
              items={(CHORD_SETS[chords] ?? []).map((chord) => ({
                id: chord,
                label: CHORD_LABELS[chord] ?? chord,
              }))}
              included={included}
              onToggle={toggleChord}
              hint="Click a chord to leave it out or ask it again"
            />
          )}

          <FormField
            label="Game Length"
            hint="Number of chords to be generated for a single round (belonging to the same key signature)"
          >
            <Slider
              value={settings.chordQuiz.gameLength}
              onChange={(value: number) => updateSetting('chordQuiz.gameLength', value)}
              min={4}
              max={32}
              step={4}
              marks={[4, 8, 16, 24, 32]}
              valueText={`${settings.chordQuiz.gameLength}`}
            />
          </FormField>

          <FormControlLabel
            label="Retry until correct"
            hint="Stays on the chord after a wrong answer, until the right chord is played (each miss still loses points)"
            reverse
          >
            <Switch
              onChange={(value) => updateSetting('chordQuiz.retryUntilCorrect', value)}
              checked={settings.chordQuiz.retryUntilCorrect}
            />
          </FormControlLabel>

          <FormControlLabel
            label="Learning Mode"
            hint="Displays a piano keyboard with the keys of the chord to play"
            reverse
          >
            <Switch
              onChange={(value) => updateSetting('chordQuiz.learningMode', value)}
              checked={settings.chordQuiz.learningMode}
            />
          </FormControlLabel>

          {settings.chordQuiz.learningMode && (
            <FormField label="Fingering" hint="Displays finger numbers (1 is thumb, 5 is pinky)">
              <Select
                options={fields.fingering.choices}
                onChange={(value) => updateSetting('chordQuiz.fingering', value)}
                value={settings.chordQuiz.fingering}
              />
            </FormField>
          )}

          <FormControlLabel
            label="Gamification"
            hint="Gamifies the quiz by adding scores and game count (no persistence of scoreboard)"
            reverse
          >
            <Switch
              onChange={(value) => updateSetting('chordQuiz.gamification', value)}
              checked={settings.chordQuiz.gamification}
            />
          </FormControlLabel>

          <FormControlLabel
            label="Chord Notation"
            hint="Choose the notation chords are displayed in"
            reverse
          >
            <Select
              value={settings.chordQuiz.chordNotation}
              onChange={(value) => updateSetting('chordQuiz.chordNotation', value)}
              options={fields.chordNotation.choices}
            />
          </FormControlLabel>

          <FormControlLabel
            label="Display Reaction"
            hint="Enables the textual reactions to success and fail"
            reverse
          >
            <Switch
              onChange={(value) => updateSetting('chordQuiz.displayReaction', value)}
              checked={settings.chordQuiz.displayReaction}
            />
          </FormControlLabel>

          <FormControlLabel
            label="Display Chord Name"
            hint="Display the name of target chord in full text"
            reverse
          >
            <Switch
              onChange={(value) => updateSetting('chordQuiz.displayName', value)}
              checked={settings.chordQuiz.displayName}
            />
          </FormControlLabel>

          <FormControlLabel
            label="Display Intervals"
            hint="Enables the list of intervals expected and currently played"
            reverse
          >
            <Switch
              onChange={(value) => updateSetting('chordQuiz.displayIntervals', value)}
              checked={settings.chordQuiz.displayIntervals}
            />
          </FormControlLabel>

          <FormControlLabel
            label="Display Relative Key"
            hint="Displays the relative key of major and minor chords (A minor for C, C major for Am)"
            reverse
          >
            <Switch
              onChange={(value) => updateSetting('chordQuiz.displayRelative', value)}
              checked={settings.chordQuiz.displayRelative}
            />
          </FormControlLabel>
        </Container>
      </ScrollContainer>
      <Toolbar elevation={2} placement="bottom">
        <Button onClick={() => resetSettings('chordQuiz')} intent="neutral">
          <Icon name="reset" />
          Reset to Defaults
        </Button>
      </Toolbar>
    </>
  );
};

export default ChordQuizSettings;
