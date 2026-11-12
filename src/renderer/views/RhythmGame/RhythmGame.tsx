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
  getAllSongs,
  getChordVoicing,
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

import { Instrument, synth } from 'renderer/helpers/synth';
import { SongPart, SongPartRole } from 'main/types';

import ChordQuizKeyboard from '../ChordQuiz/ChordQuizKeyboard';
import PracticePanel from './PracticePanel';
import {
  BEATS_PER_BAR,
  buildHits,
  buildPartEvents,
  getBeatMs,
  getSectionChords,
  getSections,
  getHitPoints,
  GOOD_MS,
  Hit,
  HitResult,
  judge,
  matchesChord,
  RhythmChord,
  Section,
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

/** the sound of each part of a song */
const PART_INSTRUMENTS: Record<SongPartRole, Instrument> = {
  rhythm: 'keys',
  bass: 'bass',
  lead: 'lead',
  melody: 'voice',
};

/** song part notes are scheduled this far ahead (ms), to be played exactly on time */
const LOOKAHEAD_MS = 150;

const ALL_PARTS: SongPartRole[] = ['rhythm', 'bass', 'lead', 'melody'];

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
  sections: Section[];
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
          sections: getSections(chords, beatsPerBar, song.imported.sections),
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
        sections: getSections(chords, beatsPerBar),
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

  // practice: the sections played (first to last), and the speed in percent
  const savedSpeed = gameSettings.practiceSpeed ?? 100;
  // practice mode (chosen sections, speed, loop) or the whole song at full speed
  const [practicing, setPracticing] = useState(false);
  const practicingRef = useRef(practicing);
  practicingRef.current = practicing;
  const practiceLoop = practicing && !!gameSettings.practiceLoop;
  const practiceRamp = !!gameSettings.practiceRamp;
  const makeHits = useCallback(
    (r: Round, first: number, last: number, speed: number) =>
      buildHits(
        getSectionChords(r.chords, r.sections, first, last),
        (r.tempo * speed) / 100,
        pattern,
        // the intro plays only when starting from the first section
        { ...r.rhythm, leadIn: first === 0 ? r.rhythm.leadIn : 0 }
      ),
    [pattern]
  );

  const [round, setRound] = useState<Round>(() => newRound());
  const { beatsPerBar } = round;
  const [range, setRange] = useState({ first: 0, last: round.sections.length - 1 });
  // the speed the song is played at (it changes when looping faster)
  const [speed, setSpeed] = useState(100);
  const [loop, setLoop] = useState(0);
  const beatMs = getBeatMs((round.tempo * speed) / 100);
  const [phase, setPhase] = useState<Phase>('ready');
  const [now, setNow] = useState(0);
  const [hits, setHits] = useState<Hit[]>(() => makeHits(round, 0, round.sections.length - 1, 100));
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
  // the parts of the song heard (the rhythm guitar replaces the chords)
  const songParts = (gameSettings.songParts ?? ALL_PARTS).join(',');
  const partEvents = useMemo(() => {
    // the beats of the chosen sections, from the song start (after its intro)
    const beatOfChord = (index: number) =>
      (round.rhythm.leadIn ?? 0) +
      round.chords
        .slice(0, index)
        .reduce((sum, chord) => sum + (chord.beats ?? round.beatsPerBar), 0);
    const nextSection = round.sections[range.last + 1];
    return buildPartEvents(
      round.parts,
      songParts.split(',') as SongPartRole[],
      (round.tempo * speed) / 100,
      round.beatsPerBar,
      range.first === 0 ? 0 : beatOfChord(round.sections[range.first]?.start ?? 0),
      nextSection ? beatOfChord(nextSection.start) : Infinity
    );
  }, [round, songParts, range, speed]);
  const partEventsRef = useRef(partEvents);
  partEventsRef.current = partEvents;
  const playsRhythmPart = partEvents.some((e) => e.role === 'rhythm');
  const playsRhythmPartRef = useRef(playsRhythmPart);
  playsRhythmPartRef.current = playsRhythmPart;
  const partCursor = useRef(0);
  const lastBeat = useRef(-1);
  // listening: the song plays by itself, nothing is judged
  const [listening, setListening] = useState(false);
  const listeningRef = useRef(false);
  listeningRef.current = listening;

  // the saved speed is read when the song changes (saving it must not reset the sections)
  const savedSpeedRef = useRef(savedSpeed);
  savedSpeedRef.current = savedSpeed;

  // settings changed: new round (the whole song), waiting to start
  useEffect(() => {
    const next = newRound();
    setRound(next);
    setRange({ first: 0, last: next.sections.length - 1 });
    const nextSpeed = practicingRef.current ? savedSpeedRef.current : 100;
    setHits(makeHits(next, 0, next.sections.length - 1, nextSpeed));
    setSpeed(nextSpeed);
    setLoop(0);
    setPhase('ready');
  }, [newRound, makeHits]);

  /** Plays a song (the same sections at the same speed, or a new song from the start),
   * or only listens to it */
  const start = (
    next: Round = round,
    options: { first?: number; last?: number; speed?: number; loop?: number; listen?: boolean } = {}
  ) => {
    const isNew = next !== round;
    const first = options.first ?? (isNew ? 0 : range.first);
    const last = options.last ?? (isNew ? next.sections.length - 1 : range.last);
    // Spotify plays at the real speed only
    const playSpeed = spotifyOnRef.current ? 100 : options.speed ?? speed;
    const listen = !!options.listen;
    setRound(next);
    setRange({ first, last });
    setSpeed(playSpeed);
    setLoop(options.loop ?? 0);
    setHits(makeHits(next, first, last, playSpeed));
    setListening(listen);
    listeningRef.current = listen;
    sounded.current = new Set();
    lastBeat.current = -1;
    partCursor.current = 0;
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
    const link = next.song.imported?.spotify;
    if (spotifyOnRef.current && link?.firstChordMs !== undefined) {
      // where the song starts in the recording (its intro before the first chord)
      const nextBeatMs = getBeatMs(next.tempo);
      // practice: the chosen section starts after the count-in (the beats before it are skipped)
      const sectionBeat =
        first === 0
          ? 0
          : (next.rhythm.leadIn ?? 0) +
            next.chords
              .slice(0, next.sections[first]?.start ?? 0)
              .reduce((sum, chord) => sum + (chord.beats ?? next.beatsPerBar), 0);
      const songStartMs =
        link.firstChordMs - ((next.rhythm.leadIn ?? 0) - sectionBeat) * nextBeatMs;
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

  const tap = useCallback(() => {
    const player = spotifyPlayer.current;
    const link = spotifyLinkRef.current;
    if (!player?.isPlaying || !link || player.uri !== link.uri) return;
    const firstChordMs = Math.round(player.progressMs + (performance.now() - player.at));
    const songId = round.song.id;
    updateSetting(
      'rhythmGame.customSongs',
      (gameSettings.customSongs ?? []).map((song) =>
        song.id === songId && song.spotify
          ? { ...song, spotify: { ...song.spotify, firstChordMs } }
          : song
      )
    );
    setCalibrating(false);
    window.app.spotify.pause().catch(() => {});
  }, [round, gameSettings.customSongs, updateSetting]);

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

  /** Stops the song (and Spotify) */
  const stop = useCallback(() => {
    setPhase('ready');
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
          const target = player.progressMs + (real - player.at) - songStartMs + countInMs;
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
                PART_INSTRUMENTS[event.role]
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
            synth.play(getGuideNotes(h), seconds, h.chordStart ? velocity : 70);
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
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [phase, beatMs, beatsPerBar, record, onMiss, sound]);

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

    const t = songTime.current;
    const window = GOOD_MS * rateRef.current;
    const target = hitsRef.current
      .filter((h) => !h.result && Math.abs(h.time - t) <= window)
      .sort((a, b) => Math.abs(a.time - t) - Math.abs(b.time - t))[0];
    if (!target || !matchesChord(target.chromas, playedMidiNotes)) return;

    // judged in real time
    const result = judge((t - target.time) / rateRef.current);
    if (result) {
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
  }, [playedMidiNotes, phase, record, onMiss, gameSettings.speedUp, calibrating, tap]);

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
  // practice loop: the sections start again after a short break (5% faster after a loop
  // with no miss, up to the real speed)
  useEffect(() => {
    if (phase !== 'done' || !practiceLoop || listeningRef.current) return undefined;
    const clean = stats.miss === 0;
    const timeout = setTimeout(() => {
      const nextSpeed = practiceRamp && clean ? Math.min(100, speed + 5) : speed;
      start(round, { speed: Math.max(speed, nextSpeed), loop: loop + 1 });
    }, 1500);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, practiceLoop]);

  const accuracy = hits.length
    ? Math.round(((stats.perfect + stats.good * 0.5) / hits.length) * 100)
    : 0;

  // hits visible on the lane: from a beat behind the line to the end of the lane
  const visible = hits.filter((h) => {
    const beats = (h.time - now) / beatMs;
    return beats > -1.5 && beats < (100 - HIT_LINE) / BEAT_WIDTH;
  });

  // pick a song to play, or play random songs
  const isWholeSong = range.first === 0 && range.last === round.sections.length - 1;
  const sectionLabel = isWholeSong
    ? 'Whole song'
    : [
        round.sections[range.first]?.name,
        range.last !== range.first && round.sections[range.last]?.name,
      ]
        .filter(Boolean)
        .join(' to ');

  // practice: choose the sections and the speed (like a guitar game practice mode)
  const changePractice = (first: number, last: number, nextSpeed: number) => {
    const from = Math.min(first, last);
    const to = Math.max(first, last);
    setRange({ first: from, last: to });
    setSpeed(nextSpeed);
    setHits(makeHits(round, from, to, nextSpeed));
  };
  // practice: each section with its length in bars
  const sectionBars = useMemo(
    () =>
      round.sections.map((section, index) => {
        const end = round.sections[index + 1]?.start ?? round.chords.length;
        const beats = round.chords
          .slice(section.start, end)
          .reduce((sum, chord) => sum + (chord.beats ?? round.beatsPerBar), 0);
        return { name: section.name, bars: Math.max(1, Math.round(beats / round.beatsPerBar)) };
      }),
    [round]
  );

  // switching to the whole song keeps the practice choice for coming back
  const savedPractice = useRef<{ round: Round; first: number; last: number } | null>(null);
  const changePracticing = (next: boolean) => {
    setPracticing(next);
    if (next) {
      const kept = savedPractice.current?.round === round ? savedPractice.current : null;
      changePractice(kept?.first ?? 0, kept?.last ?? round.sections.length - 1, savedSpeed);
    } else {
      savedPractice.current = { round, first: range.first, last: range.last };
      changePractice(0, round.sections.length - 1, 100);
    }
  };

  const practice = (
    <PracticePanel
      practicing={practicing}
      onPracticingChange={changePracticing}
      sections={sectionBars}
      first={range.first}
      last={range.last}
      onRangeChange={(first, last) => changePractice(first, last, speed)}
      speed={speed}
      onSpeedChange={(value) => {
        changePractice(range.first, range.last, value);
        updateSetting('rhythmGame.practiceSpeed', value);
      }}
      loop={!!gameSettings.practiceLoop}
      onLoopChange={(value) => updateSetting('rhythmGame.practiceLoop', value)}
      ramp={practiceRamp}
      onRampChange={(value) => updateSetting('rhythmGame.practiceRamp', value)}
    />
  );

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
          Key of <strong>{round.keyLabel}</strong> ·{' '}
          {Math.round(((round.tempo * speed) / 100) * rate)} BPM
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

      {practicing && (
        <div className={cx('practiceInfo')}>
          Practice: {sectionLabel} · {speed}%{practiceLoop && ` · loop ${loop + 1}`}
        </div>
      )}

      {phase === 'playing' && (
        <Button className={cx('stop')} intent="danger" onClick={stop} title="Stop the song (Esc)">
          <Icon name="cross" />
          Stop
          <kbd className={cx('stopKey')}>Esc</kbd>
        </Button>
      )}

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
          {practice}
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
              </span>
              <Button
                size="sm"
                intent={spotifyOn ? 'neutral' : 'primary'}
                variant={spotifyOn ? 'ghost' : undefined}
                onClick={calibrate}
              >
                {spotifyOn ? 'Sync again' : 'Sync with Spotify'}
              </Button>
            </div>
          )}
          {partToggles}
          <div className={cx('buttons')}>
            {songPicker}
            <Button
              intent="neutral"
              onClick={() => start(round, { listen: true })}
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
            {practiceLoop && !listening && (
              <>
                Loop {loop + 1} done: <strong>{accuracy}%</strong>, again in a moment
                {practiceRamp && stats.miss === 0 && speed < 100 && ' (5% faster)'}
              </>
            )}
            {listening && (
              <>
                That was <strong>{round.song.title}</strong>
                {isWholeSong ? '' : ` (${sectionLabel})`}: your turn now!
              </>
            )}
            {!practiceLoop && !listening && (
              <>
                You just played the chords of <strong>{round.song.title}</strong>
                {isWholeSong ? '!' : ` (${sectionLabel})`}
              </>
            )}
          </div>
          {!listening && (
            <div className={cx('stats')}>
              <span className={cx('stat--perfect')}>Perfect {stats.perfect}</span>
              <span className={cx('stat--good')}>Good {stats.good}</span>
              <span className={cx('stat--miss')}>Miss {stats.miss}</span>
              <span>Best combo {bestCombo}</span>
              <span>Accuracy {accuracy}%</span>
            </div>
          )}
          {!practiceLoop && practice}
          <div className={cx('buttons')}>
            {practiceLoop && (
              <Button
                intent="neutral"
                onClick={() => updateSetting('rhythmGame.practiceLoop', false)}
              >
                <Icon name="cross" />
                Stop looping
              </Button>
            )}
            {!practiceLoop && songPicker}
            <Button intent={listening ? 'primary' : 'neutral'} onClick={() => start()}>
              <Icon name={listening ? 'music' : 'reset'} />
              {listening ? 'Play it' : 'Play again'}
            </Button>
            {!chosenSong && !practiceLoop && !listening && (
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
