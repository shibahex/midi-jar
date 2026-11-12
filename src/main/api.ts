import os from 'os';
import { app, ipcMain, BrowserWindow, systemPreferences } from 'electron';

import * as midi from './midi';
import { startServer, stopServer, getState as getServerState } from './server';

import { ApiMidiRoute } from './types/api';
import { MidiMessage, Settings } from './types';
import {
  getSettings,
  updateSetting,
  updateSettings,
  onSettingsChange,
  resetSettings,
  clearSettings,
} from './settings';
import {
  setAlwaysOnTop,
  setMaximized,
  dismissChangelog,
  dismissUpdate,
  getWindowState,
  onWindowStateChange,
} from './windowState';
import { WindowState } from './types/WindowState';
import { checkUpdates } from './update';
import * as spotify from './spotify';

function sendToAll(channel: string, ...args: unknown[]) {
  const windows = BrowserWindow.getAllWindows();
  windows.forEach((window) => {
    window.webContents.send(channel, ...args);
  });
}

ipcMain.on('app:quit', () => {
  app.quit();
});

/* WINDOW */

ipcMain.on('app:window:close', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  window?.close();
});

ipcMain.on('app:window:minimize', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  window?.minimize();
});

ipcMain.on('app:window:maximize', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  window?.maximize();
  setMaximized(true);
});

ipcMain.on('app:window:unmaximize', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);

  window?.unmaximize();
  setMaximized(false);
});

ipcMain.on('app:window:titleBarDoubleClick', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (window && os.platform() === 'darwin') {
    const doubleClickAction = systemPreferences.getUserDefault(
      'AppleActionOnDoubleClick',
      'string'
    );

    if (doubleClickAction === 'Minimize') {
      window.minimize();
    } else if (doubleClickAction === 'Maximize') {
      if (!window.isMaximized()) {
        window.maximize();
      } else {
        window.unmaximize();
      }
    }
  }
});

ipcMain.on('app:window:setAlwaysOnTop', (event, flag) => {
  const window = BrowserWindow.fromWebContents(event.sender);

  window?.setAlwaysOnTop(flag, 'floating');
});

ipcMain.on('app:window:dismissUpdate', (event, version: string) => {
  dismissUpdate(version);
});

ipcMain.on('app:window:dismissChangelog', () => {
  dismissChangelog();
});

ipcMain.on('app:window:checkUpdates', (event) => {
  const { updateDismissed } = getWindowState();

  checkUpdates(updateDismissed)
    .then((updateInfo) => {
      if (updateInfo) {
        event.reply('app:window:updateInfo', updateInfo);
      }
    })
    .catch(() => {});
});

ipcMain.on('app:window:getState', (event) => {
  event.reply('app:window:state', getWindowState());
});

onWindowStateChange((state?: WindowState) => {
  if (state) {
    sendToAll('app:window:state', getWindowState());
  }
});

export function bindWindowEvents(window: BrowserWindow) {
  window.on('maximize', () => {
    setMaximized(true);
  });
  window.on('unmaximize', () => {
    setMaximized(false);
  });
  window.on('always-on-top-changed', (_event, isAlwaysOnTop) => {
    setAlwaysOnTop(isAlwaysOnTop);
  });
}

/* MIDI */

ipcMain.on('midi:refreshDevices', () => {
  midi.refreshDevices(true);
});

ipcMain.on('midi:clearRoutes', () => {
  midi.clearRoutes();
});

ipcMain.on('midi:addRoute', (_event, route: ApiMidiRoute) => {
  midi.addRoute(route);
});

ipcMain.on('midi:deleteRoute', (_event, route: ApiMidiRoute) => {
  midi.deleteRoute(route);
});

ipcMain.on('midi:getInputs', (event) => {
  const inputs = midi.getInputs();
  event.reply('midi:inputs', inputs);
});

ipcMain.on('midi:getOutputs', (event) => {
  const outputs = midi.getOutputs();
  event.reply('midi:outputs', outputs);
});

