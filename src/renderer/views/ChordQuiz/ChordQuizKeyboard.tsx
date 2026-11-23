import React, { useEffect, useMemo, useState } from 'react';
import { Midi, Note } from 'tonal';
import { Chord as TChord } from '@tonaljs/chord';

import { Fingering } from 'main/types';
import {
  FingerMark,
  FingerRow,
  HandChip,
  KeyboardHint,
  KeyLegend,
  LearningKeyboard,
  OctaveControl,
} from 'renderer/components';
import {
  clampOctaveShift,
  formatSharpsFlats,
  getChordFingering,
  getChordVoicing,
  getFingeringHands,
  getKeySignatureSpelledLike,
  Hand,
} from 'renderer/helpers';

import { getFollowedOctaveShift } from './utils';

/** how long a hint stays after the key is let go (ms) */
const HINT_MS = 4000;

/** B5: top of the keyboard before adding an octave */
const KEYBOARD_TOP = 83;

type Props = {
  target: TChord;
  keyName: string;
  sharps: boolean;
  fingering: Fingering;
  playedMidiNotes: number[];
  sustainedMidiNotes: number[];
  midiNotes: number[];
  /**
   * The octave the keyboard stays in (octaves from C4–B5), moved with its buttons; undefined:
   * it follows the octave played in
   */
  fixedOctaveShift?: number;
  onFixedOctaveShiftChange?: (shift: number) => void;
  /**
   * The notes as the song plays them (MIDI): shown where they are (octaves up or down by
   * transpose), the keyboard going there; undefined: the chord, in the octave played in
   */
  songNotes?: number[];
  transpose?: number;
  onTransposeChange?: (octaves: number) => void;
  /** fingers of each hand for the notes (low to high), worked out with the notes around them */
  songFingers?: Partial<Record<Hand, { midis: number[]; fingers: number[] }>>;
  /** color of the keys to play (CSS) */
  targetColor?: string;
  /** the song's notes count only in their octave: the keys played are shown where they are */
  strictOctaves?: boolean;
  /**
   * The song's notes: the keys the keyboard shows (MIDI, the lowest to the highest), the notes
   * falling onto them (moved by octaves into them)
   */
  songRange?: { low: number; high: number };
  /**
   * The notes of a part as the song plays them (MIDI), for a keyboard that follows the octave
   * played in or stays in one: shown as they are, moved by octaves onto it
   */
  partNotes?: number[];
  /**
   * The notes just played right (the song's notes, MIDI: or a chord's pitch classes): their keys
   * still held are green, not red (the next notes are shown already)
   */
  justPlayed?: { chromas: number[]; notes?: number[] };
};

/**
 * Keyboard showing the keys of the target chord in root position, in the octave it is played in
 */
