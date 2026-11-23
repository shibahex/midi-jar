import { Chord, Interval, Midi, Note } from 'tonal';
import { Chord as TChord } from '@tonaljs/chord';

import { RhythmGameSettings, SongPart, SongPartRole } from 'main/types';
import { detect } from 'renderer/helpers/chord-detect';
import { getChordFingering, getChordVoicing, getMelodyFingering, Hand } from 'renderer/helpers';

/** Timing windows around a hit, in milliseconds (a little forgiving) */
export const PERFECT_MS = 110;
export const GOOD_MS = 250;

/** beats in a bar, when a song does not tell */
export const BEATS_PER_BAR = 4;

export type HitResult = 'perfect' | 'good' | 'miss';

/** A chord to play at a given time, from the start of the game */
export type Hit = {
  id: number;
  time: number;
  /** beats until the next hit (or the end of the song) */
  length: number;
  /** first hit of its chord: the chord changes */
  chordStart: boolean;
  name: string;
  numeral: string;
  chord: TChord;
  /** pitch classes of the chord (0-11) */
  chromas: number[];
  /** a note (or notes) of a part of the song to play, instead of a chord (MIDI numbers) */
  notes?: number[];
  result?: HitResult;
  /** the strums held after it (a guitar strumming its chord): heard, not played */
  strums?: { time: number; notes: number[] }[];
  /** passed by a jump ahead (joined in the middle, Spotify moved on): neither played nor missed */
  skipped?: boolean;
};

/** A hit still to play (not judged, not skipped) */
export const isOpen = (hit: Hit) => !hit.result && !hit.skipped;

/** A chord of a song, lasting a number of beats (a bar if not told) */
export type RhythmChord = { name: string; numeral: string; chord: TChord; beats?: number };

/** The rhythm of a song: its time signature, how often its chords are played, its intro */
export type SongRhythm = { beatsPerBar?: number; beatsPerHit?: number; leadIn?: number };

export const getBeatMs = (tempo: number) => 60000 / tempo;

/** How many beats between two hits of the same chord */
export function getBeatsPerHit(pattern: RhythmGameSettings['pattern'], rhythm: SongRhythm) {
  const beatsPerBar = rhythm.beatsPerBar ?? BEATS_PER_BAR;
  switch (pattern) {
    case 'beat':
      return 1;
    case 'half':
      return Math.max(1, Math.round(beatsPerBar / 2));
    case 'bar':
      return beatsPerBar;
    default:
      // the song's rhythm: its own pattern, or once per bar
      return rhythm.beatsPerHit ?? beatsPerBar;
  }
}

/**
 * Hits of a song: each chord is played when it starts, then again every few beats
 * while it lasts (the pattern), after a bar of count-in
 */
export function buildHits(
  chords: RhythmChord[],
  tempo: number,
  pattern: RhythmGameSettings['pattern'],
  rhythm: SongRhythm = {}
): Hit[] {
  const beatMs = getBeatMs(tempo);
  const beatsPerBar = rhythm.beatsPerBar ?? BEATS_PER_BAR;
  const step = getBeatsPerHit(pattern, rhythm);

  // a bar is counted, then the intro plays before the first chord
  let position = beatsPerBar + (rhythm.leadIn ?? 0);
  const hits: Omit<Hit, 'id' | 'length'>[] = [];
  const starts: number[] = [];
  // where each hit's chord ends (no chord after it: nothing to hold)
  const ends: number[] = [];
  chords.forEach(({ name, numeral, chord, beats = beatsPerBar }) => {
    // no chord played there ("N.C."): nothing to play
    if (!chord.tonic) {
      position += beats;
      return;
    }
    // the notes of a playable voicing: big chords can leave out the 5th, the 11th...
    const root = Note.chroma(chord.tonic) ?? 0;
    const chromas = getChordVoicing(chord.intervals).map((semitones) => (root + semitones) % 12);
    for (let offset = 0; offset < beats; offset += step) {
      starts.push(position + offset);
      ends.push(position + beats);
      hits.push({
        time: (position + offset) * beatMs,
        chordStart: offset === 0,
        name,
        numeral,
        chord,
        chromas,
      });
    }
    position += beats;
  });

  return hits.map((hit, id) => ({
    ...hit,
    id,
    length: Math.min(starts[id + 1] ?? position, ends[id]) - starts[id],
  }));
}

