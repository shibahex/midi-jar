import { Chord, Note } from 'tonal';
import { Chord as TChord } from '@tonaljs/chord';

import { ImportedSong } from 'main/types';

import { formatSharpsFlats } from './note';
import { getProgressionChords, parseProgression, ProgressionInfo } from './progressions';

const BEATS_PER_BAR = 4;

/**
 * Chords of public domain songs (and the 12-bar blues), for the rhythm game:
 * bars are separated by "|", chords of the same bar share it (one chord per bar without "|")
 */
export type SongInfo = {
  id: string;
  title: string;
  numerals: string;
  /** time signature: 3 for a waltz (3/4), 4 if not told */
  beatsPerBar?: number;
};

export const SONGS: SongInfo[] = [
  // two chords per bar
  { id: 'canon', title: "Pachelbel's Canon", numerals: 'I V | vi iii | IV I | IV V' },
  {
    id: 'rising-sun',
    title: 'House of the Rising Sun',
    numerals: 'i III IV VI i III V V i III IV VI i V i V',
    beatsPerBar: 3,
  },
  {
    id: 'greensleeves',
    title: 'Greensleeves',
    numerals: 'i VII VI V i VII V V III VII i V III VII V i',
    beatsPerBar: 3,
  },
  { id: 'blues', title: 'a 12-Bar Blues', numerals: 'I7 I7 I7 I7 IV7 IV7 I7 I7 V7 IV7 I7 V7' },
  {
    id: 'saints',
    title: 'When the Saints Go Marching In',
    numerals: 'I I I I I I V V I I7 IV IV I V I I',
  },
  {
    id: 'amazing-grace',
    title: 'Amazing Grace',
    numerals: 'I I IV I I I V V I I IV I I V I I',
    beatsPerBar: 3,
  },
];

/** Numerals of a song, and how many beats each chord lasts */
function readBars(song: SongInfo) {
  const beatsPerBar = song.beatsPerBar ?? BEATS_PER_BAR;
  const bars = song.numerals.includes('|')
    ? song.numerals.split('|').map((bar) => bar.trim().split(/\s+/).filter(Boolean))
    : song.numerals.split(/\s+/).map((numeral) => [numeral]);
  return bars
    .filter((bar) => bar.length)
    .flatMap((bar) => bar.map((numeral) => ({ numeral, beats: beatsPerBar / bar.length })));
}

/** The progression of a song (major or minor key) */
export const getSongProgression = (song: SongInfo) =>
  parseProgression(
    readBars(song)
      .map((b) => b.numeral)
      .join(' ')
  ).progression as ProgressionInfo;

/** Chords of a song in a key, with their length in beats */
export const getSongChords = (song: SongInfo, tonic: string) => {
  const bars = readBars(song);
  return getProgressionChords(getSongProgression(song), tonic).map((chord, i) => ({
    ...chord,
    beats: bars[i]?.beats,
  }));
};

/** A song of the game: built-in (numerals, any key) or imported (chords in their key) */
export type PlayableSong = { id: string; title: string } & (
  | { song: SongInfo; imported?: undefined }
  | { song?: undefined; imported: ImportedSong }
);

/** Every song of the game: built-in ones, then imported ones */
export const getAllSongs = (imported: ImportedSong[] = []): PlayableSong[] => [
  ...SONGS.map((song) => ({ id: song.id, title: song.title, song })),
  ...imported.map((song) => ({ id: song.id, title: song.title, imported: song })),
];

/**
 * Songs that are played: all of them but the excluded ones
 * (all the built-in ones if every song is excluded)
 */
export const getIncludedSongs = (excluded: string[] = [], imported: ImportedSong[] = []) => {
  const included = getAllSongs(imported).filter((s) => !excluded.includes(s.id));
  return included.length ? included : getAllSongs();
};

/** Imported songs */

// numerals of each root, in semitones from the key tonic
const ROMAN = ['I', '♭II', 'II', '♭III', 'III', 'IV', '♯IV', 'V', '♭VI', 'VI', '♭VII', 'VII'];
// in a minor key, III, VI and VII are those of the minor scale (like the built-in progressions)
const MINOR_ROMAN = ['I', '♭II', 'II', 'III', '♯III', 'IV', '♯IV', 'V', 'VI', '♯VI', 'VII', '♯VII'];

