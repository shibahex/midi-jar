import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import classnames from 'classnames/bind';
import { Button, Select } from '@la-jarre-a-son/ui';
import { Note } from 'tonal';

import { useSettings } from 'renderer/contexts/Settings';
import useNotes from 'renderer/hooks/useNotes';
import { Icon } from 'renderer/components';
import {
  formatSharpsFlats,
  getBestScaleForChroma,
  estimateFirstChordMs,
  getAllSongs,
  getChordVoicing,
  medianOffset,
  getIncludedSongs,
  getRelativeScale,
  getScaleInfo,
  getSongChords,
  getSongProgression,
  getSongRhythm,
  randomPick,
  getImportedSongChords,
  getImportedSongKey,
  PlayableSong,
} from 'renderer/helpers';

import { Channel, INSTRUMENTS, InstrumentName, synth } from 'renderer/helpers/synth';
import { SongPart, SongPartRole } from 'main/types';

import ChordQuizKeyboard from '../ChordQuiz/ChordQuizKeyboard';
import Mixer from './Mixer';
import {
  BEATS_PER_BAR,
  buildHits,
  buildPartEvents,
  getBeatMs,
  getHitPoints,
  GOOD_MS,
  Hit,
  HitResult,
  judge,
  matchesChord,
  RhythmChord,
  SongRhythm,
} from './rhythm';

import styles from './RhythmGame.module.scss';

const cx = classnames.bind(styles);

const NATURAL_CHROMAS = [0, 2, 4, 5, 7, 9, 11];
const ALL_CHROMAS = Array.from({ length: 12 }, (_, chroma) => chroma);

/** lane: where the hit line is, and how much of the lane a beat takes (percent) */
const HIT_LINE = 15;
const BEAT_WIDTH = 10;

/** Notes of a chord played by the built-in sound: a bass note and the chord above it */
function getGuideNotes(hit: Hit) {
  const root = (Note.chroma(hit.chord.tonic ?? 'C') ?? 0) + 48;
  const base = root < 53 ? root + 12 : root;
  return [base - 12, ...getChordVoicing(hit.chord.intervals).map((s) => base + s)];
}

/** song part notes are scheduled this far ahead (ms), to be played exactly on time */
const LOOKAHEAD_MS = 150;

const ALL_PARTS: SongPartRole[] = ['rhythm', 'bass', 'lead', 'melody'];

/** instruments to pick for a part ("": the sound style's) */
const INSTRUMENT_CHOICES = [{ value: '', label: 'Default' }, ...INSTRUMENTS];

const DEFAULT_VOLUMES = { chords: 80, rhythm: 70, bass: 75, lead: 65, melody: 80, click: 60 };

const PART_NAMES: Record<SongPartRole, string> = {
  rhythm: 'Rhythm guitar',
  bass: 'Bass',
  lead: 'Lead guitar',
  melody: 'Melody',
};

/** Messages of the main process: "Error invoking remote method ...: Error: message" */
const errorText = (e: unknown) =>
  e instanceof Error ? e.message.replace(/^.*Error: /, '') : String(e);

/** Spotify is asked where it is this often (ms) */
const SPOTIFY_POLL_MS = 500;

const LABELS: Record<HitResult, string> = { perfect: 'PERFECT!', good: 'Good', miss: 'Miss' };

type Round = {
  song: PlayableSong;
  keyLabel: string;
  chords: RhythmChord[];
  rhythm: SongRhythm;
  /** notes of the instruments (Songsterr songs) */
  parts: SongPart[];
  tempo: number;
  beatsPerBar: number;
  noSongTempo: boolean;
};

/** speed up: 5% every 4 hits in a row, up to 1.5 times the tempo */
const SPEED_UP = 1.05;
const MAX_RATE = 1.5;

type Phase = 'ready' | 'playing' | 'done';

/**
 * Rhythm game: the chords of a song scroll toward a hit line in time with the beat,
 * play each one as it reaches the line. The song is revealed at the end.
 */
