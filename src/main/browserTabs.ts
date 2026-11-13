import { WebSocket, WebSocketServer } from 'ws';

/**
 * The YouTube tabs of the browsers, told by MIDI Jar's browser extension (assets/
 * browser-extension): every video playing, not only the one the browser tells the system
 * about, and each one played, paused or moved. Only on this computer, only from extensions.
 */

export const BROWSER_TABS_PORT = 43822;

/** What a tab plays (its video), and where it was (ms) when it told */
export type BrowserTab = {
  /** the extension that told it, and the tab there */
  key: string;
  id: string;
  title: string;
  channel: string;
  playing: boolean;
  positionMs: number;
  durationMs: number;
  /** when it was there (ms since 1970: the same clock, on this computer) */
  at: number;
};

/** A tab not heard from for this long (ms) is gone (closed, its browser too) */
const GONE_MS = 5000;

const tabs = new Map<string, { tab: BrowserTab; socket: WebSocket; tabId: number }>();
let server: WebSocketServer | null = null;
let lastConnection = 0;

/** Extensions only (a web page cannot follow or control the tabs) */
const isExtension = (origin?: string) =>
  !!origin && /^(chrome|moz|safari-web)-extension:\/\//.test(origin);

export function startBrowserTabs() {
  if (server) return;
  server = new WebSocketServer({
    host: '127.0.0.1',
    port: BROWSER_TABS_PORT,
    verifyClient: ({ origin }: { origin?: string }) => isExtension(origin),
  });
  // (another MIDI Jar has it: nothing then)
  server.on('error', () => {
    server = null;
  });
  let connections = 0;
  server.on('connection', (socket) => {
    connections += 1;
    lastConnection = Date.now();
    const connection = connections;
    socket.on('message', (data) => {
      let message: { type?: string; tab?: number; state?: Omit<BrowserTab, 'key'> | null };
      try {
        message = JSON.parse(String(data));
      } catch (e) {
        return;
      }
      if (message.type !== 'state' || typeof message.tab !== 'number') return;
      const key = `${connection}:${message.tab}`;
      const { state } = message;
      if (!state?.id) {
        tabs.delete(key);
        return;
      }
      tabs.set(key, {
        tab: {
          key,
          id: String(state.id),
          title: String(state.title ?? ''),
          channel: String(state.channel ?? ''),
          playing: !!state.playing,
          positionMs: Number(state.positionMs) || 0,
          durationMs: Number(state.durationMs) || 0,
          at: Number(state.at) || Date.now(),
        },
        socket,
        tabId: message.tab,
      });
    });
    socket.on('close', () => {
      [...tabs.keys()].forEach((key) => {
        if (key.startsWith(`${connection}:`)) tabs.delete(key);
      });
    });
  });
}

export function stopBrowserTabs() {
  server?.close();
  server = null;
  tabs.clear();
}

/** The extension is there (a browser connected lately) */
export const isConnected = () => !!server && server.clients.size > 0 && lastConnection > 0;

/** The tabs playing a video (or paused on one) */
export function listTabs() {
  const now = Date.now();
  return [...tabs.values()]
    .filter(({ tab }) => now - tab.at < GONE_MS)
    .map(({ tab }) => {
      // where it is now (it moved on since it told)
      const elapsed = tab.playing ? now - tab.at : 0;
      return { ...tab, positionMs: tab.positionMs + elapsed, at: now };
    });
}

/** Plays, pauses or moves a tab's video */
export function controlTab(key: string, action: 'play' | 'pause' | 'seek', ms = 0) {
  const entry = tabs.get(key);
  if (!entry) throw new Error('The tab no longer plays');
  entry.socket.send(JSON.stringify({ type: 'control', tab: entry.tabId, do: action, ms }));
}
