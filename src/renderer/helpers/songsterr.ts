import { ImportedSong } from 'main/types';

/**
 * Songsterr songs: the page tells the tracks of the song, and each track (from Songsterr's
 * CDN) has its measures with their time signature, the tempo and every note played.
 * The chords are found from the notes of the rhythm guitar and the bass, half a bar at a time.
 */

const CDN = 'https://dqsljvtekg760.cloudfront.net';

type TrackInfo = {
  partId: number;
  name?: string;
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

type Note = { string: number; fret: number; rest?: boolean; dead?: boolean };
type Beat = {
  duration: [number, number];
  dots?: number;
  tuplet?: number;
  rest?: boolean;
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

export const isSongsterrUrl = (url: string) => {
  try {
    return /(^|\.)songsterr\.com$/i.test(new URL(url).hostname);
  } catch (e) {
    return false;
  }
};

/** The song of a Songsterr page (from the state of the page) */
export function readSongsterrPage(html: string): SongsterrSong | null {
  const json = html.match(/<script id="state" type="application\/json">([\s\S]*?)<\/script>/)?.[1];
  if (!json) return null;
  try {
    const song = JSON.parse(json)?.meta?.current;
    if (!song?.songId || !song?.revisionId || !song?.image) return null;
    return song as SongsterrSong;
  } catch (e) {
    return null;
  }
}

/** Tracks to read the chords from: the rhythm guitar (or the main guitar) and the bass */
export function getSongsterrTrackUrls(song: SongsterrSong) {
  const playable = song.tracks
    .map((track, index) => ({ ...track, partId: track.partId ?? index }))
    .filter((track) => !track.isEmpty && !track.isDrums && !track.isVocalTrack);
  const guitars = playable.filter((track) => track.isGuitar);
  const guitar =
    guitars.find((track) => /rhythm/i.test(track.name ?? '')) ??
    guitars.find((track) => track.partId === song.popularTrackGuitar) ??
    guitars[0] ??
    playable.find((track) => !track.isBassGuitar);
  const bass =
    playable.find((track) => track.partId === song.popularTrackBass) ??
    playable.find((track) => track.isBassGuitar);
  return [guitar, bass]
    .filter((track): track is TrackInfo => !!track)
    .map((track) => `${CDN}/${song.songId}/${song.revisionId}/${song.image}/${track.partId}.json`);
}

/** Length of a beat, in quarter notes */
function beatLength(beat: Beat) {
  const [num, den] = beat.duration ?? [1, 4];
  let length = (num / den) * 4;
  if (beat.dots === 1) length *= 1.5;
  if (beat.dots === 2) length *= 1.75;
  // triplets and other tuplets: n notes in the time of the power of 2 below n
  if (beat.tuplet && beat.tuplet > 1) {
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

/**
 * Chord of a part of a measure: the major or minor triad that fits the notes best
 * (the bass helps find the root). Power chords take the quality of the key.
 */
function findChord(weights: number[], bass: number | null, key: { tonic: number; minor: boolean }) {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  const w = weights.map((x) => x / total);
  const max = Math.max(...w);

  const best = Array.from({ length: 24 }, (_, i) => {
    const root = i % 12;
    const quality = i >= 12 ? 'm' : '';
    const third = (root + (quality === 'm' ? 3 : 4)) % 12;
    const fifth = (root + 7) % 12;
    const inChord = w[root] + w[third] + w[fifth];
    let score = w[root] * 1.2 + w[third] + w[fifth] * 0.8 - (1 - inChord) * 0.6;
    if (bass === root) score += 0.4 * max;
    return { root, quality, score };
  }).reduce((a, b) => (b.score > a.score ? b : a));

  // no third played (power chord): major or minor as in the key
  const { root } = best;
  let { quality } = best;
  if (w[(root + 3) % 12] < 0.04 && w[(root + 4) % 12] < 0.04) {
    const relativeMajor = key.minor ? (key.tonic + 3) % 12 : key.tonic;
    const degreeTriad = MAJOR_KEY_TRIADS[(root - relativeMajor + 12) % 12];
    quality = degreeTriad === 'm' ? 'm' : '';
  }
  return { root, quality };
}

/** A song from the tracks of a Songsterr song (rhythm guitar first, then bass) */
export function songFromSongsterr(
  song: SongsterrSong,
  tracks: SongsterrTrack[],
  url: string
): Omit<ImportedSong, 'id'> | { error: string } {
  const main = tracks[0];
  if (!main?.measures?.length) return { error: 'No notes found in this Songsterr song' };
  const lengths = measureLengths(main.measures);

  // parts of each measure: halves of 4/4 measures, whole shorter ones
  const segments: { start: number; length: number; weights: number[]; bass: number[] }[] = [];
  const measureStarts: number[] = [];
  let position = 0;
  lengths.forEach((length) => {
    measureStarts.push(position);
    const parts = length >= 4 && length % 2 === 0 ? 2 : 1;
    for (let p = 0; p < parts; p += 1) {
      segments.push({
        start: position + (p * length) / parts,
        length: length / parts,
        weights: new Array(12).fill(0),
        bass: new Array(12).fill(0),
      });
    }
    position += length;
  });

  const segmentAt = (time: number) =>
    segments.find((s) => time >= s.start - 1e-6 && time < s.start + s.length - 1e-6);

  // chord names written in the tab (if any) take over
  const writtenChords = new Map<number, string>();
  const totalWeights = new Array(12).fill(0);

  tracks.forEach((track, trackIndex) => {
    const isBass = trackIndex > 0;
    const tuning = track.tuning ?? [];
    const capo = track.capo ?? 0;
    (track.measures ?? []).forEach((measure, m) => {
      if (m >= measureStarts.length) return;
      (measure.voices ?? []).forEach((voice) => {
        let time = measureStarts[m];
        (voice.beats ?? []).forEach((beat) => {
          const length = beatLength(beat);
          const segment = segmentAt(time);
          if (segment && !isBass && beat.chord?.text)
            writtenChords.set(segment.start, beat.chord.text);
          if (segment && !beat.rest) {
            (beat.notes ?? [])
              .filter((note) => !note.rest && !note.dead && tuning[note.string] !== undefined)
              .forEach((note) => {
                const pc = (tuning[note.string] + note.fret + capo) % 12;
                // the bass counts for the root, and a little for the harmony
                segment.weights[pc] += isBass ? length * 0.5 : length;
                if (isBass) segment.bass[pc] += length;
                totalWeights[pc] += length;
              });
          }
          time += length;
        });
      });
    });
  });

  // section markers (Intro, Verse 1, Chorus...) and when they start
  const markers = main.measures
    .map((measure, m) => {
      const text = typeof measure.marker === 'string' ? measure.marker : measure.marker?.text;
      return text ? { name: text.trim(), time: measureStarts[m] } : null;
    })
    .filter((marker): marker is { name: string; time: number } => !!marker?.name);
  const sectionTimes = markers.map((marker) => marker.time);

  const key = findKey(totalWeights);
  const names = FLAT_MAJORS.includes(key.minor ? (key.tonic + 3) % 12 : key.tonic) ? FLATS : SHARPS;

  // a chord per part of a measure, the same chord in a row is held
  const chords: string[] = [];
  const beats: number[] = [];
  const chordStarts: number[] = [];
  segments.forEach((segment) => {
    const bassMax = Math.max(...segment.bass);
    const bass = bassMax > 0 ? segment.bass.indexOf(bassMax) : null;
    const found = findChord(segment.weights, bass, key);
    const name =
      writtenChords.get(segment.start) ?? (found ? `${names[found.root]}${found.quality}` : null);
    if (!name) {
      // silence: the chord before goes on (nothing before: the song has not started)
      if (beats.length) beats[beats.length - 1] += segment.length;
      return;
    }
    // the same chord goes on (but a new section starts on its own chord)
    const sectionStarts = sectionTimes.includes(segment.start);
    if (chords.length && chords[chords.length - 1] === name && !sectionStarts) {
      beats[beats.length - 1] += segment.length;
    } else {
      chords.push(name);
      beats.push(segment.length);
      chordStarts.push(segment.start);
    }
  });

  // sections: the first chord at or after each marker
  const sections = markers
    .map(({ name, time }) => ({ name, start: chordStarts.findIndex((t) => t >= time - 1e-6) }))
    // markers before the first chord all point to it: the last one names it
    .filter(
      (section, i, all) =>
        section.start >= 0 && !all.slice(i + 1).some((x) => x.start === section.start)
    );

  if (!chords.length) return { error: 'No chords found in this Songsterr song' };

  const firstSignature = main.measures.find((m) => m.signature)?.signature ?? [4, 4];
  const beatsPerBar = (firstSignature[0] * 4) / firstSignature[1];
  const tempo = tracks.flatMap((t) => t.automations?.tempo ?? [])[0]?.bpm;

  return {
    title: [song.title, song.artist].filter(Boolean).join(' by ') || 'Songsterr song',
    key: `${names[key.tonic]}${key.minor ? 'm' : ''}`,
    chords,
    beats: beats.map((b) => Math.round(b * 1000) / 1000),
    ...(beatsPerBar !== 4 && beatsPerBar > 0 ? { beatsPerBar } : {}),
    ...(tempo && tempo > 0 ? { bpm: Math.round(tempo) } : {}),
    url,
    ...(sections.length ? { sections } : {}),
  };
}