const normalize = (name: string) =>
  name.replace(/♯/g, '#').replace(/♭/g, 'b').replace(/[()]/g, '').trim();

/** A chord name as written in chord sheets ("Am7", "F#m", "C/E"...), or null */
export function readChordName(token: string): string | null {
  const name = normalize(token);
  if (!/^[A-G][#b]?/.test(name)) return null;
  // the bass of a slash chord is not needed to play the chord
  const [chord, bass, extra] = name.split('/');
  if (extra !== undefined || (bass !== undefined && !/^[A-G][#b]?$/.test(bass))) return null;
  return Chord.get(chord).empty ? null : chord;
}

/** Names of song sections: verse, chorus, bridge... (with a number or more words) */
const SECTION_NAME =
  /^(intro|verse|pre[- ]?chorus|chorus|post[- ]?chorus|bridge|outro|solo|interlude|refrain|hook|instrumental|breakdown|coda|ending|riff)\b/i;

/** Key of a song: from the file ("G", "Em"), or the first chord */
function readKey(key: string | undefined, chords: string[]) {
  const name = key ? readChordName(key) : chords[0];
  const chord = Chord.get(name ?? chords[0]);
  return `${chord.tonic ?? 'C'}${chord.quality === 'Minor' ? 'm' : ''}`;
}

/**
 * Reads a song from a ChordPro file ([Am] chords, {title: ...}, {key: ...}) or a chord sheet
 * (lines of chords above the lyrics, Ultimate Guitar [ch]Am[/ch] tags): one chord per bar
 */
export function parseChordSheet(
  text: string,
  fileName = 'Imported song'
): Omit<ImportedSong, 'id'> | { error: string } {
  const directive = (names: string) =>
    text.match(new RegExp(`\\{\\s*(?:${names})\\s*:\\s*([^}]*)\\}`, 'i'))?.[1]?.trim();

  // title: from ChordPro, or a short first line that is not chords, or the file name
  const firstLine = text
    .split(/\n/)
    .map((line) => line.trim())
    // skip info lines of chord sites ("Tuning: E A D G B E", "Capo: 2"...)
    .find((line) => line && !/^(tuning|capo|key|tempo|bpm|difficulty|author)\b/i.test(line));
  const firstLineIsTitle =
    !!firstLine &&
    firstLine.length <= 60 &&
    !/[[\]{}]/.test(firstLine) &&
    !firstLine.split(/\s+/).every((t) => readChordName(t));
  const fileTitle = fileName
    .replace(/\.[^.]+$/, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
  const title =
    directive('title|t') || (firstLineIsTitle ? firstLine : '') || fileTitle || 'Imported song';

  // Ultimate Guitar tags work like ChordPro brackets, ChordPro sections become labels
  const body = text
    .replace(/\[ch\]([^[]*)\[\/ch\]/gi, '[$1]')
    .replace(/\[\/?tab\]/gi, '')
    .replace(
      /\{\s*(?:start_of_|so)(verse|chorus|bridge|v|c|b)\s*(?::\s*([^}]*))?\}/gi,
      (_, kind, label) => {
        const name = { v: 'verse', c: 'chorus', b: 'bridge' }[kind.toLowerCase() as 'v'] ?? kind;
        return `[${(label || name).trim()}]`;
      }
    )
    .replace(/\{\s*(?:comment|c|comment_italic|ci)\s*:\s*([^}]*)\}/gi, (_, label) =>
      SECTION_NAME.test(label.trim()) ? `[${label.trim()}]` : ''
    )
    .replace(/\{[^}]*\}/g, '');

  // sections (verse, chorus...): their name and the index of their first chord
  const sections: { name: string; start: number }[] = [];
  const addSection = (name: string, start: number) => {
    // a section with no chord yet is renamed by the next one
    if (sections.length && sections[sections.length - 1].start === start) sections.pop();
    sections.push({ name, start });
  };

  // ChordPro: chords in brackets (section names like [Verse] are not chords)
  const chords: string[] = [];
  [...body.matchAll(/\[([^\]]+)\]/g)].forEach((m) => {
    const chord = readChordName(m[1]);
    if (chord) chords.push(chord);
    else if (SECTION_NAME.test(m[1].trim())) addSection(m[1].trim(), chords.length);
  });

  // time signature ({time: 3/4}, 6/8 is counted in 2) and tempo ({tempo: 120})
  const [top, bottom] = (directive('time') ?? '').split('/').map(Number);
  let beatsPerBar: number | undefined;
  if (top > 0 && top <= 12) beatsPerBar = bottom === 8 && top % 3 === 0 ? top / 3 : top;
  const bpm = Math.round(Number(directive('tempo') ?? ''));
  const barBeats = beatsPerBar ?? BEATS_PER_BAR;

  // chord sheet: lines made only of chords (repeats allowed), with bar lines "|" telling
  // how long the chords last ("| C G | Am |": C and G share a bar), "%" repeats a bar
  let beats: number[] = [];
  const bars = { found: false };
  if (!chords.length) {
    const isMark = (t: string) => /^(-+|x\d+|\d+x|\/|\.+)$/i.test(t);
    body.split(/\n/).forEach((line) => {
      // a section label line: "[Chorus]", "Verse 2:"
      const label = line
        .trim()
        .replace(/^\[|\]$|:$/g, '')
        .trim();
      if (label && SECTION_NAME.test(label) && label.length < 30) {
        addSection(label, chords.length);
        return;
      }
      const tokens = line.split(/[\s|]+/).filter((t) => t && !isMark(t) && t !== '%');
      if (!tokens.length || !tokens.every((t) => readChordName(t))) return;
      if (!line.includes('|')) {
        tokens.forEach((t) => {
          chords.push(readChordName(t) as string);
          beats.push(barBeats);
        });
        return;
      }
      bars.found = true;
      let previous: string[] = [];
      line.split('|').forEach((bar) => {
        const barTokens = bar.split(/\s+/).filter((t) => t && !isMark(t));
        const names = barTokens.includes('%')
          ? previous
          : barTokens.map((t) => readChordName(t) as string);
        names.forEach((name) => {
          chords.push(name);
          beats.push(barBeats / names.length);
        });
        if (names.length) previous = names;
      });
    });
  }
  if (!bars.found) beats = [];

  if (!chords.length) {
    return /\.pdf$/i.test(fileName)
      ? { error: 'PDF files cannot be read: import the song from its web address instead' }
      : { error: 'No chords found in this file' };
  }
  return {
    title,
    key: readKey(directive('key'), chords),
    chords,
    ...(beats.length ? { beats } : {}),
    ...(beatsPerBar ? { beatsPerBar } : {}),
    ...(bpm > 0 ? { bpm } : {}),
    ...(sections.length > 1 ? { sections: sections.filter((x) => x.start < chords.length) } : {}),
  };
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** Text of HTML entities ("&quot;", "&#39;"...) */
const decodeEntities = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    if (code[0] !== '#') return ENTITIES[code.toLowerCase()] ?? entity;
    const value =
      code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
    return Number.isNaN(value) ? entity : String.fromCodePoint(value);
  });

/** Text of a piece of HTML: line breaks kept, tags removed */
const htmlToText = (html: string) =>
  decodeEntities(
    html
      .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h\d)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  );

type UltimateGuitarPage = {
  store?: {
    page?: {
      data?: {
        tab?: { song_name?: string; artist_name?: string; tonality_name?: string };
        tab_view?: {
          wiki_tab?: { content?: string };
          strummings?: { bpm?: number; denuminator?: number; measures?: { measure?: number }[] }[];
        };
      };
    };
  };
};

/** Song of an Ultimate Guitar page: its chords are in the data of the page */
function readUltimateGuitarPage(
  html: string
):
  | { content: string; title: string; bpm?: number; beatsPerHit?: number }
  | { error: string }
  | null {
  const store = html.match(/class="js-store"\s+data-content="([^"]*)"/)?.[1];
  if (!store) return null;
  try {
    const { data } = (JSON.parse(decodeEntities(store)) as UltimateGuitarPage).store?.page ?? {};
    const content = data?.tab_view?.wiki_tab?.content;
    if (!content)
      return { error: 'No chords on this page (tabs and Pro pages cannot be imported)' };
    const { song_name: song, artist_name: artist, tonality_name: key } = data?.tab ?? {};
    const title = [song, artist].filter(Boolean).join(' by ');

    // strumming: the tempo, and on how many beats of a bar the chord is strummed
    const strumming = data?.tab_view?.strummings?.[0];
    const slotsPerBeat = Math.max(1, (strumming?.denuminator ?? 8) / 4);
    const strummedBeats = new Set(
      (strumming?.measures ?? [])
        .slice(0, 4 * slotsPerBeat)
        .map((m, i) => (m.measure ? Math.floor(i / slotsPerBeat) : -1))
        .filter((beat) => beat >= 0)
    ).size;
    let beatsPerHit: number | undefined;
    if (strummedBeats >= 4) beatsPerHit = 1;
    else if (strummedBeats >= 2) beatsPerHit = 2;

    return {
      content: key ? `{key: ${key}}\n${content}` : content,
      title,
      ...(strumming?.bpm && { bpm: Math.round(strumming.bpm) }),
      ...(beatsPerHit && { beatsPerHit }),
    };
  } catch (e) {
    return null;
  }
}

