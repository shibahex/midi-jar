import { Note } from 'tonal';
import { Chord as TChord } from '@tonaljs/chord';

import { RhythmGameSettings } from 'main/types';
import { getChordVoicing } from 'renderer/helpers';

/** Timing windows around a hit, in milliseconds */
export const PERFECT_MS = 90;
export const GOOD_MS = 200;

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
  result?: HitResult;
};

/** A chord of a song, lasting a number of beats (a bar if not told) */
export type RhythmChord = { name: string; numeral: string; chord: TChord; beats?: number };

/** The rhythm of a song: its time signature, and how often its chords are played */
export type SongRhythm = { beatsPerBar?: number; beatsPerHit?: number };

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

  let position = beatsPerBar; // count-in
  const hits: Omit<Hit, 'id' | 'length'>[] = [];
  const starts: number[] = [];
  chords.forEach(({ name, numeral, chord, beats = beatsPerBar }) => {
    // the notes of a playable voicing: big chords can leave out the 5th, the 11th...
    const root = Note.chroma(chord.tonic ?? 'C') ?? 0;
    const chromas = getChordVoicing(chord.intervals).map((semitones) => (root + semitones) % 12);
    for (let offset = 0; offset < beats; offset += step) {
      starts.push(position + offset);
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
    length: (starts[id + 1] ?? position) - starts[id],
  }));
}

/** The keys held contain every note of the chord (any inversion, doublings allowed) */
export function matchesChord(chromas: number[], playedMidi: number[]) {
  if (!playedMidi.length) return false;
  const played = new Set(playedMidi.map((m) => ((m % 12) + 12) % 12));
  return chromas.every((c) => played.has(c));
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

  const result: Section[] = [];
  let position = 0;
  let lastGroup = -1;
  chords.forEach((chord, index) => {
    const bar = Math.floor(position / beatsPerBar + 1e-6);
    const group = Math.floor(bar / BARS_PER_SECTION);
    if (group > lastGroup) {
      lastGroup = group;
      const first = group * BARS_PER_SECTION + 1;
      result.push({ name: `Bars ${first}-${first + BARS_PER_SECTION - 1}`, start: index });
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
