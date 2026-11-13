import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

import {
  MidiMessage,
  ServerState,
  Settings,
  SpotifyPlayer,
  SpotifyStatus,
  SpotifyTrack,
  UpdateInfo,
} from './types';

import { ApiMidiInput, ApiMidiOutput, ApiMidiRoute, ApiMidiWire } from './types/api';
import { WindowState } from './types/WindowState';

const registerListener =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (channel: string) => (func: (...args: any[]) => void) => {
    const subscription = (_event: IpcRendererEvent, ...args: unknown[]) => func(...args);
    ipcRenderer.on(channel, subscription);

    return () => {
      ipcRenderer.removeListener(channel, subscription);
    };
  };

export const AppApi = {
  quit: () => ipcRenderer.send('app:quit'),
  fetchPage: (url: string): Promise<string> => ipcRenderer.invoke('app:fetchPage', url),
  /** the sound played by the computer: chunks of samples, and when the last one was heard */
  sound: {
    /** (the song's link: a YouTube video is heard alone) */
    start: (uri?: string): Promise<string> => ipcRenderer.invoke('app:sound:start', uri),
    stop: (): Promise<void> => ipcRenderer.invoke('app:sound:stop'),
    onData: (callback: (samples: Float32Array, at: number) => void) =>
      registerListener('app:sound:data')(callback),
  },
  spotify: {
    login: (clientId: string): Promise<void> => ipcRenderer.invoke('spotify:login', clientId),
    logout: (): Promise<void> => ipcRenderer.invoke('spotify:logout'),
    status: (): Promise<SpotifyStatus> => ipcRenderer.invoke('spotify:status'),
    player: (): Promise<SpotifyPlayer | null> => ipcRenderer.invoke('spotify:player'),
    play: (uri: string, positionMs: number): Promise<void> =>
      ipcRenderer.invoke('spotify:play', uri, positionMs),
    pause: (): Promise<void> => ipcRenderer.invoke('spotify:pause'),
    seek: (positionMs: number): Promise<void> => ipcRenderer.invoke('spotify:seek', positionMs),
    search: (query: string): Promise<SpotifyTrack | null> =>
      ipcRenderer.invoke('spotify:search', query),
    redirectUri: (): Promise<string> => ipcRenderer.invoke('spotify:redirectUri'),
    volume: (percent: number): Promise<void> => ipcRenderer.invoke('spotify:volume', percent),
    bars: (uri: string): Promise<number[] | null> => ipcRenderer.invoke('spotify:bars', uri),
    /** everything playing on Spotify and in the browsers (YouTube), to pick one */
    players: (): Promise<SpotifyPlayer[]> => ipcRenderer.invoke('spotify:players'),
    /** follows the one picked (a track or video's link) */
    select: (uri: string): Promise<void> => ipcRenderer.invoke('spotify:select', uri),
  },
  /** YouTube videos (played through the calls of spotify, with their "youtube:" links) */
  youtube: {
    search: (query: string): Promise<SpotifyTrack | null> =>
      ipcRenderer.invoke('youtube:search', query),
    /** a video from its link */
    video: (link: string): Promise<SpotifyTrack> => ipcRenderer.invoke('youtube:video', link),
    /** MIDI Jar's browser extension: its folder, and whether a browser has it */
    extension: (): Promise<{ path: string; connected: boolean }> =>
      ipcRenderer.invoke('youtube:extension'),
    openExtension: (): Promise<void> => ipcRenderer.invoke('youtube:openExtension'),
  },
  settings: {
    clear: () => ipcRenderer.send('app:settings:clear'),
    reset: (key: keyof Settings) => ipcRenderer.invoke('app:settings:reset', key),
    getSettings: () => ipcRenderer.send('app:settings:getSettings'),
    updateSetting: (key: string, value: unknown) =>
      ipcRenderer.invoke('app:settings:updateSetting', key, value),
    updateSettings: (value: Settings) => ipcRenderer.invoke('app:settings:updateSettings', value),
    onSettingsChange: (callback: (settings: Settings) => void) =>
      registerListener('app:settings')(callback),
  },
  server: {
    enable: (enabled: boolean) => ipcRenderer.invoke('app:server:enable', enabled),
    getState: () => ipcRenderer.send('app:server:getState'),
    onStateChange: (callback: (state: ServerState) => void) =>
      registerListener('app:server:state')(callback),
  },
  window: {
    close: () => ipcRenderer.send('app:window:close'),
    minimize: () => ipcRenderer.send('app:window:minimize'),
    maximize: () => ipcRenderer.send('app:window:maximize'),
    unmaximize: () => ipcRenderer.send('app:window:unmaximize'),
    setAlwaysOnTop: (flag: boolean) => ipcRenderer.send('app:window:setAlwaysOnTop', flag),
    titleBarDoubleClick: () => ipcRenderer.send('app:window:titleBarDoubleClick'),
    checkUpdates: () => ipcRenderer.send('app:window:checkUpdates'),
    dismissUpdate: (version: string) => ipcRenderer.send('app:window:dismissUpdate', version),
    dismissChangelog: () => ipcRenderer.send('app:window:dismissChangelog'),
    getState: () => ipcRenderer.send('app:window:getState'),
    onStateChange: (callback: (state: WindowState) => void) =>
      registerListener('app:window:state')(callback),
    onUpdateInfo: (callback: (info: UpdateInfo) => void) =>
      registerListener('app:window:updateInfo')(callback),
  },
};

export const OsApi = {
  isMac: process.platform === 'darwin',
  isWindows: process.platform === 'win32',
  platform: process.platform,
};

export const MidiApi = {
  refreshDevices: () => ipcRenderer.send('midi:refreshDevices'),
  clearRoutes: () => ipcRenderer.send('midi:clearRoutes'),
  addRoute: (route: ApiMidiRoute) => ipcRenderer.send('midi:addRoute', route),
  deleteRoute: (route: ApiMidiRoute) => ipcRenderer.send('midi:deleteRoute', route),
  getInputs: () => ipcRenderer.send('midi:getInputs'),
  onInputs: (callback: (inputs: ApiMidiInput[]) => void) =>
    registerListener('midi:inputs')(callback),
  getOutputs: () => ipcRenderer.send('midi:getOutputs'),
  onOutputs: (callback: (outputs: ApiMidiOutput[]) => void) =>
    registerListener('midi:outputs')(callback),
  getWires: () => ipcRenderer.send('midi:getWires'),
  onWires: (callback: (outputs: ApiMidiWire[]) => void) => registerListener('midi:wires')(callback),
  onLatency: (callback: (latency: number, device: string) => void) =>
    registerListener('midi:activity')(callback),
  onMidiMessage: (
    namespace: string,
    callback: (message: MidiMessage, timestamp: number, device: string) => void
  ) => registerListener(`midi:message:${namespace}`)(callback),
};

contextBridge.exposeInMainWorld('app', AppApi);
contextBridge.exposeInMainWorld('os', OsApi);
contextBridge.exposeInMainWorld('midi', MidiApi);