/**
 * Reads a song from a web page: Ultimate Guitar chords, or any page with a chord sheet
 * (chords above the lyrics, ChordPro)
 */
export function parseSongPage(
  html: string,
  url: string
): Omit<ImportedSong, 'id'> | { error: string } {
  const ultimateGuitar = readUltimateGuitarPage(html);
  if (ultimateGuitar && 'error' in ultimateGuitar) return ultimateGuitar;
  const page = ultimateGuitar && 'content' in ultimateGuitar ? ultimateGuitar : null;

  // chord sites mostly put chord sheets in <pre> blocks
  const blocks = [...html.matchAll(/<pre[^>]*>([\s\S]*?)<\/pre>/gi)].map((m) => htmlToText(m[1]));
  const content = page?.content ?? (blocks.length ? blocks.join('\n') : htmlToText(html));

  const pageTitle = htmlToText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '')
    .replace(/\s*[|@–—-]\s*[^|@–—-]*$/, '')
    .trim();
  const urlName = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() ?? '');

  const song = parseChordSheet(content, urlName || 'Imported song');
  if ('error' in song) return { error: 'No chords found on this page' };
  const title = page?.title || (/\{\s*(title|t)\s*:/i.test(content) ? '' : pageTitle);
  return {
    ...song,
    ...(title && { title }),
    ...(page?.bpm && !song.bpm && { bpm: page.bpm }),
    ...(page?.beatsPerHit && { beatsPerHit: page.beatsPerHit }),
  };
}

