import { shell } from 'electron';

import { BrowserTab, controlTab, listTabs } from './browserTabs';
import {
  listSessions,
  MediaSession,
  pauseSession,
  playSession,
  seekSession,
  setSessionVolume,
} from './mediaSessions';

import { SpotifyPlayer, SpotifyTrack } from './types/Spotify';

/**
 * YouTube: a video plays in the user's own browser, followed and controlled like Spotify through
 * MIDI Jar's browser extension (every tab), else what browsers tell the system about the media
 * they play (MPRIS on Linux, the media controls on Windows: one video per browser). No login.
 * A video's link is "youtube:<id>", next to Spotify's "spotify:track:<id>" ("youtube:?<title>"
 * when only its title is known: browsers do not tell which video it is).
 */

export const YOUTUBE_PREFIX = 'youtube:';
export const isYouTubeUri = (uri: string) => uri.startsWith(YOUTUBE_PREFIX);
const videoIdOf = (uri: string) => uri.slice(YOUTUBE_PREFIX.length);

const ORIGIN = 'https://www.youtube.com';
/** YouTube's cookie consent, answered (else Europe gets a consent page instead of the video) */
const CONSENT_COOKIE = 'SOCS=CAI; CONSENT=YES+';
const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36';

/** Browsers (their process): other media players (Spotify, this game itself) are not followed */
export const BROWSER =
  /chrom(e|ium)|firefox|librewolf|brave|vivaldi|opera|edge|floorp|waterfox|thorium|\bzen\b/i;

/** How long a video opened in the browser is given to start playing (ms) */
const OPEN_MS = 20000;

/** A channel's name as an artist: "Artist - Topic", "ArtistVEVO" */
const artistOf = (channel: string) =>
  channel
    .replace(/\s*-\s*Topic$/i, '')
    .replace(/VEVO$/, '')
    .trim();

/**
 * A video as a track: "Artist - Song (Official Video)" is the song by the artist, else the
 * title by the channel
 */
export function toTrack(id: string, title: string, channel: string, durationMs: number) {
  const [artist, ...rest] = title.split(/\s+[-–—]\s+/);
  const named = rest.length > 0 && !!artist;
  const track: SpotifyTrack = {
    // (a video whose id is not known: its title)
    uri: id ? `${YOUTUBE_PREFIX}${id}` : `${YOUTUBE_PREFIX}?${title}`,
    name: (named ? rest.join(' - ') : title)
      .replace(
        /\s*[([][^)\]]*\b(official|video|audio|lyrics?|visuali[sz]er|hd|4k)\b[^)\]]*[)\]]/gi,
        ''
      )
      .trim(),
    artists: named ? artist.trim() : artistOf(channel),
    durationMs,
    imageUrl: id ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : undefined,
  };
  return track;
}

/** Videos seen (searched, linked): their id, from their name (browsers only tell the name) */
const knownVideos = new Map<string, SpotifyTrack>();
const keyOf = (track: { name: string; artists: string }) =>
  `${track.name} (${track.artists})`.toLowerCase();
/** The same video (only its name is known: "youtube:?<title>", whatever the channel) */
const isSame = (track: SpotifyTrack, other: SpotifyTrack | null) =>
  !!other &&
  (keyOf(track) === keyOf(other) ||
    (!other.artists && track.name.toLowerCase() === other.name.toLowerCase()));
const remember = (track: SpotifyTrack) => {
  knownVideos.set(keyOf(track), track);
  return track;
};

/* READING YOUTUBE'S PAGES */

/** The JSON object that starts at a place in a page (YouTube's data in its scripts) */
function readObjectAt(text: string, start: number) {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (char === '\\') i += 1;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return JSON.parse(text.slice(start, i + 1));
    }
  }
  return null;
}

/** The data a page gives to its scripts ("var ytInitialData = {...}"), or null */
export function readPageData(page: string, name: string) {
  const at = page.indexOf(`${name} = {`);
  if (at < 0) return null;
  try {
    return readObjectAt(page, page.indexOf('{', at));
  } catch (e) {
    return null;
  }
}

async function fetchPage(url: string) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept-Language': 'en',
      Cookie: CONSENT_COOKIE,
    },
  });
  if (!response.ok) throw new Error(`YouTube could not be reached (error ${response.status})`);
  return response.text();
}

/** "3:45" or "1:02:03": ms */
const lengthMs = (text: string) =>
  text.split(':').reduce((total, part) => total * 60 + Number(part), 0) * 1000;

type VideoRenderer = {
  videoId: string;
  title?: { runs?: { text: string }[] };
  ownerText?: { runs?: { text: string }[] };
  lengthText?: { simpleText?: string };
};

/** Every video of search results (they are nested deep in sections) */
export function findVideos(data: unknown, found: VideoRenderer[] = []) {
  if (Array.isArray(data)) data.forEach((item) => findVideos(item, found));
  else if (data && typeof data === 'object') {
    const object = data as Record<string, unknown>;
    const video = object.videoRenderer as VideoRenderer | undefined;
    if (video?.videoId && video.lengthText?.simpleText) found.push(video);
    else Object.values(object).forEach((value) => findVideos(value, found));
  }
  return found;
}

