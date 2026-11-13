/**
 * MIDI Jar, in a YouTube tab: tells what the video of the tab is and where it is (often, and
 * at once when it plays, pauses or moves), and plays, pauses or moves it when MIDI Jar asks.
 */

const api = globalThis.browser ?? globalThis.chrome;

/** How often the tab tells where it is, while it has a video (ms) */
const EVERY_MS = 1000;

const findVideo = () =>
  document.querySelector('#movie_player video') ?? document.querySelector('video');

/** The id of the video of the page (watch?v=, shorts) */
function videoId() {
  const url = new URL(window.location.href);
  return (
    url.searchParams.get('v') ?? url.pathname.match(/\/(?:shorts|live)\/([\w-]{11})/)?.[1] ?? ''
  );
}

/** The video's name and channel: from what YouTube tells the browser, else from the page */
function describeVideo() {
  const meta = navigator.mediaSession?.metadata;
  const title =
    meta?.title ||
    document.querySelector('h1.ytd-watch-metadata, ytmusic-player-bar .title')?.textContent ||
    document.title.replace(/\s*-\s*YouTube( Music)?$/, '');
  const channel =
    meta?.artist ||
    document.querySelector('ytd-watch-metadata ytd-channel-name a, #owner #channel-name a')
      ?.textContent ||
    '';
  return { title: (title ?? '').trim(), channel: channel.trim() };
}

function state() {
  const video = findVideo();
  const id = videoId();
  if (!video || !id || !Number.isFinite(video.duration)) return null;
  const ad = !!document.querySelector('#movie_player.ad-showing');
  return {
    id,
    ...describeVideo(),
    // (an ad plays: the video is not)
    playing: !video.paused && !video.ended && !ad,
    ad,
    positionMs: Math.round(video.currentTime * 1000),
    durationMs: ad ? 0 : Math.round(video.duration * 1000),
    at: Date.now(),
  };
}

function tell() {
  api.runtime.sendMessage({ type: 'state', state: state() }).catch?.(() => {});
}

setInterval(tell, EVERY_MS);
['play', 'pause', 'seeked', 'loadedmetadata', 'ended'].forEach((event) =>
  document.addEventListener(event, tell, true)
);
window.addEventListener('pagehide', () => {
  api.runtime.sendMessage({ type: 'state', state: null }).catch?.(() => {});
});

api.runtime.onMessage.addListener((message) => {
  const video = findVideo();
  if (!video || message?.type !== 'control') return;
  if (message.do === 'seek') video.currentTime = Math.max(0, message.ms) / 1000;
  if (message.do === 'play') video.play().catch(() => {});
  if (message.do === 'pause') video.pause();
  tell();
});
