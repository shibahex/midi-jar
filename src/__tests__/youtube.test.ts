import { findVideos, pickVideo, readPageData, toTrack, videoIdFromLink } from '../main/youtube';

jest.mock('electron', () => ({}));

const video = (videoId: string, title: string, channel: string, length = '3:45') => ({
  videoRenderer: {
    videoId,
    title: { runs: [{ text: title }] },
    ownerText: { runs: [{ text: channel }] },
    lengthText: { simpleText: length },
  },
});

describe('YouTube', () => {
  it('reads the id of a video from its link', () => {
    expect(videoIdFromLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s')).toBe(
      'dQw4w9WgXcQ'
    );
    expect(videoIdFromLink('https://www.youtube.com/watch?list=x&v=dQw4w9WgXcQ')).toBe(
      'dQw4w9WgXcQ'
    );
    expect(videoIdFromLink('youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(videoIdFromLink('https://music.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(videoIdFromLink('https://youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(videoIdFromLink('dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(videoIdFromLink('https://example.com/watch?v=dQw4w9WgXcQ')).toBeNull();
  });

  it('names a video as a song and its artist', () => {
    expect(
      toTrack('a', 'Radiohead - Creep (Official Music Video)', 'RadioheadVEVO', 1000)
    ).toMatchObject({ uri: 'youtube:a', name: 'Creep', artists: 'Radiohead', durationMs: 1000 });
    expect(toTrack('a', 'Creep', 'Radiohead - Topic', 1000)).toMatchObject({
      name: 'Creep',
      artists: 'Radiohead',
    });
  });

  it('reads the data of a page, braces in strings too', () => {
    const page = `<script>var ytInitialData = {"a":{"b":"x}{\\"y"},"c":[1]};</script>`;
    expect(readPageData(page, 'ytInitialData')).toEqual({ a: { b: 'x}{"y' }, c: [1] });
    expect(readPageData('nothing', 'ytInitialData')).toBeNull();
  });

  it('picks the studio recording, the audio alone first', () => {
    const videos = findVideos({
      contents: [
        { section: [video('live1234567', 'Radiohead - Creep (Live at Glastonbury)', 'fan')] },
        { section: [video('video123456', 'Radiohead - Creep (Official Music Video)', 'Vevo')] },
        { section: [video('audio123456', 'Creep', 'Radiohead - Topic')] },
        { playlistRenderer: { playlistId: 'p' } },
      ],
    });
    expect(videos.map((v) => v.videoId)).toEqual(['live1234567', 'video123456', 'audio123456']);
    expect(pickVideo('creep radiohead', videos)?.videoId).toBe('audio123456');
    expect(pickVideo('creep live radiohead', videos.slice(0, 2))?.videoId).toBe('live1234567');
  });
});