/** Words of versions other than the studio one (unless the song asked for is one of them) */
const OTHER_VERSIONS =
  /\b(live|acoustic|remix|demo|instrumental|karaoke|cover|session|unplugged|sped up|slowed|reverb|tutorial|lesson|reaction|backing track)\b/i;

/**
 * The studio recording of a song: its name first, then not a live (or covered...) version,
 * then the audio alone ("Official Audio", an artist's "- Topic" channel: no intro of a music
 * video before the song), in YouTube's order
 */
export function pickVideo(query: string, videos: VideoRenderer[]) {
  const words = query.toLowerCase();
  const wantsOther = OTHER_VERSIONS.test(query);
  const score = (video: VideoRenderer, index: number) => {
    const title = video.title?.runs?.map((part) => part.text).join('') ?? '';
    const channel = video.ownerText?.runs?.[0]?.text ?? '';
    // (without what is between brackets: "(Live at...)")
    const name = toTrack(video.videoId, title, channel, 0)
      .name.toLowerCase()
      .replace(/\s*[([].*$/, '');
    const audioOnly = /official audio|\(audio\)/i.test(title) || /-\s*topic$/i.test(channel);
    return (
      (name && words.includes(name) ? 1000 : 0) -
      (!wantsOther && OTHER_VERSIONS.test(title) ? 500 : 0) +
      (audioOnly ? 200 : 0) -
      index * 10
    );
  };
  const scored = videos.map((video, index) => ({
    video,
    value: score(video, index),
  }));
  return scored.reduce((a, b) => (b.value > a.value ? b : a), scored[0])?.video;
}

/** The best video for a song name, or null */
export async function search(query: string): Promise<SpotifyTrack | null> {
  // (videos only: no playlists or channels)
  const page = await fetchPage(
    `${ORIGIN}/results?sp=EgIQAQ%253D%253D&search_query=${encodeURIComponent(query)}`
  );
  const video = pickVideo(query, findVideos(readPageData(page, 'ytInitialData')).slice(0, 10));
  if (!video) return null;
  return remember(
    toTrack(
      video.videoId,
      video.title?.runs?.map((part) => part.text).join('') ?? '',
      video.ownerText?.runs?.[0]?.text ?? '',
      lengthMs(video.lengthText?.simpleText ?? '0')
    )
  );
}

/** The id of a video from its link (youtube.com/watch?v=, youtu.be/, shorts, YouTube Music) */
export function videoIdFromLink(link: string) {
  const text = link.trim();
  if (/^[\w-]{11}$/.test(text)) return text;
  const match = text.match(
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/i
  );
  return match?.[1] ?? null;
}

/** A video from its link: its name and length, from its page */
export async function getVideo(link: string): Promise<SpotifyTrack> {
  const id = videoIdFromLink(link);
  if (!id) throw new Error('Not a YouTube link');
  const page = await fetchPage(`${ORIGIN}/watch?v=${id}`);
  const details = readPageData(page, 'ytInitialPlayerResponse')?.videoDetails;
  if (!details?.lengthSeconds) throw new Error('YouTube did not give this video');
  return remember(
    toTrack(id, details.title ?? '', details.author ?? '', Number(details.lengthSeconds) * 1000)
  );
}

/*
 * THE BROWSER'S PLAYER: every YouTube tab when MIDI Jar's extension is in the browser, else the
 * media the system knows (MPRIS on Linux, media controls on Windows: one per browser)
 */

/** A browser (Firefox's id on Windows is a code of 16 letters and digits) */
const isBrowser = (app: string) => BROWSER.test(app) || /^[0-9A-F]{16}$/i.test(app);

/** What a browser (or one of its tabs) plays, the video as a track, and how to control it */
type BrowserMedia = {
  /** the tab, or the browser */
  key: string;
  isPlaying: boolean;
  positionMs: number;
  measuredAt: number;
  volume: number | null;
  track: SpotifyTrack;
  play: () => Promise<unknown>;
  pause: () => Promise<unknown>;
  seek: (ms: number) => Promise<unknown>;
  setVolume: (percent: number) => Promise<unknown>;
};

const fromTab = (tab: BrowserTab): BrowserMedia => ({
  key: `tab:${tab.key}`,
  isPlaying: tab.playing,
  positionMs: tab.positionMs,
  measuredAt: tab.at,
  volume: null,
  track: remember(toTrack(tab.id, tab.title, tab.channel, tab.durationMs)),
  play: async () => controlTab(tab.key, 'play'),
  pause: async () => controlTab(tab.key, 'pause'),
  seek: async (ms) => controlTab(tab.key, 'seek', ms),
  setVolume: async () => undefined,
});

function fromSession(session: MediaSession): BrowserMedia {
  const seen = toTrack('', session.title, session.artist, session.durationMs);
  const known = knownVideos.get(keyOf(seen));
  return {
    key: session.id,
    isPlaying: session.isPlaying,
    positionMs: session.positionMs,
    measuredAt: session.measuredAt,
    volume: session.volume,
    track: known ? { ...known, durationMs: session.durationMs || known.durationMs } : seen,
    play: () => playSession(session),
    pause: () => pauseSession(session),
    seek: async (ms) => {
      // (its track now: MPRIS moves in the track it plays)
      const now = (await listSessions()).find((each) => each.id === session.id);
      return seekSession(now ?? session, ms);
    },
    setVolume: (percent) => setSessionVolume(session, percent),
  };
}

/**
 * What the browsers play: every tab the extension tells, and what the system tells (the same
 * video once: from the extension)
 */
async function readBrowsers(): Promise<BrowserMedia[]> {
  const tabs = listTabs().map(fromTab);
  const sessions = await listSessions().catch((e) => {
    if (tabs.length) return [] as MediaSession[];
    throw e;
  });
  const others = sessions
    .filter((session) => isBrowser(session.app))
    .map(fromSession)
    .filter((media) => !tabs.some((tab) => isSame(tab.track, media.track)));
  return [...tabs, ...others];
}

/** The video the game plays (its name), and the browser (or tab) playing it */
let wanted: SpotifyTrack | null = null;
let lastKey = '';

/** The media to follow: the video wanted, else the one playing, else any */
const pick = (all: BrowserMedia[]) =>
  all.find((media) => media.track.uri === wanted?.uri) ||
  all.find((media) => isSame(media.track, wanted)) ||
  all.find((media) => media.isPlaying) ||
  all[0] ||
  null;

const toPlayer = (media: BrowserMedia): SpotifyPlayer => ({
  isPlaying: media.isPlaying,
  progressMs: media.positionMs,
  measuredAt: media.measuredAt,
  volumePercent: media.volume,
  track: media.track,
});

/** What the browser plays now, or null */
export async function getPlayer(): Promise<SpotifyPlayer | null> {
  const media = pick(await readBrowsers());
  if (!media) return null;
  lastKey = media.key;
  return toPlayer(media);
}

const wait = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Plays a video from a position (ms) in the browser playing it. When no browser has it, it is
 * opened there (a tab of the browser already open), at that position.
 */
export async function play(uri: string, positionMs: number) {
  const id = videoIdOf(uri);
  const isId = /^[\w-]{11}$/.test(id);
  const seen = [...knownVideos.values()].find((track) => track.uri === uri);
  wanted = isId
    ? seen ?? (await getVideo(id).catch(() => null))
    : toTrack('', id.replace(/^\?/, ''), '', 0);
  const has = (media: BrowserMedia | null): media is BrowserMedia =>
    !!media && (media.track.uri === uri || isSame(media.track, wanted));
  const find = async () => pick(await readBrowsers());
  let media = await find();
  if (!has(media)) {
    if (!isId) throw new Error('Play the video in your browser, the game follows');
    await shell.openExternal(
      `${ORIGIN}/watch?v=${id}&t=${Math.floor(Math.max(0, positionMs) / 1000)}s`
    );
    const until = Date.now() + OPEN_MS;
    do {
      // eslint-disable-next-line no-await-in-loop
      await wait(500);
      // eslint-disable-next-line no-await-in-loop
      media = await find();
    } while (Date.now() < until && !has(media));
    if (!has(media)) {
      throw new Error('The browser did not play the video: play it there, the game follows');
    }
  }
  lastKey = media.key;
  await media.seek(positionMs);
  await media.play();
}

/** The browser (or tab) followed: the one last seen playing the video */
async function followed() {
  const all = await readBrowsers();
  return all.find((media) => media.key === lastKey) ?? pick(all);
}

/** Everything the browsers play: every tab with the extension (else one per browser) */
export async function listPlayers(): Promise<SpotifyPlayer[]> {
  return (await readBrowsers()).map(toPlayer);
}

/** Follows this video (picked among a few): the game asks where it is from now on */
export async function select(uri: string) {
  const all = await readBrowsers();
  const media =
    all.find((each) => each.track.uri === uri) ??
    all.find((each) => isSame(each.track, toTrack('', videoIdOf(uri).replace(/^\?/, ''), '', 0)));
  if (!media) return;
  wanted = media.track;
  lastKey = media.key;
}

/**
 * Pauses or plays the followed video again (to tell its sound from other tabs): false when
 * nothing is followed
 */
export async function setFollowedPlaying(playing: boolean) {
  const media = await followed();
  if (!media) return false;
  await (playing ? media.play() : media.pause());
  return true;
}

export async function pause() {
  const media = await followed();
  if (media) await media.pause().catch(() => {});
}

export async function seek(positionMs: number) {
  const media = await followed();
  if (media) await media.seek(positionMs);
}

/** The browser's volume (the extension, some browsers, and Windows do not change it) */
export async function setVolume(percent: number) {
  const media = await followed();
  if (media) await media.setVolume(percent);
}