const ChordQuizKeyboard: React.FC<Props> = ({
  target,
  keyName,
  sharps,
  fingering,
  playedMidiNotes,
  sustainedMidiNotes,
  midiNotes,
  fixedOctaveShift,
  onFixedOctaveShiftChange,
  songNotes,
  transpose = 0,
  onTransposeChange,
  songFingers,
  targetColor,
  strictOctaves = false,
  songRange,
  partNotes,
  justPlayed,
}) => {
  // the keyboard follows the octave the chord is played in, and stays there for the next chords
  // (or it stays in the octave chosen)
  const [followedShift, setFollowedShift] = useState(0);
  const fixed = fixedOctaveShift !== undefined;
  // the song's notes, moved by octaves: the keyboard goes where they are (and stays there while
  // they fit)
  const songMidi = useMemo(
    () => (songNotes?.length ? songNotes.map((midi) => midi + 12 * transpose) : null),
    [songNotes, transpose]
  );
  const [songShift, setSongShift] = useState(0);
  useEffect(() => {
    if (!songMidi) return;
    const low = 60 + 12 * songShift;
    if (songMidi.every((m) => m >= low && m < low + 24)) return;
    setSongShift(clampOctaveShift(Math.floor(Math.min(...songMidi) / 12) - 5));
  }, [songMidi, songShift]);
  let octaveShift = fixed ? fixedOctaveShift : followedShift;
  if (songMidi) octaveShift = songRange ? Math.floor(songRange.low / 12) - 5 : songShift;

  const baseChordMidi = useMemo(() => {
    // a voicing one hand can play (big chords leave out the 5th, the 11th...)
    const tonicMidi = 60 + (Note.chroma(target.tonic ?? 'C') ?? 0);
    return getChordVoicing(target.intervals).map((semitones) => tonicMidi + semitones);
  }, [target]);

  useEffect(() => {
    if (fixed || songMidi) return;
    const shift = getFollowedOctaveShift(baseChordMidi, playedMidiNotes, followedShift);
    if (shift !== null) setFollowedShift(shift);
  }, [baseChordMidi, playedMidiNotes, followedShift, fixed, songMidi]);
  // a part's notes on a keyboard staying in its octave (or following): moved by octaves onto it,
  // from its lowest key
  const partOffset = useMemo(() => {
    if (songMidi || !partNotes?.length) return null;
    return 12 * Math.ceil((60 + 12 * octaveShift - Math.min(...partNotes)) / 12);
  }, [songMidi, partNotes, octaveShift]);
  const partMidi = useMemo(
    () => (partOffset === null ? null : (partNotes as number[]).map((m) => m + partOffset)),
    [partNotes, partOffset]
  );
  const extraOctave = partMidi
    ? Math.max(...partMidi) > KEYBOARD_TOP + 12 * octaveShift
    : !songMidi && Math.max(...baseChordMidi) > KEYBOARD_TOP;
  const octaveCount = (extraOctave && 3) || 2;
  // the keys shown (MIDI), and their names: "C3–B4"
  const range =
    songMidi && songRange
      ? songRange
      : { low: 60 + 12 * octaveShift, high: 59 + 12 * (octaveShift + octaveCount) };
  const rangeLabel = `${Midi.midiToNoteName(range.low)}–${Midi.midiToNoteName(range.high)}`;

  const chordMidi = useMemo(
    () => songMidi ?? partMidi ?? baseChordMidi.map((midi) => midi + 12 * octaveShift),
    [songMidi, partMidi, baseChordMidi, octaveShift]
  );

  // the keys shown, from the lowest
  const lowestKey = range.low;
  const keyCount = range.high - range.low + 1;
  // the song's notes (or a part's), as shown
  const shown = songMidi ?? partMidi;
  // the song's notes played off the keyboard (any octave counts): shown on the note's key, not
  // wrapped onto another octave of it (which would look like a wrong note); on the keyboard, a
  // key is shown where it is played
  const onSongKeys = (played: number[]) =>
    shown && !strictOctaves
      ? played.map((m) =>
          m >= lowestKey && m < lowestKey + keyCount
            ? m
            : shown.find((note) => (note - m) % 12 === 0) ?? m
        )
      : played;
  // the keys still held from the notes just played (in their octave with strict octaves, as
  // shown): right, not red
  const justShown = justPlayed?.notes?.map(
    (m) => m + (songMidi ? 12 * transpose : partOffset ?? 0)
  );
  const isJustPlayed = (m: number) =>
    !!justPlayed &&
    !chordMidi.includes(m) &&
    (strictOctaves && justShown ? justShown.includes(m) : justPlayed.chromas.includes(m % 12));
  // the song's notes played in another octave than shown (amber: it counts; red with strict
  // octaves): which way to go
  const octaveHint = (() => {
    if (!shown) return null;
    const name = (m: number) => formatSharpsFlats(Midi.midiToNoteName(m, { sharps }));
    const off = playedMidiNotes
      .filter((m) => !shown.includes(m) && !isJustPlayed(m))
      .map((m) => {
        const same = shown.filter((note) => (note - m) % 12 === 0);
        if (!same.length) return null;
        const note = same.reduce((a, b) => (Math.abs(b - m) < Math.abs(a - m) ? b : a));
        return { m, note, octaves: (note - m) / 12 };
      })
      .find(Boolean);
    if (!off) return null;
    const count = Math.abs(off.octaves);
    const way = off.octaves > 0 ? 'higher ↑' : 'lower ↓';
    return `You play ${name(off.m)}: the note is ${name(off.note)}, ${count} octave${
      count > 1 ? 's' : ''
    } ${way}${strictOctaves ? '' : ' (it counts in any octave)'}`;
  })();
  // (still shown a moment after the key is let go: there is time to read it)
  const [lastHint, setLastHint] = useState<string | null>(null);
  useEffect(() => {
    if (octaveHint) {
      setLastHint(octaveHint);
      return undefined;
    }
    const timer = setTimeout(() => setLastHint(null), HINT_MS);
    return () => clearTimeout(timer);
  }, [octaveHint]);
  // the keys played: the song's notes in another octave apart (they count: amber, not red)
  const isOtherOctave = (m: number) =>
    !!shown && !strictOctaves && !shown.includes(m) && shown.some((note) => (note - m) % 12 === 0);
  const keysPlayed = onSongKeys(playedMidiNotes);
  const rightPlayed = keysPlayed.filter(isJustPlayed);
  const shownPlayed = keysPlayed.filter((m) => !isOtherOctave(m) && !isJustPlayed(m));
  const otherOctave = keysPlayed.filter((m) => isOtherOctave(m) && !isJustPlayed(m));
  const shownSustained = onSongKeys(sustainedMidiNotes);

  // key names spelled like the chord
  const keySignature = useMemo(
    () => getKeySignatureSpelledLike(keyName, sharps, target.notes),
    [keyName, sharps, target]
  );

  const hands = useMemo(() => getFingeringHands(fingering), [fingering]);

  const fingers = useMemo(() => {
    // the song's notes: each hand its own (moved like the notes shown), none for a hand with none
    const offset = songMidi ? 12 * transpose : partOffset;
    if (offset !== null && songFingers) {
      return hands.flatMap((hand) => {
        const own = songFingers[hand];
        if (!own?.midis.length) return [];
        return [{ hand, midis: own.midis.map((m) => m + offset), fingers: own.fingers }];
      });
    }
    return hands.map((hand) => ({
      hand,
      midis: [...chordMidi].sort((a, b) => a - b),
      fingers: getChordFingering(chordMidi, hand),
    }));
  }, [hands, chordMidi, songFingers, songMidi, transpose, partOffset]);

  const fingerMarks = useMemo(
    () =>
      fingers.flatMap(({ hand, midis, fingers: f }) =>
        midis.map((midi, i): FingerMark => ({ midi, hand, finger: f[i], next: true }))
      ),
    [fingers]
  );

  return (
    <LearningKeyboard
      octaveShift={octaveShift}
      // big chords (9th, 13th…) can go past the top
      extraOctave={extraOctave}
      range={range}
      otherOctave={otherOctave}
      rightPlayed={rightPlayed}
      keySignature={keySignature}
      targets={chordMidi}
      targetColor={targetColor}
      showOctaves
      marks={fingerMarks}
      hideKeyNames={hands.length > 1}
      played={shownPlayed}
      sustained={shownSustained}
      midi={midiNotes}
    >
      {fingers.length > 0 && (
        <FingerRow>
          {fingers.map(({ hand, fingers: f }) => (
            <HandChip key={hand} hand={hand}>
              <strong>{f.join(' ')}</strong>
            </HandChip>
          ))}
        </FingerRow>
      )}
      {songMidi ? (
        <OctaveControl
          label={`The song's notes${
            transpose
              ? ` ${transpose > 0 ? '+' : '−'}${Math.abs(transpose)} octave${
                  Math.abs(transpose) > 1 ? 's' : ''
                }`
              : ''
          } · ${rangeLabel}`}
          title="The notes where the song plays them: − and + show them an octave lower or higher"
          onLower={onTransposeChange && (() => onTransposeChange(Math.max(-3, transpose - 1)))}
          onHigher={onTransposeChange && (() => onTransposeChange(Math.min(3, transpose + 1)))}
        />
      ) : (
        <OctaveControl
          label={`${rangeLabel} · ${fixed ? 'stays here' : 'follows you'}`}
          title={
            fixed
              ? 'The keyboard stays in this octave'
              : 'The keyboard moves to the octave you play a whole chord in'
          }
          onLower={
            fixed && onFixedOctaveShiftChange
              ? () => onFixedOctaveShiftChange(clampOctaveShift(octaveShift - 1))
              : undefined
          }
          onHigher={
            fixed && onFixedOctaveShiftChange
              ? () => onFixedOctaveShiftChange(clampOctaveShift(octaveShift + 1))
              : undefined
          }
        />
      )}
      {lastHint && (
        <KeyboardHint tone={strictOctaves ? 'danger' : 'warning'}>{lastHint}</KeyboardHint>
      )}
      <KeyLegend
        items={[
          {
            type: 'target',
            label: songMidi
              ? `the notes to play${strictOctaves ? ' (in this octave)' : ' (any octave works)'}`
              : 'keys of the chord (any octave and any inversion works)',
          },
          ...(shown && !strictOctaves
            ? [{ type: 'otherOctave' as const, label: 'played in another octave (counts)' }]
            : []),
        ]}
      />
    </LearningKeyboard>
  );
};

ChordQuizKeyboard.defaultProps = {
  fixedOctaveShift: undefined,
  onFixedOctaveShiftChange: undefined,
  songNotes: undefined,
  transpose: 0,
  onTransposeChange: undefined,
  songFingers: undefined,
  targetColor: undefined,
  strictOctaves: false,
  songRange: undefined,
  justPlayed: undefined,
  partNotes: undefined,
};

export default ChordQuizKeyboard;