/** a chord struck again this soon (in beats) is held instead */
const REPEAT_BEATS = 0.5;
/** a chord held for its repeats is struck again after this many beats */
const MAX_HELD_BEATS = 4;

/**
 * A part's chords struck again and again fast (a guitar strumming) held as one chord instead: a
 * piano does not strum. The same notes, or some of them (a strum missing strings); single notes
 * played again (a bass line) are each played. The strums held are still heard (strums)
 */
export function mergeRepeats(hits: Hit[], tempo: number): Hit[] {
  const beatMs = getBeatMs(tempo);
  const merged: Hit[] = [];
  let last: Hit | undefined;
  hits.forEach((hit) => {
    const held = merged[merged.length - 1];
    if (
      held &&
      last &&
      (hit.notes?.length ?? 0) > 1 &&
      (held.notes?.length ?? 0) > 1 &&
      hit.time - last.time <= REPEAT_BEATS * beatMs + 1 &&
      (hit.time - held.time) / beatMs < MAX_HELD_BEATS &&
      hit.chromas.every((c) => held.chromas.includes(c))
    ) {
      held.length = (hit.time - held.time) / beatMs + hit.length;
      held.strums = [...(held.strums ?? []), { time: hit.time, notes: hit.notes as number[] }];
    } else merged.push({ ...hit, id: merged.length });
    last = hit;
  });
  return merged;
}

/** a rest this long (in beats) lets the hand move anywhere: the fingers start over */
const REST_BEATS = 2;

/**
 * Fingers of a hand for each hit of a part (by id, its notes low to high): its single notes
 * fingered as a line, each finger picked for the notes coming after it too (and the ones
 * before), its chords as chords
 */
export function getPartFingering(hits: Hit[], hand: Hand): Map<number, number[]> {
  const fingers = new Map<number, number[]>();
  let line: Hit[] = [];
  const fingerLine = () => {
    const midis = line.map((h) => (h.notes as number[])[0]);
    getMelodyFingering(midis, hand).forEach((finger, i) => fingers.set(line[i].id, [finger]));
    line = [];
  };
  hits.forEach((hit) => {
    if (!hit.notes) return;
    if (hit.notes.length === 1) {
      line.push(hit);
      if (hit.length >= REST_BEATS) fingerLine();
    } else {
      fingerLine();
      fingers.set(hit.id, getChordFingering(hit.notes, hand));
    }
  });
  fingerLine();
  return fingers;
}

/** The notes a hand plays (low to high), and the finger on each */
export type HandFingers = Partial<Record<Hand, { midis: number[]; fingers: number[] }>>;

/** a hand reaches this far without moving (semitones) */
const HAND_REACH = 7;
/** a hand plays notes this far apart at most (semitones) */
const HAND_SPAN = 12;
/** the left hand above this note, the right one below this one: further from where it plays */
const LEFT_TOP = 64;
const RIGHT_BOTTOM = 52;

/**
 * What it costs a hand to go from where it is (a note, -1: anywhere) to play notes (low to high):
 * moving further than it reaches, leaping, stretching wider than it can, playing far from its
 * side of the keyboard
 */
function handCost(hand: Hand, from: number, notes: number[]) {
  if (!notes.length) return 0;
  const span = notes[notes.length - 1] - notes[0];
  let cost = span > HAND_SPAN ? 50 + span : 0;
  // (the hand is where its note nearest the other hand is)
  const at = hand === 'left' ? notes[notes.length - 1] : notes[0];
  if (from >= 0) {
    const distance = Math.abs(at - from);
    cost += Math.max(0, distance - HAND_REACH) * 0.5 + (distance > HAND_SPAN ? 1 : 0);
  } else {
    // (a hand not playing yet: brought in only when it helps)
    cost += 2;
  }
  notes.forEach((m) => {
    if (hand === 'left' && m > LEFT_TOP) cost += (m - LEFT_TOP) * 0.5;
    if (hand === 'right' && m < RIGHT_BOTTOM) cost += (RIGHT_BOTTOM - m) * 0.5;
  });
  return cost;
}

