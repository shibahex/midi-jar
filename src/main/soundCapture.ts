import { ChildProcess, spawn } from 'child_process';
import { WebContents } from 'electron';

/**
 * The sound played by the computer (Linux: PipeWire or PulseAudio), sent to the page that
 * asked for it: to listen to a song playing on Spotify and sync with it.
 * Browsers do not list it as a sound input, so a recording tool is used.
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

export function stopCapture() {
  capture?.process.kill();
  capture = null;
}

/** Tries a recording tool: resolves when sound comes, rejects when it cannot start */
function tryCommand(command: string, args: string[], sender: WebContents) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    let started = false;
    let rest = Buffer.alloc(0);
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
    child.stdout?.on('data', (chunk: Buffer) => {
      if (!started) {
        started = true;
        clearTimeout(timeout);
        capture = { process: child, sender };
        resolve();
      }
      if (sender.isDestroyed()) {
        stopCapture();
        return;
      }
      // whole samples only (4 bytes each)
      const data = Buffer.concat([rest, chunk]);
      const usable = data.length - (data.length % 4);
      rest = data.subarray(usable);
      const samples = new Float32Array(usable / 4);
      for (let i = 0; i < samples.length; i += 1) samples[i] = data.readFloatLE(i * 4);
      // the time the last sample was heard
      sender.send('app:sound:data', samples, Date.now());
    });
  });
}

/** Starts sending the sound of the computer to a page: the tool used, or an error */
export async function startCapture(sender: WebContents) {
  stopCapture();
  if (process.platform !== 'linux') {
    throw new Error('The sound of the computer can only be heard on Linux: pick an input');
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
