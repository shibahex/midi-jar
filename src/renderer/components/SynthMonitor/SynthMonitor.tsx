import { useEffect } from 'react';

import { useSettings } from 'renderer/contexts/Settings';
import { synth } from 'renderer/helpers/synth';

/** a message is sent once per module it is routed to: the same one within this time is ignored */
const DUPLICATE_MS = 5;

/**
 * Built-in sound for the MIDI keyboard: the notes played are heard (with the sustain pedal),
 * when "Play my notes" is on in the general settings
 */
const SynthMonitor: React.FC = () => {
  const { settings } = useSettings();
  const playNotes = !!settings.general.playNotes;
  const volume = settings.general.soundVolume ?? 70;
  const style = settings.general.soundStyle ?? 'classical';

  useEffect(() => synth.setVolume(volume / 100), [volume]);
  useEffect(() => synth.setStyle(style), [style]);

  useEffect(() => {
    if (!playNotes) return undefined;
    const recent = new Map<string, number>();
    const off = window.midi.onMidiMessage('*', (message, timestamp) => {
      const id = message.join(',');
      const last = recent.get(id);
      recent.set(id, timestamp);
      if (last !== undefined && Math.abs(timestamp - last) < DUPLICATE_MS) return;

      const [status, data1, data2] = message;
      const type = status & 0xf0; // eslint-disable-line no-bitwise
      if (type === 0x90 && data2 > 0) synth.noteOn(data1, data2);
      else if (type === 0x80 || type === 0x90) synth.noteOff(data1);
      else if (type === 0xb0 && data1 === 64) synth.setPedal(data2 >= 64);
    });
    return () => {
      off();
      synth.stopAll();
    };
  }, [playNotes]);

  return null;
};

export default SynthMonitor;