/**
 * Which hand plays each note of a part (by hit id: the left hand's notes, the right hand's), the
 * easiest way through the whole part: each hand moving the least, neither stretching too wide
 * nor crossing the other, the left one low and the right one high (a bass under a melody: one
 * each; a bass line: the left hand alone)
 */
export function splitHands(hits: Hit[]): Map<number, Record<Hand, number[]>> {
  const split = new Map<number, Record<Hand, number[]>>();
  const noteHits = hits.filter((h) => h.notes?.length);
  if (!noteHits.length) return split;
  // where a hand is: one of the notes of the part (0: not yet anywhere)
  const pitches = [...new Set(noteHits.flatMap((h) => h.notes as number[]))].sort((a, b) => a - b);
  const index = new Map(pitches.map((m, i) => [m, i + 1]));
  const size = pitches.length + 1;
  const pitchOf = (place: number) => (place ? pitches[place - 1] : -1);
  // each way a hit can be played: its notes split between the hands (low ones on the left)
  const optionsOf = (notes: number[]) =>
    Array.from({ length: notes.length + 1 }, (_, k) => ({
      left: notes.slice(0, k),
      right: notes.slice(k),
    }));

  // cost of each state (where the left hand is, where the right one is), hit by hit
  let cost = new Float64Array(size * size).fill(Infinity);
  cost[0] = 0;
  const from: Int32Array[] = [];
  const chosen: Int8Array[] = [];
  noteHits.forEach((hit) => {
    const notes = [...(hit.notes as number[])].sort((a, b) => a - b);
    const options = optionsOf(notes);
    const next = new Float64Array(size * size).fill(Infinity);
    const back = new Int32Array(size * size).fill(-1);
    const pick = new Int8Array(size * size);
    const before = cost;
    for (let state = 0; state < size * size; state += 1) {
      if (before[state] !== Infinity) {
        const left = Math.floor(state / size);
        const right = state % size;
        options.forEach((option, k) => {
          const newLeft = option.left.length
            ? (index.get(option.left[option.left.length - 1]) as number)
            : left;
          const newRight = option.right.length ? (index.get(option.right[0]) as number) : right;
          let c =
            before[state] +
            handCost('left', pitchOf(left), option.left) +
            handCost('right', pitchOf(right), option.right);
          // (the hands crossed: the left one on or above the right one)
          if (newLeft && newRight && pitchOf(newLeft) >= pitchOf(newRight)) c += 30;
          const to = newLeft * size + newRight;
          if (c < next[to]) {
            next[to] = c;
            back[to] = state;
            pick[to] = k;
          }
        });
      }
    }
    cost = next;
    from.push(back);
    chosen.push(pick);
  });

  let state = 0;
  for (let s = 1; s < size * size; s += 1) if (cost[s] < cost[state]) state = s;
  for (let i = noteHits.length - 1; i >= 0; i -= 1) {
    const notes = [...(noteHits[i].notes as number[])].sort((a, b) => a - b);
    split.set(noteHits[i].id, optionsOf(notes)[chosen[i][state]]);
    state = from[i][state];
  }
  return split;
}

/**
 * Fingers of the hands for a part's notes (by hit id): one hand plays them all, or each hand
 * its own notes (splitHands), each fingered on its own, with the notes it plays around them
 */
