/** Spotify login (kept in the main process only) */
export type SpotifyAuth = {
  clientId: string;
  accessToken: string;
  refreshToken: string;
  /** when the access token expires (ms since 1970) */
  expiresAt: number;
};

export type SpotifyTrack = {
  uri: string;
  name: string;
  artists: string;
  durationMs: number;
  /** the track asked for, when Spotify plays another release of the same song */
  linkedFromUri?: string;
  /** the cover of its album */
  imageUrl?: string;
};

/** What Spotify plays, and where it was in the track when asked */
export type SpotifyPlayer = {
  isPlaying: boolean;
  progressMs: number;
  measuredAt: number;
  /** volume of the device playing (null when Spotify does not tell) */
  volumePercent: number | null;
  track: SpotifyTrack;
};

export type SpotifyStatus = { connected: boolean; user?: string; error?: string };
