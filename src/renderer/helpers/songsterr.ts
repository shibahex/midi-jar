import { ImportedSong, SongPartRole } from 'main/types';

import { readChordName } from './songs';

/**
 * Songsterr songs: the page tells the tracks of the song, and each track (from Songsterr's
 * CDN) has its measures with their time signature, the tempo and every note played.
 * The chords are the ones written in the tab, or found from the notes of the rhythm guitar
 * and the bass, half a bar at a time. The notes of the rhythm guitar, bass, lead guitar and
 * vocal melody are kept to be played by the built-in sound.
 */

const CDN = 'https://dqsljvtekg760.cloudfront.net';

/** Most notes kept for a part (the settings keep them) */
const MAX_PART_NOTES = 8000;

type TrackInfo = {
  partId: number;
  name?: string;
  /** what it is played on ("Overdriven Guitar"), and its title (named after it when no name) */
  instrument?: string;
  title?: string;
  views?: number;
  isGuitar?: boolean;
  isBassGuitar?: boolean;
  isDrums?: boolean;
  isEmpty?: boolean;
  isVocalTrack?: boolean;
};

export type SongsterrSong = {
  songId: number;
  revisionId: number;
  image: string;
  title: string;
  artist: string;
  tracks: TrackInfo[];
  popularTrackGuitar?: number;
  popularTrackBass?: number;
};

type Note = {
  string: number;
  fret: number;
  rest?: boolean;
  dead?: boolean;
  tie?: boolean;
  ghost?: boolean;
  accentuated?: boolean;
};
type Beat = {
  duration: [number, number];
  dots?: number;
  tuplet?: number;
  rest?: boolean;
  graceNote?: unknown;
  notes?: Note[];
  chord?: { text?: string };
};
type Measure = {
  signature?: [number, number];
  marker?: { text?: string } | string;
  voices?: { beats?: Beat[] }[];
};
export type SongsterrTrack = {
  measures: Measure[];
  tuning?: number[];
  capo?: number;
  automations?: { tempo?: { measure: number; bpm: number }[] };
};

/** A track to fetch, and what it is used for */
export type SongsterrTrackRef = { role: SongPartRole; name: string; url: string };

export const isSongsterrUrl = (url: string) => {
  try {
    return /(^|\.)songsterr\.com$/i.test(new URL(url).hostname);
  } catch (e) {
    return false;
  }
};

/** JSON from Songsterr may have raw control characters in its texts */
// eslint-disable-next-line no-control-regex
const parseJson = (text: string) => JSON.parse(text.replace(/[\u0000-\u001f]+/g, ' '));

/** Songsterr's search: the first song found for a name ("seven nation army") */
export const getSongsterrSearchUrl = (name: string) =>
  `https://www.songsterr.com/api/songs?size=1&pattern=${encodeURIComponent(name.trim())}`;

/** The page of the first song of a Songsterr search, or null */
export function readSongsterrSearch(json: string) {
  try {
    const songs = parseJson(json) as { songId?: number }[];
    const id = songs?.[0]?.songId;
    return id ? `https://www.songsterr.com/a/wsa/song-tab-s${id}` : null;
  } catch (e) {
    return null;
  }
}

/** The song of a Songsterr page (from the state of the page) */
export function readSongsterrPage(html: string): SongsterrSong | null {
  const json = html.match(/<script id="state" type="application\/json">([\s\S]*?)<\/script>/)?.[1];
  if (!json) return null;
  try {
    const song = parseJson(json)?.meta?.current;
    if (!song?.songId || !song?.revisionId || !song?.image) return null;
    return song as SongsterrSong;
  } catch (e) {
    return null;
  }
}

/** Other instruments kept (piano, strings, synth...), to be played by the player */
const MAX_OTHER_PARTS = 6;

/**
 * Tracks to read: the rhythm guitar (chords), the bass, the lead guitar and the vocal melody,
 * then the other instruments (not the drums)
 */
