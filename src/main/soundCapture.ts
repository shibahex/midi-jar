import { ChildProcess, execFile, spawn } from 'child_process';
import { desktopCapturer, session, WebContents } from 'electron';

import { BROWSER, isYouTubeUri, setFollowedPlaying } from './youtube';
import { SPOTIFY_APP as SPOTIFY_APP_NAME } from './spotifyApp';

/**
 * The sound played by the computer (Linux: PipeWire or PulseAudio), sent to the page that
 * asked for it: to listen to a song playing on Spotify and sync with it.
 * Browsers do not list it as a sound input, so a recording tool is used.
 * With PipeWire, Spotify alone is recorded when it can be: the game's own sound (and any
 * other app) is then not heard, and the song can be listened to all along. A YouTube video is
 * heard the same way: the browser playing it alone.
 */

export const CAPTURE_RATE = 22050;

const COMMANDS: [string, string[]][] = [
  [
    'pw-record',
    [
      '-P',
      '{ stream.capture.sink=true }',
      '--rate',
      String(CAPTURE_RATE),
      '--channels',
      '1',
      '--format',
      'f32',
      '--raw',
      '-',
    ],
  ],
  [
    'parec',
    [
      '-d',
      '@DEFAULT_MONITOR@',
      `--rate=${CAPTURE_RATE}`,
      '--channels=1',
      '--format=float32le',
      '--raw',
    ],
  ],
];

let capture: { process: ChildProcess; sender: WebContents } | null = null;
// recording an app alone: it is recorded again when its stream comes back (a new one)
let following: { sender: WebContents; timer?: ReturnType<typeof setTimeout> } | null = null;

export function stopCapture() {
  if (following?.timer) clearTimeout(following.timer);
  following = null;
  capture?.process.kill();
  capture = null;
}

/**
 * An app heard alone: its name, and how its sound is told apart (the names of its streams it
 * is found in)
 */
type App = { name: string; pattern: RegExp; fields: string[] };

/** Apps playing Spotify (the official app, or other clients of it) */
const SPOTIFY_APP: App = {
  name: 'Spotify',
  pattern: SPOTIFY_APP_NAME,
  fields: ['application.name', 'application.process.binary', 'node.name'],
};
/**
 * Browsers playing YouTube: by their program only (this game's own sound is named "Chromium"
 * too, its program is not a browser)
 */
const BROWSER_APP: App = {
  name: 'The browser',
  pattern: BROWSER,
  fields: ['application.process.binary'],
};

/** The PipeWire streams of an app (their serials), the ones playing first */
function findStreams(app: App) {
  return new Promise<string[]>((resolve) => {
    execFile('pw-dump', { timeout: 3000, maxBuffer: 32 * 1024 * 1024 }, (error, stdout) => {
      if (error) {
        resolve([]);
        return;
      }
      try {
        type PwObject = {
          id: number;
          info?: { state?: string; props?: Record<string, string | number | undefined> };
        };
        const streams = (JSON.parse(stdout) as PwObject[]).filter((o) => {
          const props = o.info?.props ?? {};
          if (!String(props['media.class'] ?? '').startsWith('Stream/Output/Audio')) return false;
          return app.fields.some((field) => app.pattern.test(String(props[field] ?? '')));
        });
        const playing = (o: PwObject) => (o.info?.state === 'running' ? 0 : 1);
        resolve(
          [...streams]
            .sort((a, b) => playing(a) - playing(b))
            .map((o) => String(o.info?.props?.['object.serial'] ?? o.id))
        );
      } catch (e) {
        resolve([]);
      }
    });
  });
}

/** Sends the samples a recording tool gives to the page (32-bit floats, whole ones only) */
function sendSamples(child: ChildProcess, sender: WebContents) {
  let rest = Buffer.alloc(0);
  child.stdout?.on('data', (chunk: Buffer) => {
    if (sender.isDestroyed()) {
      stopCapture();
      return;
    }
    const data = Buffer.concat([rest, chunk]);
    const usable = data.length - (data.length % 4);
    rest = data.subarray(usable);
    const samples = new Float32Array(usable / 4);
    for (let i = 0; i < samples.length; i += 1) samples[i] = data.readFloatLE(i * 4);
    // the time the last sample was heard
    sender.send('app:sound:data', samples, Date.now());
  });
}

/** How long a stream is given to make a sound (it may be starting the song) */
const PROBE_MS = 3000;

/** Records a stream: resolves once it makes a sound (not silence), rejects when it does not */
function recordStream(serial: string, sender: WebContents) {
  const args = [
    '--target',
    serial,
    '--rate',
    String(CAPTURE_RATE),
    '--channels',
    '1',
    '--format',
    'f32',
    '--raw',
    '-',
  ];
  return new Promise<ChildProcess>((resolve, reject) => {
    const child = spawn('pw-record', args, { stdio: ['ignore', 'pipe', 'ignore'] });
    let sounding = false;
    const timeout = setTimeout(() => {
      if (sounding) return;
      child.kill();
      reject(new Error('no sound'));
    }, PROBE_MS);
    child.on('error', (e) => {
      clearTimeout(timeout);
      reject(e);
    });
    child.on('exit', (code) => {
      clearTimeout(timeout);
      if (!sounding) reject(new Error(`pw-record stopped (${code})`));
    });
    const probe = (chunk: Buffer) => {
      for (let i = 0; i + 4 <= chunk.length; i += 4) {
        if (Math.abs(chunk.readFloatLE(i)) > 1e-6) {
          sounding = true;
          clearTimeout(timeout);
          child.stdout?.off('data', probe);
          sendSamples(child, sender);
          resolve(child);
          return;
        }
      }
    };
    child.stdout?.on('data', probe);
  });
}

