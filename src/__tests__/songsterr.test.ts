import { songFromSongsterr, SongsterrSong, SongsterrTrack } from '../renderer/helpers/songsterr';

// standard tuning, the high string first (as Songsterr writes it)
const TUNING = [64, 59, 55, 50, 45, 40];

const song: SongsterrSong = {
  songId: 1,
  revisionId: 1,
  image: 'image',
  title: 'Song',
  artist: 'Band',
  tracks: [],
};

/**
 * A bar of a guitar letting a chord ring: a dotted half (written 3/4, with its dot), then two
 * eighths leading into the next bar
 */
const ringing: SongsterrTrack = {
  tuning: TUNING,
  measures: [0, 1].map(() => ({
    signature: [4, 4] as [number, number],
    voices: [
      {
        beats: [
          {
            duration: [3, 4] as [number, number],
            dots: 1,
            notes: [{ string: 3, fret: 16 }],
            chord: { text: 'B' },
          },
          { duration: [1, 8] as [number, number], notes: [{ string: 1, fret: 12 }] },
          { duration: [1, 8] as [number, number], notes: [{ string: 2, fret: 15 }] },
        ],
      },
    ],
  })),
};

describe('Songsterr songs', () => {
  it('reads a dotted note at the length it is written', () => {
    const result = songFromSongsterr(
      song,
      [
        { role: 'rhythm', name: 'Rhythm', track: ringing },
        { role: 'other', name: 'Jeff Hellis', track: ringing },
      ],
      'https://www.songsterr.com/a/wsa/song-tab-s1'
    );
    if ('error' in result) throw new Error(result.error);
    const part = result.parts?.find((p) => p.name === 'Jeff Hellis');
    const starts = (part?.notes ?? []).filter((_, i) => i % 4 === 0);
    // F#4 on the first beat, B4 and A#4 on the 4th beat and after it (not in the next bar)
    expect(starts).toEqual([0, 3, 3.5, 4, 7, 7.5]);
  });

  it('finds no chord where only a riff is played, and keeps the chord over a short rest', () => {
    // D major strummed (D3 A3 D4 F#4), and single notes (A4 then B4, one at a time)
    const strum = (duration: [number, number]) => ({
      duration,
      notes: [
        { string: 3, fret: 0 },
        { string: 2, fret: 2 },
        { string: 1, fret: 3 },
        { string: 0, fret: 2 },
      ],
    });
    const riff = [5, 7, 5, 7].map((fret) => ({
      duration: [1, 4] as [number, number],
      notes: [{ string: 0, fret }],
    }));
    const bar = (beats: object[]) => ({
      signature: [4, 4] as [number, number],
      voices: [{ beats }],
    });
    const track = {
      tuning: TUNING,
      measures: [
        bar([strum([1, 1])]),
        bar([strum([1, 1])]),
        bar(riff),
        bar(riff),
        bar([strum([1, 2]), { duration: [1, 2], rest: true }]),
      ],
    } as SongsterrTrack;
    const result = songFromSongsterr(
      song,
      [{ role: 'rhythm', name: 'Rhythm', track }],
      'https://www.songsterr.com/a/wsa/song-tab-s1'
    );
    if ('error' in result) throw new Error(result.error);
    expect(result.chords).toEqual(['D', 'N.C.', 'D']);
    // (no chord names in the tab: guessed, and told)
    expect(result.chordsGuessed).toBe(true);
    expect(result.beats).toEqual([8, 8, 4]);
  });

  it('does not take a note ringing long for a chord of its own', () => {
    // G and D together, then a C# ringing (a color of G): G, not C#
    const bar = {
      signature: [4, 4] as [number, number],
      voices: [
        {
          beats: [0, 1].flatMap(() => [
            {
              duration: [1, 8] as [number, number],
              notes: [
                { string: 2, fret: 0 },
                { string: 1, fret: 3 },
              ],
            },
            { duration: [3, 8] as [number, number], notes: [{ string: 1, fret: 2 }] },
          ]),
        },
      ],
    };
    const track = { tuning: TUNING, measures: [bar, bar] } as SongsterrTrack;
    const result = songFromSongsterr(
      song,
      [{ role: 'rhythm', name: 'Rhythm', track }],
      'https://www.songsterr.com/a/wsa/song-tab-s1'
    );
    if ('error' in result) throw new Error(result.error);
    expect(result.chords).toEqual(['G']);
  });
});