export function getHandsFingering(hits: Hit[], hands: Hand[]): Map<number, HandFingers> {
  const result = new Map<number, HandFingers>();
  if (hands.length === 1) {
    const [hand] = hands;
    getPartFingering(hits, hand).forEach((fingers, id) => {
      const notes = hits.find((h) => h.id === id)?.notes ?? [];
      result.set(id, { [hand]: { midis: [...notes].sort((a, b) => a - b), fingers } });
    });
    return result;
  }
  const split = splitHands(hits);
  hands.forEach((hand) => {
    // the hand's own notes, lasting until its next ones (its rests: the hand can move)
    const own: Hit[] = [];
    hits.forEach((hit) => {
      const notes = split.get(hit.id)?.[hand] ?? [];
      const last = own[own.length - 1];
      if (!notes.length) {
        if (last) last.length += hit.length;
        return;
      }
      own.push({ ...hit, notes, length: hit.length });
    });
    getPartFingering(own, hand).forEach((fingers, id) => {
      const notes = split.get(id)?.[hand] ?? [];
      result.set(id, { ...result.get(id), [hand]: { midis: notes, fingers } });
    });
  });
  return result;
}

/** The keys held contain every note of the chord (any inversion, doublings allowed) */
export function matchesChord(chromas: number[], playedMidi: number[]) {
  if (!playedMidi.length) return false;
  const played = new Set(playedMidi.map((m) => ((m % 12) + 12) % 12));
  return chromas.every((c) => played.has(c));
}

/** The keys held are the notes themselves, in their octave (MIDI) */
export function matchesNotes(notes: number[], playedMidi: number[]) {
  return notes.length > 0 && notes.every((note) => playedMidi.includes(note));
}

/** How a hit is judged, from how early or late it was played */
export function judge(offsetMs: number): HitResult | null {
  const distance = Math.abs(offsetMs);
  if (distance <= PERFECT_MS) return 'perfect';
  if (distance <= GOOD_MS) return 'good';
  return null;
}

const POINTS: Record<HitResult, number> = { perfect: 300, good: 100, miss: 0 };

/** Points of a hit: a combo adds 10% per hit in a row, up to double */
export const getHitPoints = (result: HitResult, combo: number) =>
  Math.round(POINTS[result] * Math.min(2, 1 + combo * 0.1));

/** A part of a song to practice: its name and the index of its first chord */
export type Section = { name: string; start: number };

/** Bars in a section of a song that has no sections of its own */
const BARS_PER_SECTION = 4;
/** Songs without named parts are cut in about this many parts */
const SECTIONS_PER_SONG = 10;

/**
 * Sections of a song: its own (verse, chorus...), or every 4 bars ("Bars 1-4")
 */
export function getSections(
  chords: RhythmChord[],
  beatsPerBar: number,
  sections: Section[] = []
): Section[] {
  const own = sections.filter((s) => s.start >= 0 && s.start < chords.length);
  if (own.length) return own[0].start === 0 ? own : [{ name: 'Start', start: 0 }, ...own];

  // about SECTIONS_PER_SONG parts, of a multiple of BARS_PER_SECTION bars
  const totalBars =
    chords.reduce((sum, chord) => sum + (chord.beats ?? beatsPerBar), 0) / beatsPerBar;
  const barsPerSection =
    BARS_PER_SECTION * Math.max(1, Math.round(totalBars / SECTIONS_PER_SONG / BARS_PER_SECTION));
  const result: Section[] = [];
  let position = 0;
  let lastGroup = -1;
  chords.forEach((chord, index) => {
    const bar = Math.floor(position / beatsPerBar + 1e-6);
    const group = Math.floor(bar / barsPerSection);
    if (group > lastGroup) {
      lastGroup = group;
      const first = group * barsPerSection + 1;
      result.push({ name: `Bars ${first}-${first + barsPerSection - 1}`, start: index });
    }
    position += chord.beats ?? beatsPerBar;
  });
  return result;
}

/** Chords of a range of sections (first to last, included) */
export function getSectionChords<T>(chords: T[], sections: Section[], first: number, last: number) {
  const from = sections[first]?.start ?? 0;
  const to = sections[last + 1]?.start ?? chords.length;
  return chords.slice(from, Math.max(from + 1, to));
}

/** A note of a song part to play, in milliseconds from the start of the game */
/**
 * A part of a song, to pick it (to hear or to play): the main parts by their role, the other
 * instruments by their name
 */
export const partKey = (part: { role: SongPartRole; name: string }) =>
  part.role === 'other' ? `other:${part.name}` : part.role;

