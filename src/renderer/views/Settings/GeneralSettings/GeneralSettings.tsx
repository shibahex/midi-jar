import React from 'react';
import classnames from 'classnames/bind';

import { useSettings } from 'renderer/contexts/Settings';
import { useServerState } from 'renderer/contexts/ServerState';

import {
  Box,
  Button,
  Container,
  FormControlLabel,
  Switch,
  Input,
  FormFieldset,
  Select,
  Slider,
} from '@la-jarre-a-son/ui';

import { Icon } from 'renderer/components';
import { synth } from 'renderer/helpers/synth';

import styles from './GeneralSettings.module.scss';

const cx = classnames.bind(styles);

const GeneralSettings: React.FC = () => {
  const { settings, updateSetting } = useSettings();
  const { state, enable } = useServerState();

  return (
    <>
      <Box
        className={cx('state', {
          isStarted: state.started,
          isError: !!state.error,
        })}
        pad="md"
      >
        {!state.error && state.started && `Server is currently running on port ${state.port}`}
        {!state.error && !state.started && 'Server is currently stopped'}
        {state.error && `Server has errored: ${state.error}`}
        {state.started && !!state.addresses.length && (
          <div className={cx('serverUrlContainer')}>
            {'You can access it through: '}
            {state.addresses.flatMap((address, index) => {
              const url = `http://${address}:${state.port}/`;

              return (
                <React.Fragment key={address}>
                  <a href={url} target="_blank" rel="noreferrer">
                    {address}:{state.port}
                  </a>
                  {index !== state.addresses.length - 1 && ', '}
                </React.Fragment>
              );
            })}
          </div>
        )}
      </Box>
      <Container size="md">
        <FormFieldset label="Startup">
          <FormControlLabel label="Launch At Startup" reverse>
            <Switch
              checked={settings.general.launchAtStartup}
              onChange={(value) => updateSetting('general.launchAtStartup', value)}
            />
          </FormControlLabel>

          <FormControlLabel label="Start Minimized" reverse>
            <Switch
              checked={settings.general.startMinimized}
              onChange={(value) => updateSetting('general.startMinimized', value)}
            />
          </FormControlLabel>
        </FormFieldset>
        <FormFieldset label="Sound">
          <FormControlLabel
            label="Play My Notes"
            hint="Hear the notes played on your MIDI keyboard with the built-in sound (if it makes no sound of its own)"
            reverse
          >
            <Switch
              checked={!!settings.general.playNotes}
              onChange={(value) => updateSetting('general.playNotes', value)}
            />
          </FormControlLabel>

          <FormControlLabel
            label="Sound Style"
            hint="Classical: grand piano, cello, violins and flute in a concert hall. Electric: soft keys, synth bass, lead and voice."
            reverse
          >
            <Select
              value={settings.general.soundStyle ?? 'classical'}
              onChange={(value) => updateSetting('general.soundStyle', value)}
              options={[
                { value: 'classical', label: 'Classical' },
                { value: 'electric', label: 'Electric' },
              ]}
            />
          </FormControlLabel>

          <FormControlLabel label="Volume" hint="Volume of the built-in sound" reverse>
            <div className={cx('volume')}>
              <Slider
                value={settings.general.soundVolume ?? 70}
                onChange={(value: number) => updateSetting('general.soundVolume', value)}
                min={0}
                max={100}
                step={5}
                valueText={`${settings.general.soundVolume ?? 70}%`}
              />
              <Button
                icon
                size="sm"
                variant="ghost"
                aria-label="Test the sound"
                title="Test the sound"
                onClick={() => synth.play([60, 64, 67, 72], 1.2)}
              >
                <Icon name="music" />
              </Button>
            </div>
          </FormControlLabel>
        </FormFieldset>
        <FormFieldset label="Overlay server">
          <FormControlLabel label="Enable HTTP &amp; WS server" reverse>
            <Switch checked={settings.server.enabled} onChange={(value) => enable(!!value)} />
          </FormControlLabel>

          <FormControlLabel label="Server Port" reverse>
            <Input
              type="number"
              onChange={(value) => updateSetting('server.port', Number(value))}
              value={settings.server.port ?? null}
              style={{ width: '64px' }}
            />
          </FormControlLabel>
        </FormFieldset>
      </Container>
    </>
  );
};

export default GeneralSettings;