export function getSongsterrTracks(song: SongsterrSong): SongsterrTrackRef[] {
  const tracks = song.tracks
    .map((track, index) => ({ ...track, partId: track.partId ?? index }))
    .filter((track) => !track.isEmpty && !track.isDrums);
  const byViews = (a: TrackInfo, b: TrackInfo) => (b.views ?? 0) - (a.views ?? 0);
  const guitars = tracks.filter((t) => t.isGuitar && !t.isBassGuitar).sort(byViews);
  const named = (pattern: RegExp) => guitars.find((t) => pattern.test(t.name ?? ''));

  const rhythm =
    named(/rhythm/i) ??
    guitars.find((t) => t.partId === song.popularTrackGuitar) ??
    guitars[0] ??
    tracks.find((t) => !t.isBassGuitar && !t.isVocalTrack);
  const lead = named(/lead|solo/i) ?? guitars.find((t) => t !== rhythm);
  const bass =
    tracks.find((t) => t.partId === song.popularTrackBass) ?? tracks.find((t) => t.isBassGuitar);
  const melody = tracks.filter((t) => t.isVocalTrack).sort(byViews)[0];

  const refs: [SongPartRole, TrackInfo | undefined][] = [
    ['rhythm', rhythm],
    ['bass', bass],
    ['lead', lead !== rhythm ? lead : undefined],
    ['melody', melody],
  ];
  const used = refs.map(([, track]) => track);
  const others = tracks
    .filter((track) => !used.includes(track))
    .sort(byViews)
    .slice(0, MAX_OTHER_PARTS)
    .map((track): [SongPartRole, TrackInfo] => ['other', track]);
  // each its own name (without Songsterr's notes on it: "Piano (retranscribed)")
  const names = new Map<string, number>();
  const nameOf = (track: TrackInfo, role: string) => {
    const name =
      (track.name || track.title || track.instrument || role)
        .replace(/\s*\((re)?transcribed\)\s*$/i, '')
        .trim() || role;
    const count = (names.get(name) ?? 0) + 1;
    names.set(name, count);
    return count > 1 ? `${name} ${count}` : name;
  };
  return [...refs, ...others]
    .filter((ref): ref is [SongPartRole, TrackInfo] => !!ref[1])
    .map(([role, track]) => ({
      role,
      name: nameOf(track, role),
      url: `${CDN}/${song.songId}/${song.revisionId}/${song.image}/${track.partId}.json`,
    }));
}

/** Parses a track file */
export const readSongsterrTrack = (json: string) => parseJson(json) as SongsterrTrack;

const isPowerOf2 = (n: number) => n > 0 && 2 ** Math.round(Math.log2(n)) === n;

/** Length of a beat, in quarter notes (grace notes take no time) */
function beatLength(beat: Beat) {
  if (beat.graceNote) return 0;
  const [num, den] = beat.duration ?? [1, 4];
  // (a dotted note is written with its whole length already: a dotted half is 3/4, its dot
  // only tells how it is drawn)
  let length = (num / den) * 4;
  // tuplets: Songsterr already writes most as exact lengths (1/24 for a triplet 16th)
  if (beat.tuplet && beat.tuplet > 1 && isPowerOf2(den)) {
    length *= 2 ** Math.floor(Math.log2(beat.tuplet)) / beat.tuplet;
  }
  return length;
}

/** Length of each measure in quarter notes (the time signature carries over) */
function measureLengths(measures: Measure[]) {
  let signature: [number, number] = [4, 4];
  return measures.map((measure) => {
    if (measure.signature) signature = measure.signature;
    return (signature[0] * 4) / signature[1];
  });
}

/** The tempo played the longest (songs can change tempo) */
function mainTempo(tempos: { measure: number; bpm: number }[], lengths: number[]) {
  const sorted = [...tempos].sort((a, b) => a.measure - b.measure);
  const time = new Map<number, number>();
  sorted.forEach((tempo, i) => {
    const end = sorted[i + 1]?.measure ?? lengths.length;
    const beats = lengths.slice(tempo.measure, end).reduce((a, b) => a + b, 0);
    time.set(tempo.bpm, (time.get(tempo.bpm) ?? 0) + beats);
  });
  return [...time.entries()].reduce<[number, number] | null>(
    (best, entry) => (!best || entry[1] > best[1] ? entry : best),
    null
  )?.[0];
}