export type PartEvent = {
  time: number;
  duration: number;
  midi: number;
  velocity: number;
  role: SongPartRole;
  /** the part it is of (its key: the sound channel playing it) */
  part: string;
};

/**
 * Notes of the parts of a song (rhythm guitar, bass, lead, melody) in time with the game:
 * after the bar counted before the song
 */
export function buildPartEvents(
  parts: SongPart[],
  keys: string[],
  tempo: number,
  beatsPerBar: number,
  // a part of the song only: from and to a beat (from the song start)
  fromBeat = 0,
  toBeat = Infinity
): PartEvent[] {
  const beatMs = getBeatMs(tempo);
  return parts
    .filter((part) => keys.includes(partKey(part)))
    .flatMap((part) =>
      Array.from({ length: Math.floor(part.notes.length / 4) }, (_, i) => {
        const [start, length, midi, velocity] = part.notes.slice(i * 4, i * 4 + 4);
        return {
          time: (beatsPerBar + start - fromBeat) * beatMs,
          duration: Math.min(length, toBeat - start) * beatMs,
          midi,
          velocity,
          role: part.role,
          part: partKey(part),
          start,
        };
      })
    )
    .filter((event) => event.start >= fromBeat - 1e-6 && event.start < toBeat - 1e-6)
    .map(({ time, duration, midi, velocity, role, part }) => ({
      time,
      duration,
      midi,
      velocity,
      role,
      part,
    }))
    .sort((a, b) => a.time - b.time);
}

/**
 * The name of the chord some notes make (pitch classes, the lowest first), e.g. "E", "Am7",
 * "E/G#": undefined when they make none (or are a single note)
 */
export function nameNotes(names: string[]): string | undefined {
  if (names.length < 2) return undefined;
  const found = detect(names);
  // (a plain name rather than an odd one: "E/G#", not "G#m#5")
  const odd = (name: string) => (/[#b]5/.test(name.replace(/^[A-G][#b]*/, '')) ? 1 : 0);
  const [best] = [...found].sort((a, b) => odd(a) - odd(b));
  // (a major chord: "E", not "EM")
  return best?.replace(/^([A-G][#b]*)M(?=$|\/)/, '$1');
}

/** notes starting this close together are played together (ms) */
const TOGETHER_MS = 30;

/**
 * Hits of a part of the song (lead, melody, bass): its notes, the ones played together
 * making one hit
 */
export function buildNoteHits(events: PartEvent[], tempo: number, sharps: boolean): Hit[] {
  const beatMs = getBeatMs(tempo);
  const groups: PartEvent[][] = [];
  events.forEach((event) => {
    const group = groups[groups.length - 1];
    if (group && event.time - group[0].time <= TOGETHER_MS) group.push(event);
    else groups.push([event]);
  });

  return groups.map((group, id) => {
    const midis = [...new Set(group.map((e) => e.midi))].sort((a, b) => a - b);
    const low = midis[0];
    const names = midis.map((m) => Midi.midiToNoteName(m, { sharps, pitchClass: true }));
    const pitchClasses = [...new Set(names)];
    // several notes: the chord they make (their notes, with octaves, under it)
    const chordName = nameNotes(pitchClasses);
    const next = groups[id + 1]?.[0].time;
    const end = Math.max(...group.map((e) => e.time + e.duration));
    // a chord made of the notes: for the keyboard of the learning mode
    const tonic = names[0];
    const chord: TChord = {
      ...Chord.get(`${tonic}`),
      empty: false,
      name: names.join(' '),
      tonic,
      notes: names,
      intervals: midis.map((m) => Interval.fromSemitones(m - low)),
    };
    return {
      id,
      time: group[0].time,
      length: Math.max(0.25, ((next ?? end) - group[0].time) / beatMs),
      chordStart: true,
      name: chordName ?? pitchClasses.join(' '),
      numeral:
        midis.length > 1
          ? midis.map((m) => Midi.midiToNoteName(m, { sharps })).join(' ')
          : Midi.midiToNoteName(low, { sharps }),
      chord,
      chromas: [...new Set(midis.map((m) => m % 12))],
      notes: midis,
    };
  });
}
