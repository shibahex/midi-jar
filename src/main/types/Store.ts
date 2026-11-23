import { Midi } from './Midi';
import { Settings } from './Settings';
import { WindowState } from './WindowState';
import { SpotifyAuth } from './Spotify';

export type StoreType = {
  midi: Midi;
  settings: Settings;
  windowState: WindowState;
  /** Spotify login (not in the settings: they are sent to the overlay) */
  spotifyAuth?: SpotifyAuth;
};