const RhythmGame: React.FC = () => {
  const { settings, updateSetting } = useSettings();
  const gameSettings = settings.rhythmGame;
  const { key, accidentals } = settings.notation;
  const { tempo, pattern, songTempo: useSongTempo } = gameSettings;

  const { playedMidiNotes, sustainedMidiNotes, midiNotes } = useNotes({ key, accidentals });

  // compared by content: settings arrays are new objects after any change
  const excludedSongs = (gameSettings.excludedSongs ?? []).join(',');
  const importedSongs = JSON.stringify(gameSettings.customSongs ?? []);
  const chosenSong = gameSettings.song ?? '';
  const spotifySync = !!gameSettings.spotifySync;

  // a song in a key: random or the current one (a minor song in its relative minor)
  const newRound = useCallback(
    (previous?: string): Round => {
      // the chosen song, or a random one (not the same twice in a row)
      const chosen = getAllSongs(JSON.parse(importedSongs)).find((s) => s.id === chosenSong);
      const songs = getIncludedSongs(excludedSongs.split(','), JSON.parse(importedSongs));
      const song =
        chosen ?? randomPick(songs.length > 1 ? songs.filter((s) => s.id !== previous) : songs);
      // the song's rhythm, and its own tempo when it has one (and it is wanted)
      const rhythm = getSongRhythm(song);
      // songs synced with Spotify play at the tempo of the recording
      const synced = spotifySync && !!song.imported?.spotify && !!rhythm.bpm;
      const songTempo = (useSongTempo || synced) && rhythm.bpm ? rhythm.bpm : tempo;
      const beatsPerBar = rhythm.beatsPerBar ?? BEATS_PER_BAR;
      const timing = {
        tempo: songTempo,
        beatsPerBar,
        rhythm,
        // the song's tempo is wanted, but the song has none
        noSongTempo: useSongTempo && !!song.imported && !rhythm.bpm,
      };

      // imported songs are played in their own key
      if (song.imported) {
        const chords = getImportedSongChords(song.imported);
        return {
          song,
          keyLabel: getImportedSongKey(song.imported),
          chords,
          parts: song.imported.parts ?? [],
          ...timing,
        };
      }

      const { mode } = getSongProgression(song.song);
      let tonic: string;
      if (gameSettings.songKey === 'current') {
        tonic = mode === 'major' ? key : getRelativeScale(getScaleInfo(key, 'major'))?.tonic ?? 'A';
      } else {
        const chromas = gameSettings.tonics === 'natural' ? NATURAL_CHROMAS : ALL_CHROMAS;
        tonic = getBestScaleForChroma(randomPick(chromas), mode).tonic;
      }
      const chords = getSongChords(song.song, tonic);
      return {
        song,
        keyLabel: `${formatSharpsFlats(tonic)} ${mode}`,
        chords,
        parts: [],
        ...timing,
      };
    },
    [
      chosenSong,
      excludedSongs,
      importedSongs,
      gameSettings.songKey,
      gameSettings.tonics,
      key,
      tempo,
      useSongTempo,
      spotifySync,
    ]
  );

  const makeHits = useCallback(
    (r: Round) => buildHits(r.chords, r.tempo, pattern, r.rhythm),
    [pattern]
  );

  const [round, setRound] = useState<Round>(() => newRound());
  const { beatsPerBar } = round;
  const beatMs = getBeatMs(round.tempo);
  const [phase, setPhase] = useState<Phase>('ready');
  const [now, setNow] = useState(0);
  const [hits, setHits] = useState<Hit[]>(() => makeHits(round));
  const [combo, setCombo] = useState(0);
  const [bestCombo, setBestCombo] = useState(0);
  const [score, setScore] = useState(0);
  const [judgement, setJudgement] = useState<{ result: HitResult; id: number } | null>(null);
  // learning mode: what happens on a miss (wait for the chord, or slow down)
  // Spotify: the linked song plays there, and the game follows it
  const spotifyLink = round.song.imported?.spotify;
  // linked (and with a tempo): can be synced; synced: the first chord was found in the recording
  const spotifyLinked = spotifySync && !!spotifyLink && !!round.song.imported?.bpm;
  const spotifyOn = spotifyLinked && spotifyLink?.firstChordMs !== undefined;
  const spotifyOnRef = useRef(spotifyOn);
  spotifyOnRef.current = spotifyOn;
  const spotifyLinkRef = useRef(spotifyLink);
  spotifyLinkRef.current = spotifyLink;
  const [spotifyMessage, setSpotifyMessage] = useState('');
  // where Spotify was (asked about twice a second), and where the song starts in the recording
  const spotifyPlayer = useRef<{
    progressMs: number;
    at: number;
    isPlaying: boolean;
    uri: string;
  } | null>(null);
  const spotifyTiming = useRef({ songStartMs: 0, countInMs: 0, synced: false });
  // syncing: tap on the first chord while Spotify plays the song
  const [calibrating, setCalibrating] = useState(false);
  // how early or late each chord was played (ms): a synced song is corrected from them
  const hitOffsets = useRef<number[]>([]);
  const [syncAdjust, setSyncAdjust] = useState<number | null>(null);
  // the sync moved while playing (arrows, taps while listening): saved when the song stops
  const syncShift = useRef(0);
  const [shownShift, setShownShift] = useState(0);
  const pendingAdjust = useRef(0);
  // listening with Spotify: taps on the chord changes, to sync
  const tapOffsets = useRef<number[]>([]);
  const [tapCount, setTapCount] = useState(0);
  const [spotifyVolume, setSpotifyVolume] = useState<number | null>(null);
  // how late the playing reaches the game (ms)
  const latencyMs = gameSettings.latencyMs ?? 0;
  const latencyRef = useRef(latencyMs);
  latencyRef.current = latencyMs;

  // a song synced with Spotify cannot wait or slow down on a miss
  const onMiss =
    gameSettings.learningMode && !spotifyOn ? gameSettings.onMiss ?? 'continue' : 'continue';
  const [rate, setRate] = useState(1);
  const [waiting, setWaiting] = useState<number | null>(null);

  // song time: real time, paused while waiting, slower when slowed down
  const songTime = useRef(0);
  const lastReal = useRef(0);
  const rateRef = useRef(1);
  const waitingRef = useRef<number | null>(null);
  const hitsRef = useRef(hits);
  hitsRef.current = hits;
  const comboRef = useRef(combo);
  comboRef.current = combo;
  // a chord must be released before the next hit (repeated chords are struck again)
  const armed = useRef(true);
  // built-in sound: the chords of the song, a click on the beat
  const sound = gameSettings.sound ?? 'chords';
  const sounded = useRef(new Set<number>());
  // volume of each part (the mixer)
  const volumes = { ...DEFAULT_VOLUMES, ...gameSettings.volumes };
  const volumesKey = JSON.stringify(volumes);
  useEffect(() => {
    Object.entries(JSON.parse(volumesKey) as Record<Channel, number>).forEach(([id, value]) =>
      synth.setChannelVolume(id as Channel, value / 100)
    );
  }, [volumesKey]);

  // the instrument picked for each part (none: the sound style's)
  const instrumentsKey = JSON.stringify(gameSettings.instruments ?? {});
  useEffect(() => {
    const picked = JSON.parse(instrumentsKey) as Record<string, string>;
    (['chords', 'rhythm', 'bass', 'lead', 'melody'] as Channel[]).forEach((channel) =>
      synth.setChannelInstrument(channel, (picked[channel] as InstrumentName) || null)
    );
  }, [instrumentsKey]);

  // the parts of the song heard (the rhythm guitar replaces the chords)
  const songParts = (gameSettings.songParts ?? ALL_PARTS).join(',');
  const partEvents = useMemo(
    () =>
      buildPartEvents(
        round.parts,
        songParts.split(',') as SongPartRole[],
        round.tempo,
        round.beatsPerBar
      ),
    [round, songParts]
  );
  const partEventsRef = useRef(partEvents);
  partEventsRef.current = partEvents;
  const playsRhythmPart = partEvents.some((e) => e.role === 'rhythm');
  const playsRhythmPartRef = useRef(playsRhythmPart);
  playsRhythmPartRef.current = playsRhythmPart;
  const partCursor = useRef(0);
  // the song time at the last frame (to notice jumps)
  const lastSongTime = useRef(0);
  const lastBeat = useRef(-1);
  // listening: the song plays by itself, nothing is judged
  const [listening, setListening] = useState(false);
  const listeningRef = useRef(false);
  listeningRef.current = listening;

  // settings changed: new round, waiting to start
  useEffect(() => {
    const next = newRound();
    setRound(next);
    setHits(makeHits(next));
    setPhase('ready');
  }, [newRound, makeHits]);

  /** Plays a song from the start (or only listens to it) */
  const start = (next: Round = round, listen = false) => {
    setRound(next);
    setHits(makeHits(next));
    setListening(listen);
    listeningRef.current = listen;
    sounded.current = new Set();
    lastBeat.current = -1;
    partCursor.current = 0;
    lastSongTime.current = 0;
    // notes of a previous run, still to come, are stopped
    synth.stopAll();
    setCombo(0);
    setBestCombo(0);
    setScore(0);
    setJudgement(null);
    setNow(0);
    armed.current = true;
    songTime.current = 0;
    lastReal.current = performance.now();
    rateRef.current = 1;
    setRate(1);
    waitingRef.current = null;
    setWaiting(null);
    setSpotifyMessage('');
    spotifyPlayer.current = null;
    hitOffsets.current = [];
    setSyncAdjust(null);
    syncShift.current = 0;
    setShownShift(0);
    pendingAdjust.current = 0;
    tapOffsets.current = [];
    setTapCount(0);
    const link = next.song.imported?.spotify;
    if (spotifyOnRef.current && link?.firstChordMs !== undefined) {
      // where the song starts in the recording (its intro before the first chord)
      const nextBeatMs = getBeatMs(next.tempo);
      const songStartMs = link.firstChordMs - (next.rhythm.leadIn ?? 0) * nextBeatMs;
      const countInMs = next.beatsPerBar * nextBeatMs;
      spotifyTiming.current = { songStartMs, countInMs, synced: false };
      setSpotifyMessage('Starting the song on Spotify...');
      window.app.spotify
        .play(link.uri, Math.max(0, songStartMs - countInMs))
        .catch((e) => setSpotifyMessage(`${errorText(e)}: the game follows Spotify`));
    }
    setPhase('playing');
  };

  // Spotify is asked where it is, while playing or syncing
  useEffect(() => {
    if (!spotifyLinked || (phase !== 'playing' && !calibrating)) return undefined;
    let stopped = false;
    const poll = () =>
      window.app.spotify
        .player()
        .then((player) => {
          if (stopped) return;
          if (!player) {
            spotifyPlayer.current = null;
            setSpotifyMessage('Nothing plays in Spotify');
            return;
          }
          if (player.volumePercent !== null) setSpotifyVolume(player.volumePercent);
          spotifyPlayer.current = {
            progressMs: player.progressMs,
            // the moment Spotify measured it, on this page's clock
            at: performance.now() - (Date.now() - player.measuredAt),
            isPlaying: player.isPlaying,
            uri: player.track.uri,
          };
          if (player.track.uri !== spotifyLinkRef.current?.uri) {
            setSpotifyMessage(`Spotify plays ${player.track.name}, not this song`);
          } else if (!player.isPlaying) {
            setSpotifyMessage('Spotify is paused');
          } else {
            setSpotifyMessage('');
          }
        })
        .catch((e) => {
          if (!stopped) setSpotifyMessage(errorText(e));
        });
    poll();
    const interval = setInterval(poll, SPOTIFY_POLL_MS);
    return () => {
      stopped = true;
      clearInterval(interval);
    };
  }, [spotifyLinked, phase, calibrating]);

  /** Syncing: Spotify plays the song from its start, a tap marks its first chord */
  const calibrate = () => {
    if (!spotifyLink) return;
    spotifyPlayer.current = null;
    setSpotifyMessage('Starting the song on Spotify...');
    setCalibrating(true);
    window.app.spotify
      .play(spotifyLink.uri, 0)
      .catch((e) => setSpotifyMessage(`${errorText(e)}: start it from the beginning in Spotify`));
  };

  /** Saves where the first chord of the song is in the Spotify recording */
  const saveSync = useCallback(
    (firstChordMs: number, syncedBy: 'estimate' | 'tap' | 'playing') => {
      const songId = round.song.id;
      updateSetting(
        'rhythmGame.customSongs',
        (gameSettings.customSongs ?? []).map((song) =>
          song.id === songId && song.spotify
            ? {
                ...song,
                spotify: { ...song.spotify, firstChordMs: Math.round(firstChordMs), syncedBy },
              }
            : song
        )
      );
    },
    [round, gameSettings.customSongs, updateSetting]
  );

  /** Syncs without tapping: estimated from the lengths of the recording and of the song */
  const autoSync = async () => {
    const song = round.song.imported;
    if (!song?.spotify) return;
    setSpotifyMessage('Syncing...');
    try {
      const durationMs =
        song.spotify.durationMs ?? (await window.app.spotify.search(song.spotify.name))?.durationMs;
      if (!durationMs) throw new Error('Spotify did not give the length of the song');
      const bars = await window.app.spotify.bars(song.spotify.uri);
      const firstChordMs = estimateFirstChordMs(song, durationMs, bars);
      if (firstChordMs === null) throw new Error('This song has no tempo');
      saveSync(firstChordMs, 'estimate');
      setSpotifyMessage('');
    } catch (e) {
      setSpotifyMessage(errorText(e));
    }
  };

  const tap = useCallback(() => {
    const player = spotifyPlayer.current;
    const link = spotifyLinkRef.current;
    if (!player?.isPlaying || !link || player.uri !== link.uri) return;
    saveSync(player.progressMs + (performance.now() - player.at), 'tap');
    setCalibrating(false);
    window.app.spotify.pause().catch(() => {});
  }, [saveSync]);

  // syncing: Space (or Enter) taps, Esc gives up
  useEffect(() => {
    if (!calibrating) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        tap();
      }
      if (event.key === 'Escape') {
        setCalibrating(false);
        window.app.spotify.pause().catch(() => {});
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [calibrating, tap]);

  // when a run with Spotify ends: the sync moved by the arrows, the taps and the playing is saved
  const wasPlaying = useRef(false);
  useEffect(() => {
    if (phase === 'playing') {
      wasPlaying.current = true;
      return;
    }
    if (!wasPlaying.current) return;
    wasPlaying.current = false;
    const firstChordMs = spotifyLinkRef.current?.firstChordMs;
    const total = syncShift.current + pendingAdjust.current;
    syncShift.current = 0;
    pendingAdjust.current = 0;
    if (firstChordMs === undefined || Math.abs(total) < 1) return;
    saveSync(firstChordMs + total, pendingAdjust.current ? 'playing' : 'tap');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  /** Moves the sync with Spotify (ms, later when more): live while playing, saved otherwise */
  const moveSync = (ms: number) => {
    if (phase === 'playing') {
      syncShift.current += ms;
      setShownShift(syncShift.current);
    } else if (spotifyLink?.firstChordMs !== undefined) {
      saveSync(spotifyLink.firstChordMs + ms, 'tap');
    }
  };

  /** Listening with Spotify: a tap on a chord change, the sync follows the taps */
  const listenTap = useCallback(() => {
    const t = songTime.current - latencyRef.current;
    const nearest = hitsRef.current
      .filter((h) => h.chordStart && Math.abs(h.time - t) <= 500)
      .sort((a, b) => Math.abs(a.time - t) - Math.abs(b.time - t))[0];
    if (!nearest) return;
    tapOffsets.current.push(t - nearest.time);
    setTapCount(tapOffsets.current.length);
    const offset = medianOffset(tapOffsets.current, 4);
    if (offset === null) return;
    // tapped late: the recording is later than the game thought
    syncShift.current += offset;
    setShownShift(syncShift.current);
    tapOffsets.current = [];
  }, []);

  /** Stops the song (and Spotify) */
  const stop = useCallback(() => {
    setPhase('ready');
    synth.stopAll();
    setCalibrating(false);
    if (spotifyOnRef.current) window.app.spotify.pause().catch(() => {});
  }, []);

  const record = useCallback((id: number, result: HitResult) => {
    setHits((current) => current.map((h) => (h.id === id ? { ...h, result } : h)));
    setJudgement({ result, id });
    if (result === 'miss') {
      setCombo(0);
      return;
    }
    const nextCombo = comboRef.current + 1;
    setCombo(nextCombo);
    setBestCombo((best) => Math.max(best, nextCombo));
    setScore((s) => s + getHitPoints(result, comboRef.current));
  }, []);

  // the lane moves, chords not played in time are missed, the song ends
  useEffect(() => {
    if (phase !== 'playing') return undefined;
    let frame = 0;
    const tick = () => {
      const real = performance.now();
      const player = spotifyPlayer.current;
      if (spotifyOnRef.current) {
        // the song time follows Spotify (still while it has not started, or is paused)
        const link = spotifyLinkRef.current;
        if (player?.isPlaying && player.uri === link?.uri) {
          const { songStartMs, countInMs } = spotifyTiming.current;
          const target =
            player.progressMs + (real - player.at) - (songStartMs + syncShift.current) + countInMs;
          const drift = target - songTime.current;
          if (!spotifyTiming.current.synced || Math.abs(drift) > 250) {
            songTime.current = target;
            spotifyTiming.current.synced = true;
          } else {
            songTime.current += real - lastReal.current + drift * 0.1;
          }
        }
      } else if (waitingRef.current === null) {
        songTime.current += (real - lastReal.current) * rateRef.current;
      }
      lastReal.current = real;
      const t = songTime.current;
      setNow(t);

      // the song jumped (restarted, or moved back or ahead in Spotify): the sound follows
      if (t < lastSongTime.current - 200 || t > lastSongTime.current + 1500) {
        synth.stopAll();
        const events = partEventsRef.current;
        const next = events.findIndex((e) => e.time >= t);
        partCursor.current = next === -1 ? events.length : next;
        sounded.current = new Set(hitsRef.current.filter((h) => h.time < t).map((h) => h.id));
        lastBeat.current = Math.floor(t / beatMs);
        // moved back: the chords coming again can be played again
        if (t < lastSongTime.current) {
          setHits((current) =>
            current.map((h) => (h.time >= t - GOOD_MS ? { ...h, result: undefined } : h))
          );
        }
      }
      lastSongTime.current = t;

      // built-in sound (not while waiting for a missed chord)
      if (waitingRef.current === null) {
        const beatNow = Math.floor(t / beatMs);
        if ((sound === 'click' || sound === 'both') && beatNow !== lastBeat.current) {
          lastBeat.current = beatNow;
          synth.click(beatNow % beatsPerBar === 0);
        }
        const playsSong = listeningRef.current || sound === 'chords' || sound === 'both';
        // the parts of the song: notes coming soon are scheduled on the audio clock
        if (playsSong) {
          const events = partEventsRef.current;
          while (
            partCursor.current < events.length &&
            events[partCursor.current].time < t + LOOKAHEAD_MS * rateRef.current
          ) {
            const event = events[partCursor.current];
            partCursor.current += 1;
            // notes long gone (the song was paused) are not played late
            if (event.time >= t - 50) {
              synth.play(
                [event.midi],
                event.duration / rateRef.current / 1000,
                // listening: the parts are softer, so the chords stand out
                listeningRef.current ? Math.round(event.velocity * 0.6) : event.velocity,
                (event.time - t) / rateRef.current / 1000,
                event.role
              );
            }
          }
        }
        if (playsSong) {
          const due = hitsRef.current.filter((h) => t >= h.time && !sounded.current.has(h.id));
          due.forEach((h) => {
            sounded.current.add(h.id);
            // a chord reached long ago (the song was paused) is not played late,
            // the rhythm guitar of the song plays the chords itself
            // (listening: the chords are always heard, on top of the song's parts)
            if (t - h.time > 150 || (playsRhythmPartRef.current && !listeningRef.current)) return;
            const seconds = ((h.length * beatMs) / rateRef.current / 1000) * 0.85;
            const velocity = listeningRef.current ? 115 : 95;
            // a guitar strums the chord
            const strum = synth.isPlucked('chords') ? 0.018 : 0;
            synth.play(getGuideNotes(h), seconds, h.chordStart ? velocity : 70, 0, 'chords', strum);
          });
          // listening: the chords are played by the song itself
          if (listeningRef.current && due.length) {
            const ids = new Set(due.map((h) => h.id));
            setHits((current) =>
              current.map((h) => (ids.has(h.id) ? { ...h, result: 'perfect' } : h))
            );
          }
        }
      }

      // timing windows are real time: in song time they shrink when slowed down
      const missed = listeningRef.current
        ? []
        : hitsRef.current.filter((h) => !h.result && t > h.time + GOOD_MS * rateRef.current);
      missed.forEach((h) => record(h.id, 'miss'));
      if (missed.length && onMiss === 'wait' && waitingRef.current === null) {
        // the song stops at the missed chord until it is played
        waitingRef.current = missed[0].id;
        setWaiting(missed[0].id);
        songTime.current = missed[0].time + GOOD_MS * rateRef.current;
      }
      if (missed.length && onMiss === 'slowDown') {
        rateRef.current = Math.max(0.5, rateRef.current * 0.9 ** missed.length);
        setRate(rateRef.current);
      }

      // the song ends after its last chord and its last note
      const last = hitsRef.current[hitsRef.current.length - 1];
      const lastNote = partEventsRef.current[partEventsRef.current.length - 1];
      const end = Math.max(
        last ? last.time + last.length * beatMs : 0,
        lastNote ? lastNote.time + lastNote.duration : 0
      );
      if (last && t > end) {
        setPhase('done');
        if (spotifyOnRef.current) window.app.spotify.pause().catch(() => {});
        // played in time with the recording: chords played late mean it is later than thought
        const offset = medianOffset(hitOffsets.current);
        if (
          spotifyOnRef.current &&
          !listeningRef.current &&
          offset !== null &&
          Math.abs(offset) >= 30
        ) {
          setSyncAdjust(Math.round(offset));
          pendingAdjust.current = Math.round(offset);
        }
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [phase, beatMs, beatsPerBar, record, onMiss, sound]);

  // listening with Spotify: Space taps the chord changes
  useEffect(() => {
    if (phase !== 'playing' || !listening || !spotifyOn) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === ' ') {
        event.preventDefault();
        listenTap();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, listening, spotifyOn, listenTap]);

  // Esc stops the song
  useEffect(() => {
    if (phase !== 'playing') return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') stop();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, stop]);

  // a chord is played: the closest chord to play in time is judged
  useEffect(() => {
    if (!playedMidiNotes.length) {
      armed.current = true;
      return;
    }
    // syncing with Spotify: any key taps the first chord
    if (calibrating && armed.current) {
      armed.current = false;
      tap();
      return;
    }
    // listening with Spotify: a key taps the chord changes
    if (phase === 'playing' && listeningRef.current && spotifyOnRef.current && armed.current) {
      armed.current = false;
      listenTap();
      return;
    }
    if (phase !== 'playing' || !armed.current || listeningRef.current) return;

    // waiting for a missed chord: playing it starts the song again
    if (waitingRef.current !== null) {
      const missedHit = hitsRef.current.find((h) => h.id === waitingRef.current);
      if (missedHit && matchesChord(missedHit.chromas, playedMidiNotes)) {
        armed.current = false;
        waitingRef.current = null;
        setWaiting(null);
        lastReal.current = performance.now();
      }
      return;
    }

    // the playing reaches the game late: judged as played that much earlier
    const t = songTime.current - latencyRef.current * rateRef.current;
    const window = GOOD_MS * rateRef.current;
    const target = hitsRef.current
      .filter((h) => !h.result && Math.abs(h.time - t) <= window)
      .sort((a, b) => Math.abs(a.time - t) - Math.abs(b.time - t))[0];
    if (!target || !matchesChord(target.chromas, playedMidiNotes)) return;

    // judged in real time
    const offset = (t - target.time) / rateRef.current;
    const result = judge(offset);
    if (result) {
      hitOffsets.current.push(offset);
      armed.current = false;
      // every 4 hits in a row: back up to speed after slowing down, or faster when speeding up
      if ((comboRef.current + 1) % 4 === 0) {
        const max = gameSettings.speedUp ? MAX_RATE : 1;
        if (
          !spotifyOnRef.current &&
          rateRef.current < max &&
          (onMiss === 'slowDown' || gameSettings.speedUp)
        ) {
          rateRef.current = Math.min(max, rateRef.current * SPEED_UP);
          setRate(rateRef.current);
        }
      }
      record(target.id, result);
    }
  }, [playedMidiNotes, phase, record, onMiss, gameSettings.speedUp, calibrating, tap, listenTap]);

  const waitingHit = waiting !== null ? hits.find((h) => h.id === waiting) : undefined;
  // the chord to play: the missed one while waiting, or the next one
  const nextHit = waitingHit ?? hits.find((h) => !h.result) ?? hits[hits.length - 1];
  const beat = Math.floor(now / beatMs);
  // a bar is counted before the first chord
  const countIn = phase === 'playing' && beat < beatsPerBar ? beatsPerBar - beat : null;

  const stats = useMemo(
    () => ({
      perfect: hits.filter((h) => h.result === 'perfect').length,
      good: hits.filter((h) => h.result === 'good').length,
      miss: hits.filter((h) => h.result === 'miss').length,
    }),
    [hits]
  );
  const accuracy = hits.length
    ? Math.round(((stats.perfect + stats.good * 0.5) / hits.length) * 100)
    : 0;

  // hits visible on the lane: from a beat behind the line to the end of the lane
  const visible = hits.filter((h) => {
    const beats = (h.time - now) / beatMs;
    return beats > -1.5 && beats < (100 - HIT_LINE) / BEAT_WIDTH;
  });

  // pick a song to play, or play random songs
  // the parts of the song heard (Songsterr songs), switched on and off with a click
  const enabledParts = songParts.split(',') as SongPartRole[];
  const partToggles = round.parts.length > 0 && (
    <div className={cx('parts')} role="group" aria-label="Parts heard">
      <span className={cx('partsLabel')}>Hear</span>
      {round.parts.map((part) => {
        const on = enabledParts.includes(part.role);
        return (
          <button
            key={part.role}
            type="button"
            className={cx('part', { 'part--on': on })}
            aria-pressed={on}
            title={part.name}
            onClick={() =>
              updateSetting(
                'rhythmGame.songParts',
                on ? enabledParts.filter((r) => r !== part.role) : [...enabledParts, part.role]
              )
            }
          >
            {PART_NAMES[part.role]}
          </button>
        );
      })}
    </div>
  );

  // the instrument of a part, to pick under its volume bar
  const instrumentPicker = (channel: Channel) => ({
    instrument: (gameSettings.instruments as Record<string, string> | undefined)?.[channel] ?? '',
    instruments: INSTRUMENT_CHOICES,
  });

  // volume bars: the chords, the parts of the song it has, the click
  const [showMixer, setShowMixer] = useState(false);
  const mixer = (
    <Mixer
      channels={[
        {
          id: 'chords',
          label: 'Chords',
          value: volumes.chords,
          ...instrumentPicker('chords'),
        },
        ...round.parts.map((part) => ({
          id: part.role,
          label: PART_NAMES[part.role],
          value: volumes[part.role],
          muted: !enabledParts.includes(part.role),
          ...instrumentPicker(part.role),
        })),
        { id: 'click', label: 'Click', value: volumes.click },
        // your keyboard, heard with Play My Notes
        ...(settings.general.playNotes
          ? [
              {
                id: 'keyboard',
                label: 'You',
                value: settings.general.soundVolume ?? 70,
                instrument: settings.general.keyboardInstrument ?? '',
                instruments: INSTRUMENT_CHOICES,
              },
            ]
          : []),
        ...(spotifyOn ? [{ id: 'spotify', label: 'Spotify', value: spotifyVolume ?? 50 }] : []),
      ]}
      onInput={(id, value) => {
        if (id === 'keyboard') synth.setVolume(value / 100);
        else if (id !== 'spotify') synth.setChannelVolume(id as Channel, value / 100);
      }}
      onInstrument={(id, instrument) => {
        if (id === 'keyboard') updateSetting('general.keyboardInstrument', instrument);
        else
          updateSetting('rhythmGame.instruments', {
            ...gameSettings.instruments,
            [id]: instrument,
          });
      }}
      onChange={(id, value) => {
        if (id === 'keyboard') {
          updateSetting('general.soundVolume', value);
          return;
        }
        if (id === 'spotify') {
          setSpotifyVolume(value);
          window.app.spotify.volume(value).catch((e) => setSpotifyMessage(errorText(e)));
          return;
        }
        updateSetting('rhythmGame.volumes', { ...volumes, [id]: value });
      }}
    />
  );

  // latency arrows: the sync with Spotify for a synced song, or how late the playing arrives
  const latencyArrows = (
    <div className={cx('latency')} role="group" aria-label={spotifyOn ? 'Spotify sync' : 'Latency'}>
      <span className={cx('latencyLabel')}>{spotifyOn ? 'Spotify sync' : 'Latency'}</span>
      <button
        type="button"
        className={cx('arrow')}
        aria-label={spotifyOn ? 'Song earlier' : 'Less latency'}
        title={spotifyOn ? 'The chords come earlier (20 ms)' : 'Less latency (10 ms)'}
        onClick={() =>
          spotifyOn
            ? moveSync(-20)
            : updateSetting('rhythmGame.latencyMs', Math.max(0, latencyMs - 10))
        }
      >
        ◀
      </button>
      <span className={cx('latencyValue')}>
        {spotifyOn ? `${shownShift > 0 ? '+' : ''}${shownShift} ms` : `${latencyMs} ms`}
      </span>
      <button
        type="button"
        className={cx('arrow')}
        aria-label={spotifyOn ? 'Song later' : 'More latency'}
        title={spotifyOn ? 'The chords come later (20 ms)' : 'More latency (10 ms)'}
        onClick={() =>
          spotifyOn ? moveSync(20) : updateSetting('rhythmGame.latencyMs', latencyMs + 10)
        }
      >
        ▶
      </button>
      {spotifyOn && listening && phase === 'playing' && (
        <span className={cx('latencyHint')}>
          Tap Space or a key on each chord change to sync
          {tapCount > 0 && ` (${tapCount}/4)`}
        </span>
      )}
    </div>
  );

  const songPicker = (
    <Select
      className={cx('songPicker')}
      aria-label="Song to play"
      options={[
        { value: '', label: 'Random song' },
        ...getAllSongs(gameSettings.customSongs ?? []).map((song) => ({
          value: song.id,
          label: song.title,
        })),
      ]}
      onChange={(value) => updateSetting('rhythmGame.song', value)}
      value={chosenSong}
    />
  );

  return (
    <div id="RhythmGame" className={cx('base')}>
      <div className={cx('header')}>
        <span className={cx('song')}>
          {phase === 'done' || gameSettings.showTitle !== 'end' ? round.song.title : 'Mystery song'}
        </span>
        <span>
          Key of <strong>{round.keyLabel}</strong> · {Math.round(round.tempo * rate)} BPM
          {beatsPerBar !== BEATS_PER_BAR && ` · ${beatsPerBar}/4`}
          {listening && phase === 'playing' && <span className={cx('faster')}> · listening</span>}
          {round.noSongTempo && (
            <span className={cx('slowed')}>
              {' '}
              (no tempo saved for this song: set it in settings)
            </span>
          )}
          {rate < 1 && <span className={cx('slowed')}> (slowed down)</span>}
          {rate > 1 && <span className={cx('faster')}> (sped up)</span>}
        </span>
      </div>

      {phase === 'playing' && (
        <div className={cx('mixerToggle')}>
          <Button size="sm" intent="neutral" onClick={() => setShowMixer((v) => !v)}>
            <Icon name="music" />
            Volume
          </Button>
          {(showMixer || listening) && mixer}
        </div>
      )}

      {phase === 'playing' && (
        <Button className={cx('stop')} intent="danger" onClick={stop} title="Stop the song (Esc)">
          <Icon name="cross" />
          Stop
          <kbd className={cx('stopKey')}>Esc</kbd>
        </Button>
      )}

      {phase === 'playing' && latencyArrows}

      {phase === 'playing' && spotifyOn && spotifyMessage && (
        <div className={cx('spotifyStatus')}>{spotifyMessage}</div>
      )}

      {gameSettings.gamification && (
        <div className={cx('scoreLine')}>
          <span className={cx('score')}>{score} pts</span>
          <span className={cx('combo', { 'combo--on': combo > 1 })}>combo ×{combo}</span>
        </div>
      )}

      <div className={cx('current')}>
        {phase !== 'done' && countIn !== null && (
          <span className={cx('countIn')} key={countIn}>
            {countIn}
          </span>
        )}
        {phase !== 'done' && countIn === null && (
          <>
            <span className={cx('currentName')}>{formatSharpsFlats(nextHit?.name ?? '')}</span>
            <span className={cx('currentNumeral')}>{nextHit?.numeral}</span>
            {waitingHit && (
              <span className={cx('waiting')}>
                Waiting for {formatSharpsFlats(waitingHit.name)}...
              </span>
            )}
          </>
        )}
        {judgement && phase === 'playing' && (
          <span
            className={cx('judgement', `judgement--${judgement.result}`)}
            key={`${judgement.id}-${judgement.result}`}
          >
            {LABELS[judgement.result]}
          </span>
        )}
      </div>

      <div className={cx('beats')}>
        {Array.from({ length: beatsPerBar }, (_, i) => (
          <span
            // eslint-disable-next-line react/no-array-index-key
            key={i}
            className={cx('beat', {
              'beat--on': phase === 'playing' && beat >= 0 && beat % beatsPerBar === i,
              'beat--first': i === 0,
            })}
          />
        ))}
      </div>

      <div className={cx('lane')}>
        <div className={cx('hitLine')} style={{ left: `${HIT_LINE}%` }} />
        {visible.map((h) => {
          const beats = h.length;
          return (
            <div
              key={h.id}
              className={cx('block', h.result && `block--${h.result}`, {
                'block--next': h === nextHit && !h.result,
                'block--repeat': !h.chordStart,
              })}
              style={{
                left: `${HIT_LINE + ((h.time - now) / beatMs) * BEAT_WIDTH}%`,
                width: `${Math.max(2, beats * BEAT_WIDTH - 1)}%`,
              }}
            >
              <span className={cx('blockName')}>{formatSharpsFlats(h.name)}</span>
              {h.chordStart && <span className={cx('blockNumeral')}>{h.numeral}</span>}
            </div>
          );
        })}
      </div>

      {calibrating && (
        <div className={cx('panel', 'panel--spotify')}>
          <div className={cx('panelTitle')}>Sync with Spotify</div>
          <div className={cx('panelText')}>
            Spotify plays <strong>{spotifyLink?.name}</strong> from the start. Press Space or any
            key of your keyboard right when the first chord (
            <strong>{formatSharpsFlats(round.chords[0]?.name ?? '')}</strong>) starts.
          </div>
          {spotifyMessage && <div className={cx('spotifyStatus')}>{spotifyMessage}</div>}
          <div className={cx('buttons')}>
            <Button intent="primary" onClick={tap}>
              Tap: first chord now
            </Button>
            <Button
              intent="neutral"
              onClick={() => {
                setCalibrating(false);
                window.app.spotify.pause().catch(() => {});
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {phase === 'ready' && !calibrating && (
        <div className={cx('panel')}>
          <div className={cx('panelTitle')}>Play the chords as they reach the line</div>
          <div className={cx('panelText')}>
            {gameSettings.showTitle === 'end'
              ? 'A mystery song is waiting.'
              : `Get ready to play ${round.song.title}.`}{' '}
            Release the keys between chords, even when a chord is repeated.
          </div>
          {spotifySync && spotifyLink && !round.song.imported?.bpm && (
            <div className={cx('spotifyStatus')}>
              This song has no tempo: type it in the settings to play it with Spotify
            </div>
          )}
          {spotifyLinked && (
            <div className={cx('spotifyLine')}>
              <span>
                Spotify: <strong>{spotifyLink?.name}</strong>
                {spotifyOn ? '' : ' (not synced yet)'}
                {spotifyMessage && !calibrating && ` · ${spotifyMessage}`}
              </span>
              {!spotifyOn && (
                <Button size="sm" intent="primary" onClick={autoSync}>
                  Sync automatically
                </Button>
              )}
              <Button size="sm" intent="neutral" variant="ghost" onClick={calibrate}>
                Sync by tapping
              </Button>
            </div>
          )}
          {partToggles}
          {mixer}
          {latencyArrows}
          <div className={cx('buttons')}>
            {songPicker}
            <Button
              intent="neutral"
              onClick={() => start(round, true)}
              title="Hear the song played by itself before playing it"
            >
              <Icon name="visible" />
              Listen
            </Button>
            <Button intent="primary" onClick={() => start()}>
              <Icon name="music" />
              Start
            </Button>
          </div>
        </div>
      )}

      {phase === 'done' && (
        <div className={cx('panel', 'panel--done')}>
          <div className={cx('panelTitle')}>
            {listening ? (
              <>
                That was <strong>{round.song.title}</strong>: your turn now!
              </>
            ) : (
              <>
                You just played the chords of <strong>{round.song.title}</strong>!
              </>
            )}
          </div>
          {syncAdjust !== null && (
            <div className={cx('spotifyStatus')}>
              Spotify sync corrected by {syncAdjust > 0 ? '+' : ''}
              {syncAdjust} ms from your playing
            </div>
          )}
          {!listening && (
            <div className={cx('stats')}>
              <span className={cx('stat--perfect')}>Perfect {stats.perfect}</span>
              <span className={cx('stat--good')}>Good {stats.good}</span>
              <span className={cx('stat--miss')}>Miss {stats.miss}</span>
              <span>Best combo {bestCombo}</span>
              <span>Accuracy {accuracy}%</span>
            </div>
          )}
          <div className={cx('buttons')}>
            {songPicker}
            <Button intent={listening ? 'primary' : 'neutral'} onClick={() => start()}>
              <Icon name={listening ? 'music' : 'reset'} />
              {listening ? 'Play it' : 'Play again'}
            </Button>
            {!chosenSong && !listening && (
              <Button intent="primary" onClick={() => start(newRound(round.song.id))}>
                <Icon name="music" />
                Next song
              </Button>
            )}
          </div>
        </div>
      )}

      {gameSettings.learningMode && nextHit && (
        <ChordQuizKeyboard
          target={nextHit.chord}
          keyName={key}
          sharps={accidentals === 'sharp'}
          fingering={gameSettings.fingering}
          playedMidiNotes={playedMidiNotes}
          sustainedMidiNotes={sustainedMidiNotes}
          midiNotes={midiNotes}
        />
      )}
    </div>
  );
};

export default RhythmGame;