/**
 * The song's time in beats of its main tempo: a part at another tempo (an intro at 100 BPM in
 * a song at 194) lasts as long as it does in the song (positions in quarter notes)
 */
function tempoWarp(
  tempos: { measure: number; bpm: number }[],
  measureStarts: number[],
  main: number
) {
  const sorted = [...tempos]
    .filter((t) => t.bpm > 0)
    .sort((a, b) => a.measure - b.measure)
    .map((t) => ({ from: measureStarts[t.measure] ?? Infinity, ratio: main / t.bpm }));
  if (!sorted.length) return (position: number) => position;
  return (position: number) => {
    let warped = 0;
    let at = 0;
    // before the first tempo: the first one
    let { ratio } = sorted[0];
    sorted.forEach((tempo) => {
      if (tempo.from > position) return;
      warped += (tempo.from - at) * ratio;
      at = tempo.from;
      ratio = tempo.ratio;
    });
    return warped + (position - at) * ratio;
  };
}

type PlayedNote = { start: number; length: number; midi: number; velocity: number };

/** Every note of a track, in quarter notes from the start (tied notes are held) */
function readNotes(track: SongsterrTrack, measureStarts: number[]) {
  const tuning = track.tuning ?? [];
  const capo = track.capo ?? 0;
  const notes: PlayedNote[] = [];
  (track.measures ?? []).forEach((measure, m) => {
    if (m >= measureStarts.length) return;
    (measure.voices ?? []).forEach((voice) => {
      let time = measureStarts[m];
      // the note sounding on each string (a tied note goes on)
      (voice.beats ?? []).forEach((beat) => {
        const length = beatLength(beat);
        if (!beat.rest) {
          (beat.notes ?? []).forEach((note) => {
            if (note.rest || note.dead || tuning[note.string] === undefined) return;
            const midi = tuning[note.string] + note.fret + capo;
            const held = note.tie
              ? [...notes]
                  .reverse()
                  .find((n) => n.midi === midi && n.start + n.length >= time - 1e-3)
              : undefined;
            if (held) {
              held.length = time + length - held.start;
              return;
            }
            let velocity = 90;
            if (note.ghost) velocity = 50;
            if (note.accentuated) velocity = 115;
            notes.push({ start: time, length: Math.max(length, 0.1), midi, velocity });
          });
        }
        time += length;
      });
    });
  });
  return notes.sort((a, b) => a.start - b.start);
}

// Krumhansl-Schmuckler key profiles
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

/** Key of the song, from how long each pitch class is played */
function findKey(weights: number[]) {
  const candidates = Array.from({ length: 24 }, (_, i) => {
    const tonic = i % 12;
    const minor = i >= 12;
    const profile = minor ? MINOR_PROFILE : MAJOR_PROFILE;
    const score = weights.reduce((sum, w, pc) => sum + w * profile[(pc - tonic + 12) % 12], 0);
    return { tonic, minor, score };
  });
  return candidates.reduce((best, c) => (c.score > best.score ? c : best));
}

const SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
// keys written with flats (tonic of the major key)
const FLAT_MAJORS = [5, 10, 3, 8, 1, 6];

// triads of a major key on each degree (semitones from the tonic): "" major, "m" minor
const MAJOR_KEY_TRIADS: Record<number, string> = {
  0: '',
  2: 'm',
  4: 'm',
  5: '',
  7: '',
  9: 'm',
  11: 'dim',
};

/** The pitch classes clearly played in a part of a song (a tenth of it or more) */
function notesPlayed(weights: number[]) {
  const total = weights.reduce((a, b) => a + b, 0);
  return total > 0
    ? weights.map((w, pc) => (w / total >= 0.1 ? pc : -1)).filter((pc) => pc >= 0)
    : [];
}

/** A chord of the key fits a little better than one out of it (when the notes allow both) */
const IN_KEY_BONUS = 0.12;

/**
 * Chord of a part of a measure: the major or minor triad that fits the notes best
 * (the bass helps find the root, the chords of the key come first). Power chords take the
 * quality of the key.
 */
