import { ChildProcess, execFile, spawn } from 'child_process';
import readline from 'readline';

/**
 * The media other apps play (a browser playing YouTube...), as the system knows it: on Linux
 * MPRIS (through busctl), on Windows its media controls (through PowerShell). What they play,
 * where they are in it, and play, pause or move it.
 */

export type MediaSession = {
  /** the app (its bus name, or its app id on Windows) */
  id: string;
  /** the app's process or id, to tell browsers from other apps */
  app: string;
  title: string;
  /** (a few: joined with ", ") */
  artist: string;
  isPlaying: boolean;
  positionMs: number;
  /** when the position was measured (ms since 1970) */
  measuredAt: number;
  durationMs: number;
  /** 0-100, null when the app does not tell */
  volume: number | null;
  /** (MPRIS: the track, to move in it) */
  trackId?: string;
  /** (MPRIS: the address of what plays, when the app tells) */
  url?: string;
  /** (MPRIS: its cover) */
  artUrl?: string;
};

/* LINUX: MPRIS */

const busctl = (args: string[]) =>
  new Promise<string>((resolve, reject) => {
    execFile('busctl', ['--user', '--json=short', ...args], { timeout: 3000 }, (error, stdout) =>
      error ? reject(error) : resolve(stdout)
    );
  });

const MPRIS_PATH = '/org/mpris/MediaPlayer2';
const PLAYER = 'org.mpris.MediaPlayer2.Player';

type BusValue = { type: string; data: unknown };

async function readMpris(service: string, app: string): Promise<MediaSession | null> {
  const asked = Date.now();
  const answer = JSON.parse(
    await busctl([
      'call',
      service,
      MPRIS_PATH,
      'org.freedesktop.DBus.Properties',
      'GetAll',
      's',
      PLAYER,
    ])
  ) as { data: [Record<string, BusValue>] };
  const measuredAt = asked + (Date.now() - asked) / 2;
  const props = answer.data[0];
  const meta = (props.Metadata?.data ?? {}) as Record<string, BusValue>;
  const title = String(meta['xesam:title']?.data ?? '');
  if (!title) return null;
  return {
    id: service,
    app,
    title,
    artist: ((meta['xesam:artist']?.data ?? []) as string[]).join(', '),
    isPlaying: props.PlaybackStatus?.data === 'Playing',
    positionMs: Math.round(Number(props.Position?.data ?? 0) / 1000),
    measuredAt,
    durationMs: Math.round(Number(meta['mpris:length']?.data ?? 0) / 1000),
    volume: props.Volume ? Math.round(Number(props.Volume.data) * 100) : null,
    trackId: String(meta['mpris:trackid']?.data ?? '/'),
    url: meta['xesam:url'] ? String(meta['xesam:url'].data) : undefined,
    artUrl: meta['mpris:artUrl'] ? String(meta['mpris:artUrl'].data) : undefined,
  };
}

async function listMpris() {
  const services = (
    JSON.parse(await busctl(['list'])) as { name: string; pid?: number; process?: string }[]
  ).filter(
    // (not this game's own)
    (service) => service.name.startsWith('org.mpris.MediaPlayer2.') && service.pid !== process.pid
  );
  const read = await Promise.all(
    services.map((service) => readMpris(service.name, service.process ?? '').catch(() => null))
  );
  return read.filter((session): session is MediaSession => !!session);
}

const callMpris = (service: string, method: string, ...args: string[]) =>
  busctl(['call', service, MPRIS_PATH, PLAYER, method, ...args]);

/* WINDOWS: ITS MEDIA CONTROLS (GlobalSystemMediaTransportControls, from PowerShell) */

/**
 * Answers requests (one JSON line each, one JSON line back): "list", "play", "pause", "seek".
 * A session is found again by its app id, and its title when a few have the same app.
 */