/** How loud streams are (RMS), recorded for a moment */
function loudness(serials: string[], ms: number) {
  return Promise.all(
    serials.map(
      (serial) =>
        new Promise<number>((resolve) => {
          const child = spawn(
            'pw-record',
            [
              '--target',
              serial,
              '--rate',
              String(CAPTURE_RATE),
              '--channels',
              '1',
              '--format',
              'f32',
              '--raw',
              '-',
            ],
            { stdio: ['ignore', 'pipe', 'ignore'] }
          );
          let sum = 0;
          let count = 0;
          child.stdout?.on('data', (chunk: Buffer) => {
            for (let i = 0; i + 4 <= chunk.length; i += 4) {
              const value = chunk.readFloatLE(i);
              sum += value * value;
              count += 1;
            }
          });
          child.on('error', () => resolve(0));
          setTimeout(() => {
            child.kill();
            resolve(count ? Math.sqrt(sum / count) : 0);
          }, ms);
        })
    )
  );
}

const wait = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Louder than this (RMS): the stream makes a sound */
const SOUNDING = 1e-3;

/**
 * The stream of the tab playing the song, among a few of the browser (other tabs playing too):
 * the one that goes quiet when the song is paused for a moment. The song plays again after.
 * Null when it cannot be told.
 */
async function findSongStream(serials: string[]) {
  try {
    if (!(await setFollowedPlaying(true))) return null;
    await wait(600);
    const before = await loudness(serials, 700);
    await setFollowedPlaying(false);
    await wait(300);
    const after = await loudness(serials, 700);
    await setFollowedPlaying(true);
    const drops = before.map((level, i) => (level > SOUNDING ? level - after[i] : 0));
    const best = drops.indexOf(Math.max(...drops));
    return drops[best] > SOUNDING && after[best] < before[best] / 4 ? serials[best] : null;
  } catch (e) {
    setFollowedPlaying(true).catch(() => {});
    return null;
  }
}

/**
 * Records an app alone (PipeWire): its stream that makes a sound (there may be a few, idle ones
 * are silent). The browser: the stream of the song's tab, when a few tabs play (told apart once,
 * not when it is found again). When its stream ends, the app is found again.
 */
async function startAppCapture(sender: WebContents, app: App, findSong = true) {
  let serials = await findStreams(app);
  if (!serials.length) throw new Error(`${app.name} does not play on this computer`);
  if (findSong && app === BROWSER_APP && serials.length > 1) {
    const song = await findSongStream(serials);
    if (song) serials = [song];
  }
  let child: ChildProcess | null = null;
  for (let i = 0; i < serials.length && !child; i += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      child = await recordStream(serials[i], sender);
    } catch (e) {
      child = null;
    }
  }
  if (!child) throw new Error(`${app.name} is not heard on this computer`);
  // stopped meanwhile: not recorded
  if (following?.sender !== sender) {
    child.kill();
    throw new Error('Stopped');
  }
  const recording = child;
  capture = { process: recording, sender };
  recording.on('exit', () => {
    if (capture?.process !== recording) return;
    capture = null;
    // still wanted: the app is recorded again (its new stream)
    if (following?.sender === sender && !sender.isDestroyed()) {
      following.timer = setTimeout(() => {
        if (following?.sender === sender) startAppCapture(sender, app, false).catch(() => {});
      }, 1500);
    }
  });
}

/** Tries a recording tool: resolves when sound comes, rejects when it cannot start */
function tryCommand(command: string, args: string[], sender: WebContents) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    let started = false;
    // no sound at all: given up
    const timeout = setTimeout(() => {
      if (started) return;
      child.kill();
      reject(new Error(`${command} gave no sound`));
    }, 3000);
    child.on('error', (e) => {
      clearTimeout(timeout);
      reject(e);
    });
    child.on('exit', (code) => {
      if (!started) reject(new Error(`${command} stopped (${code})`));
      if (capture?.process === child) capture = null;
    });
    child.stdout?.once('data', () => {
      started = true;
      clearTimeout(timeout);
      capture = { process: child, sender };
      resolve();
    });
    sendSamples(child, sender);
  });
}

/**
 * Starts sending the sound of the computer to a page: the tool used, or an error. Spotify alone
 * when it can, or the browser alone for a song on YouTube (its link).
 */
export async function startCapture(sender: WebContents, uri?: string) {
  stopCapture();
  if (process.platform !== 'linux') {
    throw new Error(
      'The sound of the computer can only be heard on Linux and Windows: pick an input'
    );
  }
  // Spotify (or the browser) alone when it can be heard so
  const youtube = !!uri && isYouTubeUri(uri);
  following = { sender };
  try {
    await startAppCapture(sender, youtube ? BROWSER_APP : SPOTIFY_APP);
    return youtube ? 'Browser only' : 'Spotify only';
  } catch (e) {
    following = null;
  }
  const errors: string[] = [];
  for (let i = 0; i < COMMANDS.length; i += 1) {
    const [command, args] = COMMANDS[i];
    try {
      // eslint-disable-next-line no-await-in-loop
      await tryCommand(command, args, sender);
      return command;
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  throw new Error(
    `The sound of the computer could not be recorded (pw-record or parec is needed): ${errors.join(
      ', '
    )}`
  );
}

/**
 * Windows: the page hears the sound of the computer itself (asking to capture the screen,
 * with its sound: "loopback"). Only the sound is kept there.
 */
export function allowLoopbackSound() {
  if (process.platform !== 'win32') return;
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer
      .getSources({ types: ['screen'] })
      .then((sources) => callback({ video: sources[0], audio: 'loopback' }))
      // (nothing given: refused)
      .catch(() => callback({}));
  });
}