function findChord(weights: number[], bass: number | null, key: { tonic: number; minor: boolean }) {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  const w = weights.map((x) => x / total);
  const max = Math.max(...w);
  const relativeMajor = key.minor ? (key.tonic + 3) % 12 : key.tonic;

  const candidates = Array.from({ length: 24 }, (_, i) => {
    const root = i % 12;
    const quality = i >= 12 ? 'm' : '';
    const third = (root + (quality === 'm' ? 3 : 4)) % 12;
    const fifth = (root + 7) % 12;
    const inChord = w[root] + w[third] + w[fifth];
    let score = w[root] * 1.2 + w[third] + w[fifth] * 0.8 - (1 - inChord) * 0.6;
    if (bass === root) score += 0.4 * max;
    if (MAJOR_KEY_TRIADS[(root - relativeMajor + 12) % 12] === quality) score += IN_KEY_BONUS;
    // how many of its notes are played (a tenth of the time or more)
    const played = [root, third, fifth].filter((pc) => w[pc] >= 0.1).length;
    return { root, quality, score, played };
  });
  // a chord has 2 of the notes played or more (one note ringing long is not a chord of its
  // own: a C# over G D B is a color of G, not C#)
  const most = Math.min(2, Math.max(...candidates.map((c) => c.played)));
  const best = candidates
    .filter((c) => c.played >= most)
    .reduce((a, b) => (b.score > a.score ? b : a));

  // no third played (power chord): major or minor as in the key
  const { root } = best;
  let { quality } = best;
  if (w[(root + 3) % 12] < 0.04 && w[(root + 4) % 12] < 0.04) {
    const degreeTriad = MAJOR_KEY_TRIADS[(root - relativeMajor + 12) % 12];
    quality = degreeTriad === 'm' ? 'm' : '';
  }
  return { root, quality };
}

/** Two different notes sound together in a part of a measure (more than a moment) */
function playedTogether(notes: PlayedNote[], segment: { start: number; length: number }) {
  const end = segment.start + segment.length;
  const inside = notes.filter((n) => n.start < end && n.start + n.length > segment.start);
  return inside.some((a, i) =>
    inside
      .slice(i + 1)
      .some(
        (b) =>
          a.midi % 12 !== b.midi % 12 &&
          Math.min(a.start + a.length, b.start + b.length, end) -
            Math.max(a.start, b.start, segment.start) >
            0.1
      )
  );
}

/** No chord played (written like in chord sheets) */
export const NO_CHORD = 'N.C.';
/** No chord for less than this (beats): the chord before goes on */
const BEATS_PER_REST = 4;

/** Chord names written in a track, with when they start */
function readWrittenChords(track: SongsterrTrack, measureStarts: number[]) {
  const written: { time: number; name: string }[] = [];
  (track.measures ?? []).forEach((measure, m) => {
    let time = measureStarts[m] ?? 0;
    (measure.voices?.[0]?.beats ?? []).forEach((beat) => {
      const name = beat.chord?.text ? readChordName(beat.chord.text) : null;
      if (name) written.push({ time, name });
      time += beatLength(beat);
    });
  });
  return written;
}

/** Rounded to a thousandth of a beat (smaller settings) */
const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * A song from the tracks of a Songsterr song, with their role (rhythm guitar, bass,
 * lead guitar, vocal melody)
 */
