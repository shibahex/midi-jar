import { MediaSession } from '../main/mediaSessions';
import { spotifyUriOf } from '../main/spotifyApp';

jest.mock('electron', () => ({}));

const session = (extra: Partial<MediaSession>): MediaSession => ({
  id: 'org.mpris.MediaPlayer2.spotify',
  app: 'spotify',
  title: 'Song',
  artist: 'Artist',
  isPlaying: true,
  positionMs: 0,
  measuredAt: 0,
  durationMs: 1000,
  volume: null,
  ...extra,
});

describe('the Spotify app', () => {
  it('tells which track it plays', () => {
    const id = '5virQ76YRtXR9oTNNSTwcO';
    // the official app: in its track id
    expect(spotifyUriOf(session({ trackId: `/com/spotify/track/${id}` }))).toBe(
      `spotify:track:${id}`
    );
    // other apps: its link, or the link written in hexadecimal
    expect(spotifyUriOf(session({ url: `https://open.spotify.com/track/${id}` }))).toBe(
      `spotify:track:${id}`
    );
    const hex = Buffer.from(`spotify:track:${id}`).toString('hex');
    expect(spotifyUriOf(session({ trackId: `/spotifast/Track/t${hex}` }))).toBe(
      `spotify:track:${id}`
    );
    expect(spotifyUriOf(session({ trackId: '/org/mpris/MediaPlayer2/TrackList/NoTrack' }))).toBe(
      null
    );
  });
});
