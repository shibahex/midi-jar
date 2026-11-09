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

import { fields } from './constants';

const ScaleQuizSettings: React.FC = () => {
  const { settings, updateSetting, resetSettings } = useSettings();

  return (
    <>
      <ScrollContainer pad="md">
        <Container size="md">
          <FormField label="Scales" hint="Choose which scales can be asked">
            <Select
              options={fields.scales.choices}
              onChange={(value) => updateSetting('scaleQuiz.scales', value)}
              value={settings.scaleQuiz.scales}
            />
          </FormField>

          <FormField label="Tonic" hint="Choose how the tonic of the scale is picked">
            <Select
              options={fields.mode.choices}
              onChange={(value) => updateSetting('scaleQuiz.mode', value)}
              value={settings.scaleQuiz.mode}
            />
          </FormField>

          <FormField label="Direction" hint="Choose in which direction the scale is played">
            <Select
              options={fields.direction.choices}
              onChange={(value) => updateSetting('scaleQuiz.direction', value)}
              value={settings.scaleQuiz.direction}
            />
          </FormField>

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