ipcMain.on('midi:getWires', (event) => {
  const wires = midi.getWires();
  event.reply('midi:wires', wires);
});

ipcMain.on('app:settings:getSettings', (event) => {
  const settings = getSettings();
  event.reply('app:settings', settings);
});

midi.manager.addListener('refreshed', () => {
  sendToAll('midi:inputs', midi.getInputs());
  sendToAll('midi:outputs', midi.getOutputs());
  sendToAll('midi:wires', midi.getWires());
});

midi.manager.addListener(
  'midi',
  (namespace: string, message: MidiMessage, timestamp: number, device: string) => {
    sendToAll(`midi:message:*`, message, timestamp, device);
    sendToAll(`midi:message:${namespace}`, message, timestamp, device);
  }
);

midi.manager.addListener('activity', (latency: number, device: string) => {
  sendToAll(`midi:activity`, latency, device);
});

/* SETTINGS */

ipcMain.handle('app:settings:updateSetting', (_event, key: string, value: unknown) => {
  updateSetting(key, value);
});

ipcMain.handle('app:settings:updateSettings', (_event, value: Settings) => {
  updateSettings(value);
});

ipcMain.handle('app:settings:reset', (_event, key) => {
  resetSettings(key);
});

ipcMain.on('app:settings:clear', (_event) => {
  clearSettings();
});

onSettingsChange((settings?: Settings) => {
  if (settings) {
    sendToAll('app:settings', settings);
  }
});

/* SERVER */

ipcMain.handle('app:server:enable', async (_event, enabled: boolean) => {
  try {
    await updateSetting('server.enabled', enabled);

    if (enabled) {
      await startServer();
    } else {
      await stopServer();
    }
  } finally {
    sendToAll('app:server:state', getServerState());
  }
});

ipcMain.on('app:server:getState', (event) => {
  event.reply('app:server:state', getServerState());
});

/* WEB PAGES */

const PAGE_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const MAX_PAGE_SIZE = 10 * 1024 * 1024;

/** Fetches a web page (a song's chords), from the main process to avoid cross-site limits */
ipcMain.handle('app:fetchPage', async (_event, url: string) => {
  const { protocol } = new URL(url);
  if (protocol !== 'https:' && protocol !== 'http:') throw new Error('Not a web address');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      // like a browser (some sites refuse requests without a language)
      headers: {
        'User-Agent': PAGE_USER_AGENT,
        Accept: '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`The page could not be loaded (error ${response.status})`);
    const text = await response.text();
    return text.slice(0, MAX_PAGE_SIZE);
  } finally {
    clearTimeout(timeout);
  }
});

/* SPOTIFY */

/** errors of the main process reach the renderer as plain messages */
const spotifyCall =
  <A extends unknown[], R>(call: (...args: A) => Promise<R>) =>
  (_event: unknown, ...args: A) =>
    call(...args);

ipcMain.handle(
  'spotify:login',
  spotifyCall((clientId: string) => spotify.login(clientId))
);
ipcMain.handle('spotify:logout', () => spotify.logout());
ipcMain.handle(
  'spotify:status',
  spotifyCall(() => spotify.getStatus())
);
ipcMain.handle(
  'spotify:player',
  spotifyCall(() => spotify.getPlayer())
);
ipcMain.handle(
  'spotify:play',
  spotifyCall((uri: string, ms: number) => spotify.play(uri, ms))
);
ipcMain.handle(
  'spotify:pause',
  spotifyCall(() => spotify.pause())
);
ipcMain.handle(
  'spotify:seek',
  spotifyCall((ms: number) => spotify.seek(ms))
);
ipcMain.handle(
  'spotify:search',
  spotifyCall((query: string) => spotify.search(query))
);
ipcMain.handle('spotify:redirectUri', () => spotify.SPOTIFY_REDIRECT_URI);
ipcMain.handle(
  'spotify:bars',
  spotifyCall((uri: string) => spotify.getBars(uri))
);
