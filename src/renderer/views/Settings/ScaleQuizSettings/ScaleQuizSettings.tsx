import React from 'react';
import {
  Button,
  Container,
  Switch,
  FormField,
  FormControlLabel,
  Select,
  Toolbar,
} from '@la-jarre-a-son/ui';

import { useSettings } from 'renderer/contexts/Settings';
import { Icon, ScrollContainer } from 'renderer/components';
import { getIncludedMelodies, MELODIES } from 'renderer/helpers';

import ToggleList, { useExcludedList } from '../ToggleList';
import { fields } from './constants';

const NO_ITEMS: string[] = [];

const ScaleQuizSettings: React.FC = () => {
  const { settings, updateSetting, resetSettings } = useSettings();
  const melodies = settings.scaleQuiz.practice === 'melodies';
  const solo = settings.scaleQuiz.practice === 'solo';
  // played note by note in order: no scale direction or jumping back
  const inOrder = melodies || solo;

  const [excludedMelodies, toggleMelody] = useExcludedList(
    settings.scaleQuiz.excludedMelodies ?? NO_ITEMS,
    'scaleQuiz.excludedMelodies'
  );

  return (
    <>
      <ScrollContainer pad="md">
        <Container size="md">
          <FormField
            label="Practice"
            hint="Play scales, the melodies of songs, or random solo phrases over your own backing track"
          >
            <Select
              options={fields.practice.choices}
              onChange={(value) => updateSetting('scaleQuiz.practice', value)}
              value={settings.scaleQuiz.practice}
            />
          </FormField>

          {melodies ? (
            <FormField label="Melodies" hint="Choose which songs can be asked">
              <ToggleList
                items={MELODIES.map((m) => ({ id: m.id, label: m.title }))}
                included={getIncludedMelodies(excludedMelodies).map((m) => m.id)}
                onToggle={toggleMelody}
                hint="Click a song to leave it out or ask it again"
              />
            </FormField>
          ) : null}

          {solo && (
            <>
              <FormField
                label="Key"
                hint="The key of your backing track (or the current key in Notation settings)"
              >
                <Select
                  options={fields.soloKey.choices}
                  onChange={(value) => updateSetting('scaleQuiz.soloKey', value)}
                  value={settings.scaleQuiz.soloKey}
                />
              </FormField>
              <FormField label="Scale" hint="The scale to solo with over the backing track">
                <Select
                  options={fields.soloScale.choices}
                  onChange={(value) => updateSetting('scaleQuiz.soloScale', value)}
                  value={settings.scaleQuiz.soloScale}
                />
              </FormField>
              <FormField label="Phrase Length" hint="Number of notes in each phrase">
                <Select
                  options={fields.soloLength.choices}
                  onChange={(value) => updateSetting('scaleQuiz.soloLength', value)}
                  value={settings.scaleQuiz.soloLength}
                />
              </FormField>
            </>
          )}

          {!inOrder && (
            <FormField label="Scales" hint="Choose which scales can be asked">
              <Select
                options={fields.scales.choices}
                onChange={(value) => updateSetting('scaleQuiz.scales', value)}
                value={settings.scaleQuiz.scales}
              />
            </FormField>
          )}

          {!solo && (
            <FormField
              label={melodies ? 'Key' : 'Tonic'}
              hint={
                melodies
                  ? 'Choose the key songs are played in (random, in order, or the current key)'
                  : 'Choose how the tonic of the scale is picked'
              }
            >
              <Select
                options={melodies ? fields.melodyKey.choices : fields.scaleQuizMode.choices}
                onChange={(value) => updateSetting('scaleQuiz.mode', value)}
                value={settings.scaleQuiz.mode}
              />
            </FormField>
          )}

          {!solo && settings.scaleQuiz.mode !== 'randomInKey' && (
            <FormField
              label="Keys"
              hint="Choose if tonics can be sharp or flat (C# major, Bb minor...)"
            >
              <Select
                options={fields.tonics.choices}
                onChange={(value) => updateSetting('scaleQuiz.tonics', value)}
                value={settings.scaleQuiz.tonics}
              />
            </FormField>
          )}

          {!inOrder && (
            <FormField label="Direction" hint="Choose in which direction the scale is played">
              <Select
                options={fields.direction.choices}
                onChange={(value) => updateSetting('scaleQuiz.direction', value)}
                value={settings.scaleQuiz.direction}
              />
            </FormField>
          )}

          <FormField
            label="Repeat until perfect"
            hint="Number of runs in a row without mistakes needed before moving to the next scale"
          >
            <Select
              options={fields.requiredCleanRuns.choices}
              onChange={(value: string) =>
                updateSetting('scaleQuiz.requiredCleanRuns', Number(value))
              }
              value={`${settings.scaleQuiz.requiredCleanRuns}`}
            />
          </FormField>

          {!inOrder && (
            <FormControlLabel
              label="Jump back"
              hint="Playing a note of the scale already played (like the tonic) continues from that note instead of counting as a mistake"
              reverse
            >
              <Switch
                onChange={(value) => updateSetting('scaleQuiz.jumpBack', value)}
                checked={settings.scaleQuiz.jumpBack}
              />
            </FormControlLabel>
          )}

          <FormControlLabel
            label="Learning Mode"
            hint="Displays a piano keyboard with the scale and the next key to play"
            reverse
          >
            <Switch
              onChange={(value) => updateSetting('scaleQuiz.learningMode', value)}
              checked={settings.scaleQuiz.learningMode}
            />
          </FormControlLabel>

          {settings.scaleQuiz.learningMode && (
            <FormField label="Fingering" hint="Displays finger numbers (1 is thumb, 5 is pinky)">
              <Select
                options={fields.fingering.choices}
                onChange={(value) => updateSetting('scaleQuiz.fingering', value)}
                value={settings.scaleQuiz.fingering}
              />
            </FormField>
          )}

          <FormControlLabel
            label="Gamification"
            hint="Gamifies the quiz by adding scores and game count (no persistence of scoreboard)"
            reverse
          >
            <Switch
              onChange={(value) => updateSetting('scaleQuiz.gamification', value)}
              checked={settings.scaleQuiz.gamification}
            />
          </FormControlLabel>

          <FormControlLabel
            label="Display Reaction"
            hint="Enables the textual reactions to success and fail"
            reverse
          >
            <Switch
              onChange={(value) => updateSetting('scaleQuiz.displayReaction', value)}
              checked={settings.scaleQuiz.displayReaction}
            />
          </FormControlLabel>

          <FormControlLabel
            label="Display Note Names"
            hint="Displays the name of every note of the scale (always on in Learning Mode)"
            reverse
          >
            <Switch
              onChange={(value) => updateSetting('scaleQuiz.displayNoteNames', value)}
              checked={settings.scaleQuiz.displayNoteNames}
            />
          </FormControlLabel>

          <FormControlLabel
            label="Display Formula"
            hint="Displays the degree of each note in the scale"
            reverse
          >
            <Switch
              onChange={(value) => updateSetting('scaleQuiz.displayFormula', value)}
              checked={settings.scaleQuiz.displayFormula}
            />
          </FormControlLabel>

          <FormControlLabel
            label="Display Relative Scale"
            hint="Displays the relative scale under the scale name (A Natural Minor for C Major, C Major for D Dorian...)"
            reverse
          >
            <Switch
              onChange={(value) => updateSetting('scaleQuiz.displayRelative', value)}
              checked={settings.scaleQuiz.displayRelative}
            />
          </FormControlLabel>
        </Container>
      </ScrollContainer>
      <Toolbar elevation={2} placement="bottom">
        <Button onClick={() => resetSettings('scaleQuiz')} intent="neutral">
          <Icon name="reset" />
          Reset to Defaults
        </Button>
      </Toolbar>
    </>
  );
};

export default ScaleQuizSettings;