export function songFromSongsterr(
  song: SongsterrSong,
  tracks: { role: SongPartRole; name: string; track: SongsterrTrack }[],
  url: string
): Omit<ImportedSong, 'id'> | { error: string } {
  const main = tracks.find((t) => t.role === 'rhythm')?.track ?? tracks[0]?.track;
  if (!main?.measures?.length) return { error: 'No notes found in this Songsterr song' };
  const lengths = measureLengths(main.measures);
  const measureStarts: number[] = [];
  lengths.reduce((position, length) => {
    measureStarts.push(position);
    return position + length;
  }, 0);

  // the notes of each track (several are other instruments), and of the main parts by role
  const trackNotes = tracks.map(({ track }) => readNotes(track, measureStarts));
  const notesOf = new Map(
    tracks.map(({ role }, i) => [role, trackNotes[i]] as const).filter(([role]) => role !== 'other')
  );
  const tempos =
    tracks.find(({ track }) => track.automations?.tempo?.length)?.track.automations?.tempo ?? [];
  const tempo = mainTempo(tempos, lengths);
  const warp = tempo ? tempoWarp(tempos, measureStarts, tempo) : (position: number) => position;

  // parts of each measure: halves of 4/4 measures, whole shorter ones
  const segments = lengths.flatMap((length, m) => {
    const count = length >= 4 && length % 2 === 0 ? 2 : 1;
    return Array.from({ length: count }, (_, p) => ({
      start: measureStarts[m] + (p * length) / count,
      length: length / count,
      weights: new Array(12).fill(0) as number[],
      bass: new Array(12).fill(0) as number[],
    }));
  });

  // harmony: the rhythm guitar (or the lead if there is no rhythm guitar) and the bass
  const harmony = notesOf.get('rhythm') ?? notesOf.get('lead') ?? [];
  const bassNotes = notesOf.get('bass') ?? [];
  const totalWeights = new Array(12).fill(0);
  const addWeights = (notes: PlayedNote[], isBass: boolean) =>
    notes.forEach((note) => {
      const pc = note.midi % 12;
      totalWeights[pc] += note.length;
      segments.forEach((segment) => {
        const overlap =
          Math.min(note.start + note.length, segment.start + segment.length) -
          Math.max(note.start, segment.start);
        if (overlap <= 0) return;
        // the bass counts for the root, and a little for the harmony
        segment.weights[pc] += isBass ? overlap * 0.5 : overlap;
        if (isBass) segment.bass[pc] += overlap;
      });
    });
  addWeights(harmony, false);
  addWeights(bassNotes, true);

  const key = findKey(totalWeights);
  const names = FLAT_MAJORS.includes(key.minor ? (key.tonic + 3) % 12 : key.tonic) ? FLATS : SHARPS;

  // section markers (Intro, Verse 1, Chorus...) and when they start
  const markers = main.measures
    .map((measure, m) => {
      const text = typeof measure.marker === 'string' ? measure.marker : measure.marker?.text;
      return text ? { name: text.trim(), time: measureStarts[m] } : null;
    })
    .filter((marker): marker is { name: string; time: number } => !!marker?.name);
  const sectionTimes = markers.map((marker) => marker.time);

  // chords: the ones written in the tab (enough of them), or found from the notes
  // (written in the rhythm guitar, about one every 2 bars or more, from where it starts playing)
  const written = readWrittenChords(main, measureStarts);
  const playedFrom = harmony[0]?.start ?? 0;
  const useWritten =
    written.length >= Math.max(4, lengths.length / 2) && written[0].time <= playedFrom + 8;
  const timeline: { time: number; name: string | null }[] = useWritten
    ? written
    : (() => {
        let previous: { root: number; quality: string } | null = null;
        let previousNotes: number[] = [];
        return segments.map((segment) => {
          const bassMax = Math.max(...segment.bass);
          const bass = bassMax > 0 ? segment.bass.indexOf(bassMax) : null;
          // the same notes as before (an arpeggio starting elsewhere): the same chord
          const notes = notesPlayed(segment.weights);
          // a chord is played: 3 notes or more, or 2 over a bass or together (a power chord);
          // else no chord (a few notes of a riff while someone sings)
          const chordPlayed =
            notes.length >= 3 ||
            (notes.length === 2 && (bass !== null || playedTogether(harmony, segment)));
          if (!chordPlayed) return { time: segment.start, name: NO_CHORD };
          const same =
            previous &&
            notes.length > 0 &&
            notes.length === previousNotes.length &&
            notes.every((pc) => previousNotes.includes(pc));
          const found = same ? previous : findChord(segment.weights, bass, key);
          previous = found ?? previous;
          if (notes.length) previousNotes = notes;
          return {
            time: segment.start,
            name: found ? `${names[found.root]}${found.quality}` : null,
          };
        });
      })();
  // a new section starts on its own chord (times in beats of the main tempo from here)
  const songEnd = warp(measureStarts[measureStarts.length - 1] + lengths[lengths.length - 1]);
  const changes = [
    ...timeline.map((change) => ({ ...change, time: warp(change.time) })),
    ...sectionTimes.map((time) => ({ time: warp(time), name: undefined })),
  ].sort((a, b) => a.time - b.time);

  const chords: string[] = [];
  const beats: number[] = [];
  const chordStarts: number[] = [];
  let current: string | null = null;
  changes.forEach((change, i) => {
    const end = changes[i + 1]?.time ?? songEnd;
    const isSection = change.name === undefined;
    const name = isSection ? current : change.name;
    current = name ?? current;
    // lasting no time (a chord on the beat a section starts on): the section plays it
    if (end - change.time <= 1e-6) return;
    if (!name) {
      // silence: the chord before goes on (nothing before: the song has not started)
      if (beats.length) beats[beats.length - 1] += end - change.time;
      return;
    }
    if (!isSection && chords.length && chords[chords.length - 1] === name) {
      beats[beats.length - 1] += end - change.time;
    } else {
      chords.push(name);
      beats.push(end - change.time);
      chordStarts.push(change.time);
    }
  });
  // no chord for less than a bar (a break, a fill): the chord before goes on
  for (let i = chords.length - 1; i >= 1; i -= 1) {
    if (chords[i] === NO_CHORD && beats[i] < BEATS_PER_REST) {
      beats[i - 1] += beats[i];
      chords.splice(i, 1);
      beats.splice(i, 1);
      chordStarts.splice(i, 1);
    }
  }
  for (let i = chords.length - 1; i >= 1; i -= 1) {
    if (chords[i] === chords[i - 1]) {
      beats[i - 1] += beats[i];
      chords.splice(i, 1);
      beats.splice(i, 1);
      chordStarts.splice(i, 1);
    }
  }
  // (the song starts with its first chord)
  while (chords[0] === NO_CHORD) {
    chords.shift();
    beats.shift();
    chordStarts.shift();
  }
  if (!chords.length) return { error: 'No chords found in this Songsterr song' };

  // sections: the first chord at or after each marker
  const sections = markers
    .map(({ name, time }) => ({
      name,
      start: chordStarts.findIndex((t) => t >= warp(time) - 1e-6),
    }))
    // markers before the first chord all point to it: the last one names it
    .filter(
      (section, i, all) =>
        section.start >= 0 && !all.slice(i + 1).some((x) => x.start === section.start)
    );

  // the song starts with its first note (an intro plays before the first chord)
  const firstChord = chordStarts[0];
  const firstNote = Math.min(
    firstChord,
    ...trackNotes.map((notes) => (notes[0] ? warp(notes[0].start) : Infinity))
  );
  const parts = tracks
    .map(({ role, name }, i) => ({
      role,
      name,
      notes: trackNotes[i]
        .filter((note) => warp(note.start) >= firstNote - 1e-6)
        .slice(0, MAX_PART_NOTES)
        .flatMap((note) => [
          round(warp(note.start) - firstNote),
          round(warp(note.start + note.length) - warp(note.start)),
          note.midi,
          note.velocity,
        ]),
    }))
    .filter((part) => part.notes.length);

  const firstSignature = main.measures.find((m) => m.signature)?.signature ?? [4, 4];
  const beatsPerBar = (firstSignature[0] * 4) / firstSignature[1];

  return {
    title: [song.title, song.artist].filter(Boolean).join(' by ') || 'Songsterr song',
    key: `${names[key.tonic]}${key.minor ? 'm' : ''}`,
    chords,
    beats: beats.map(round),
    ...(beatsPerBar !== 4 && beatsPerBar > 0 ? { beatsPerBar } : {}),
    ...(tempo && tempo > 0 ? { bpm: Math.round(tempo) } : {}),
    url,
    ...(sections.length ? { sections } : {}),
    ...(firstChord - firstNote > 1e-6 ? { leadIn: round(firstChord - firstNote) } : {}),
    ...(parts.length ? { parts } : {}),
    ...(!useWritten ? { chordsGuessed: true } : {}),
  };
}