/** Chords of an imported song, with their numeral in the key of the song and their length */
export function getImportedSongChords(song: ImportedSong) {
  const key = Chord.get(song.key);
  const tonic = key.tonic ?? 'C';
  const romans = key.quality === 'Minor' ? MINOR_ROMAN : ROMAN;
  return song.chords.map((name, i) => {
    const chord = Chord.get(name) as TChord;
    // no chord played there ("N.C.")
    if (!chord.tonic) return { numeral: '', name, chord, beats: song.beats?.[i] };
    const root = chord.tonic;
    const semitones = ((Note.chroma(root) ?? 0) - (Note.chroma(tonic) ?? 0) + 12) % 12;
    const minor = chord.quality === 'Minor' || chord.quality === 'Diminished';
    const numeral = minor ? romans[semitones].toLowerCase() : romans[semitones];
    // what comes after the root, without the "m" already told by the lowercase numeral
    const suffix = name.slice(root.length).replace(/^m(?!aj)/, '');
    return {
      numeral: `${numeral}${suffix}`,
      name: formatSharpsFlats(name),
      chord,
      beats: song.beats?.[i],
    };
  });
}

/** Key of an imported song, e.g. "G major" or "E minor" */
export const getImportedSongKey = (song: ImportedSong) => {
  const key = Chord.get(song.key);
  return `${formatSharpsFlats(key.tonic ?? 'C')} ${key.quality === 'Minor' ? 'minor' : 'major'}`;
};

/** Rhythm of a song: its time signature, tempo, and its own pattern (from the strumming) */
export const getSongRhythm = (song: PlayableSong) => ({
  beatsPerBar: song.imported?.beatsPerBar ?? song.song?.beatsPerBar,
  beatsPerHit: song.imported?.beatsPerHit,
  bpm: song.imported?.bpm,
  leadIn: song.imported?.leadIn,
});