const WINDOWS_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
  $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation${'`'}1'
} | Select-Object -First 1
function Await($operation, [Type]$type) {
  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($operation))
  $null = $task.Wait(5000)
  $task.Result
}
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
$manager = Await ($managerType::RequestAsync()) $managerType
$propertiesType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
function Read-Session($session) {
  $properties = Await ($session.TryGetMediaPropertiesAsync()) $propertiesType
  $timeline = $session.GetTimelineProperties()
  [ordered]@{
    app = $session.SourceAppUserModelId
    title = $properties.Title
    artist = $properties.Artist
    status = [string]$session.GetPlaybackInfo().PlaybackStatus
    positionMs = [long]$timeline.Position.TotalMilliseconds
    durationMs = [long]($timeline.EndTime - $timeline.StartTime).TotalMilliseconds
    updatedAt = $timeline.LastUpdatedTime.ToUnixTimeMilliseconds()
  }
}
function Find-Session($app, $title) {
  $same = @($manager.GetSessions() | Where-Object { $_.SourceAppUserModelId -eq $app })
  foreach ($session in $same) {
    if ((Await ($session.TryGetMediaPropertiesAsync()) $propertiesType).Title -eq $title) { return $session }
  }
  if ($same.Count -eq 0) { throw 'It no longer plays' }
  $same[0]
}
while ($null -ne ($line = [Console]::In.ReadLine())) {
  try {
    $request = $line | ConvertFrom-Json
    $result = $null
    switch ($request.do) {
      'list' { $result = @(foreach ($session in $manager.GetSessions()) { Read-Session $session }) }
      'play' { $result = Await ((Find-Session $request.app $request.title).TryPlayAsync()) ([bool]) }
      'pause' { $result = Await ((Find-Session $request.app $request.title).TryPauseAsync()) ([bool]) }
      'seek' {
        $ticks = [long]$request.ms * 10000
        $result = Await ((Find-Session $request.app $request.title).TryChangePlaybackPositionAsync($ticks)) ([bool])
      }
    }
    [Console]::Out.WriteLine((ConvertTo-Json -InputObject @{ ok = $true; result = $result } -Compress -Depth 4))
  } catch {
    [Console]::Out.WriteLine((ConvertTo-Json -InputObject @{ ok = $false; error = [string]$_.Exception.Message } -Compress))
  }
}
`;

/** How long PowerShell is given to answer (ms): the first answer waits for it to start */
const WINDOWS_TIMEOUT_MS = 10000;

let powershell: { child: ChildProcess; answers: ((line: string) => void)[] } | null = null;
/** the requests, one at a time */
let queue: Promise<unknown> = Promise.resolve();

function startPowerShell() {
  const child = spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-EncodedCommand',
      Buffer.from(WINDOWS_SCRIPT, 'utf16le').toString('base64'),
    ],
    { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true }
  );
  const started = { child, answers: [] as ((line: string) => void)[] };
  readline.createInterface({ input: child.stdout as NodeJS.ReadableStream }).on('line', (line) => {
    started.answers.shift()?.(line);
  });
  const stop = () => {
    if (powershell === started) powershell = null;
  };
  child.on('exit', stop);
  child.on('error', stop);
  powershell = started;
  return started;
}

function askWindows<T>(request: Record<string, unknown>): Promise<T> {
  const asking = queue.then(
    () =>
      new Promise<T>((resolve, reject) => {
        const shell = powershell ?? startPowerShell();
        const timeout = setTimeout(() => {
          // (stuck: started again for the next request)
          shell.child.kill();
          reject(new Error("Windows' media controls did not answer"));
        }, WINDOWS_TIMEOUT_MS);
        shell.answers.push((line) => {
          clearTimeout(timeout);
          try {
            const answer = JSON.parse(line) as { ok: boolean; result?: T; error?: string };
            if (answer.ok) resolve(answer.result as T);
            else reject(new Error(answer.error ?? 'Media controls error'));
          } catch (e) {
            reject(e);
          }
        });
        shell.child.stdin?.write(`${JSON.stringify(request)}\n`);
      })
  );
  queue = asking.catch(() => {});
  return asking;
}

type WindowsSession = {
  app: string;
  title: string;
  artist: string;
  status: string;
  positionMs: number;
  durationMs: number;
  updatedAt: number;
};

async function listWindows() {
  const asked = Date.now();
  const sessions = (await askWindows<WindowsSession[] | null>({ do: 'list' })) ?? [];
  return sessions
    .filter((session) => session.title)
    .map(
      (session): MediaSession => ({
        id: session.app,
        app: session.app,
        title: session.title,
        artist: session.artist ?? '',
        isPlaying: session.status === 'Playing',
        positionMs: Math.max(0, session.positionMs),
        // the position is from when the app last told it (else: when it was asked)
        measuredAt: session.updatedAt > 1e12 ? session.updatedAt : asked,
        durationMs: Math.max(0, session.durationMs),
        volume: null,
      })
    );
}

export function stopMediaSessions() {
  powershell?.child.kill();
  powershell = null;
}

/* EITHER */

export const isSupported = () => process.platform === 'linux' || process.platform === 'win32';

const unsupported = () =>
  new Error('Following a browser only works on Linux and Windows: play the video there');

/** What the apps play (the ones that cannot be read are left out) */
export async function listSessions(): Promise<MediaSession[]> {
  if (process.platform === 'linux') return listMpris();
  if (process.platform === 'win32') return listWindows();
  throw unsupported();
}

export async function playSession(session: MediaSession) {
  if (process.platform === 'linux') await callMpris(session.id, 'Play');
  else await askWindows({ do: 'play', app: session.id, title: session.title });
}

export async function pauseSession(session: MediaSession) {
  if (process.platform === 'linux') await callMpris(session.id, 'Pause');
  else await askWindows({ do: 'pause', app: session.id, title: session.title });
}

export async function seekSession(session: MediaSession, positionMs: number) {
  const ms = Math.round(Math.max(0, positionMs));
  if (process.platform === 'linux') {
    await callMpris(session.id, 'SetPosition', 'ox', session.trackId ?? '/', String(ms * 1000));
  } else {
    await askWindows({ do: 'seek', app: session.id, title: session.title, ms });
  }
}

/** Opens something in the app (MPRIS only: Spotify plays a track from its link) */
export async function openInSession(session: MediaSession, uri: string) {
  if (process.platform !== 'linux') throw new Error('Not on this system');
  await busctl(['call', session.id, MPRIS_PATH, PLAYER, 'OpenUri', 's', uri]);
}

/** The app's volume (MPRIS only, and some apps do not let it be changed: nothing then) */
export async function setSessionVolume(session: MediaSession, percent: number) {
  if (process.platform !== 'linux') return;
  const volume = String(Math.max(0, Math.min(100, Math.round(percent))) / 100);
  await busctl(['set-property', session.id, MPRIS_PATH, PLAYER, 'Volume', 'd', volume]).catch(
    () => {}
  );
}
