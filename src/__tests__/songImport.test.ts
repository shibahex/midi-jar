import { ImportedSong, SpotifyTrack } from '../main/types';
import { findSongByName, findSongForTrack } from '../renderer/helpers/songImport';

const song = (id: string, title: string, spotify?: ImportedSong['spotify']): ImportedSong => ({
  id,
  title,
  key: 'Bm',
  chords: ['Bm'],
  spotify,
});

const track = (uri: string, name: string, artists: string, durationMs = 222000): SpotifyTrack => ({
  uri,
  name,
  artists,
  durationMs,
});

describe('following Spotify', () => {
  const songs = [
    song('a', 'Petal Dance (AI) by Gingerbee'),
    song('b', 'Honey', { uri: 'spotify:track:honey', name: 'Honey (gingerbee)' }),
    song('c', 'Petal Dance by Someone Else'),
  ];

  it('finds the linked song', () => {
    expect(findSongForTrack(songs, track('spotify:track:honey', 'Honey', 'gingerbee'))?.id).toBe(
      'b'
    );
  });

  it('finds a song by its name and artist, whatever the brackets and versions', () => {
    expect(findSongForTrack(songs, track('x', 'Petal Dance', 'gingerbee'))?.id).toBe('a');
    expect(findSongForTrack(songs, track('x', 'Petal Dance - Remastered', 'Gingerbee'))?.id).toBe(
      'a'
    );
  });

  it('finds nothing for another song', () => {
    expect(findSongForTrack(songs, track('x', 'Say the Rest', 'gingerbee'))).toBeUndefined();
    expect(findSongForTrack(songs, track('x', 'Petal Dance', 'Nobody'))).toBeUndefined();
  });
});

describe('a song by its name', () => {
  const songs = [
    song('a', 'Creep by Radiohead'),
    song('b', 'Creep by Stone Temple Pilots'),
    song('c', 'Karma Police'),
  ];

  it('finds the song typed, its artist too', () => {
    expect(findSongByName(songs, 'karma police')?.id).toBe('c');
    expect(findSongByName(songs, 'Creep Stone Temple Pilots')?.id).toBe('b');
    expect(findSongByName(songs, 'creep')?.id).toBe('a');
    expect(findSongByName(songs, 'Paranoid Android')).toBeNull();
  });
});
