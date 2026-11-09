import { useCallback, useEffect, useRef } from 'react';

import { MidiMessage } from 'main/types';
import { getMidiCommand, getMidiNote, getMidiValue } from 'renderer/helpers';

import useMidiMessage from './useMidiMessage';

const MIDI_CMD_NOTE_ON = 0x90;

/**
 * Calls `onNoteOn` with the midi note number each time a key is pressed.
 * Unlike `useNotes`, this reports every single key press, which suits
 * games where notes are played one at a time.
 */
export default function useNoteOn(onNoteOn: (midi: number) => void) {
  const callbackRef = useRef(onNoteOn);

  useEffect(() => {
    callbackRef.current = onNoteOn;
  }, [onNoteOn]);

  const onMessage = useCallback((message: MidiMessage) => {
    if (getMidiCommand(message) === MIDI_CMD_NOTE_ON && getMidiValue(message) > 0) {
      callbackRef.current(getMidiNote(message));
    }
  }, []);

  useMidiMessage(onMessage);
}
