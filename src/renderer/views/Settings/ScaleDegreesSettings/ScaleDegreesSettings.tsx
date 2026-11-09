import React from 'react';
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
import { Icon, ScrollContainer } from 'renderer/components';

import { fields } from '../ScaleQuizSettings/constants';

const ScaleDegreesSettings: React.FC = () => {
  const { settings, updateSetting, resetSettings } = useSettings();

  return (
    <>
      <ScrollContainer pad="md">
        <Container size="md">
          <FormField label="Scales" hint="Choose which scales can be asked">
            <Select
              options={fields.scales.choices}
              onChange={(value) => updateSetting('scaleDegrees.scales', value)}
              value={settings.scaleDegrees.scales}
            />
          </FormField>

          <FormField label="Tonic" hint="Choose how the tonic of the scale is picked">
            <Select
              options={fields.mode.choices}
              onChange={(value) => updateSetting('scaleDegrees.mode', value)}
              value={settings.scaleDegrees.mode}
            />
          </FormField>

          <FormField label="Game Length" hint="Number of degrees asked for a single scale">
            <Slider
              value={settings.scaleDegrees.gameLength}
              onChange={(value: number) => updateSetting('scaleDegrees.gameLength', value)}
              min={4}
              max={16}
              step={4}
              marks={[4, 8, 12, 16]}
              valueText={`${settings.scaleDegrees.gameLength}`}
            />
          </FormField>

          <FormControlLabel
            label="Gamification"
            hint="Gamifies the quiz by adding scores and game count (no persistence of scoreboard)"
            reverse
          >
            <Switch
              onChange={(value) => updateSetting('scaleDegrees.gamification', value)}
              checked={settings.scaleDegrees.gamification}
            />
          </FormControlLabel>

          <FormControlLabel
            label="Display Reaction"
            hint="Enables the textual reactions to success and fail"
            reverse
          >
            <Switch
              onChange={(value) => updateSetting('scaleDegrees.displayReaction', value)}
              checked={settings.scaleDegrees.displayReaction}
            />
          </FormControlLabel>

          <FormControlLabel
            label="Display Scale Notes"
            hint="Displays every note of the scale, only the degree has to be found"
            reverse
          >
            <Switch
              onChange={(value) => updateSetting('scaleDegrees.displayScaleNotes', value)}
              checked={settings.scaleDegrees.displayScaleNotes}
            />
          </FormControlLabel>

          <FormControlLabel
            label="Display Degree Name"
            hint="Displays the name of the degree asked (Tonic, Supertonic, Mediant...)"
            reverse
          >
            <Switch
              onChange={(value) => updateSetting('scaleDegrees.displayDegreeName', value)}
              checked={settings.scaleDegrees.displayDegreeName}
            />
          </FormControlLabel>
        </Container>
      </ScrollContainer>
      <Toolbar elevation={2} placement="bottom">
        <Button onClick={() => resetSettings('scaleDegrees')} intent="neutral">
          <Icon name="reset" />
          Reset to Defaults
        </Button>
      </Toolbar>
    </>
  );
};

export default ScaleDegreesSettings;
