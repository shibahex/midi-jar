/**
 * MIDI Jar, in the browser: the YouTube tabs tell what they play, it is sent to MIDI Jar (on
 * this computer only), and what MIDI Jar asks (play, pause, move) is sent to the tab.
 */

const api = globalThis.browser ?? globalThis.chrome;

/** MIDI Jar listens there (only on this computer) */
const ADDRESS = 'ws://127.0.0.1:43822';
const RETRY_MS = 3000;

let socket = null;
let retry = null;
/** what each tab plays (by tab id), sent again once connected */
const tabs = new Map();

function send(message) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  else connect();
}

function connect() {
  if (socket && socket.readyState <= WebSocket.OPEN) return;
  clearTimeout(retry);
  try {
    socket = new WebSocket(ADDRESS);
  } catch (e) {
    retry = setTimeout(connect, RETRY_MS);
    return;
  }
  socket.onopen = () => {
    tabs.forEach((state, tab) => send({ type: 'state', tab, state }));
  };
  socket.onmessage = (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch (e) {
      return;
    }
    if (message?.type === 'control' && typeof message.tab === 'number') {
      api.tabs.sendMessage(message.tab, message).catch?.(() => {});
    }
  };
  socket.onclose = () => {
    socket = null;
    // (only while tabs play something: the browser may stop this script otherwise)
    if (tabs.size) retry = setTimeout(connect, RETRY_MS);
  };
}

api.runtime.onMessage.addListener((message, sender) => {
  const tab = sender.tab?.id;
  if (message?.type !== 'state' || tab === undefined) return;
  if (message.state) tabs.set(tab, message.state);
  else tabs.delete(tab);
  send({ type: 'state', tab, state: message.state });
});

api.tabs.onRemoved.addListener((tab) => {
  if (!tabs.delete(tab)) return;
  send({ type: 'state', tab, state: null });
});

connect();
