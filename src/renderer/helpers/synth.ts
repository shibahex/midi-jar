/**
 * A small built-in sound (Web Audio, no samples): a few oscillators per note with their own
 * envelopes, a concert hall reverb, and a volume for each part (chords, bass, melody...).
 * Two styles: classical (grand piano, cello, violins, flute) or electric (soft keys, synth bass,
 * buzzy lead, voice).
 */

/** The instruments of the built-in sound */
export type InstrumentName =
  | 'piano'
  | 'epiano'
  | 'organ'
  | 'acousticGuitar'
  | 'electricGuitar'
  | 'bassGuitar'
  | 'cello'
  | 'synthBass'
  | 'strings'
  | 'synthLead'
  | 'flute'
  | 'voice';

type PluckedName = 'acousticGuitar' | 'electricGuitar' | 'bassGuitar';

export const INSTRUMENTS: { value: InstrumentName; label: string }[] = [
  { value: 'piano', label: 'Piano' },
  { value: 'epiano', label: 'Electric piano' },
  { value: 'organ', label: 'Organ' },
  { value: 'acousticGuitar', label: 'Acoustic guitar' },
  { value: 'electricGuitar', label: 'Electric guitar' },
  { value: 'bassGuitar', label: 'Bass guitar' },
  { value: 'cello', label: 'Cello' },
  { value: 'synthBass', label: 'Synth bass' },
  { value: 'strings', label: 'Strings' },
  { value: 'synthLead', label: 'Synth lead' },
  { value: 'flute', label: 'Flute' },
  { value: 'voice', label: 'Voice' },
];

/** The parts heard, each with its own volume */
export type Channel = 'chords' | 'rhythm' | 'bass' | 'lead' | 'melody' | 'click' | 'keyboard';

export type SoundStyle = 'classical' | 'electric';

type Partial = {
  type: OscillatorType;
  /** frequency as a multiple of the note's */
  ratio: number;
  amount: number;
  /** seconds for this partial to fade (higher partials fade faster on a piano) */
  decay?: number;
  /** detune in cents (strings are a few players slightly apart) */
  detune?: number;
};

type Tone = {
  partials: Partial[];
  level: number;
  attack: number;
  /** level kept while the note is held (1: no fade, small: struck and fading) */
  sustain: number;
  /** lowpass frequency as a multiple of the note frequency, and its highest value */
  brightness: number;
  maxCutoff: number;
  /** vibrato depth in cents, starting after this many seconds */
  vibrato?: number;
  vibratoDelay?: number;
  /** a short noise at the start: the hammer of a piano, the breath of a flute */
  noise?: { amount: number; length: number; frequency: number };
  release: number;
};

/** grand piano: slightly stretched partials, each fading on its own, a hammer at the start */
const PIANO: Tone = {
  partials: [
    { type: 'sine', ratio: 1, amount: 1, decay: 3.5 },
    { type: 'sine', ratio: 2.001, amount: 0.55, decay: 2 },
    { type: 'sine', ratio: 3.004, amount: 0.28, decay: 1.2 },
    { type: 'sine', ratio: 4.009, amount: 0.14, decay: 0.8 },
    { type: 'sine', ratio: 5.016, amount: 0.07, decay: 0.5 },
  ],
  level: 0.2,
  attack: 0.003,
  sustain: 0.02,
  brightness: 9,
  maxCutoff: 7000,
  noise: { amount: 0.06, length: 0.03, frequency: 3000 },
  release: 0.35,
};

/** Instruments made of oscillators (the guitars are plucked strings, below) */
const TONES: Record<Exclude<InstrumentName, PluckedName>, Tone> = {
  piano: PIANO,
  epiano: {
    partials: [
      { type: 'triangle', ratio: 1, amount: 1, decay: 2.5 },
      { type: 'sine', ratio: 2, amount: 0.35, decay: 1.5 },
      { type: 'sine', ratio: 3, amount: 0.12, decay: 1 },
    ],
    level: 0.22,
    attack: 0.006,
    sustain: 0.05,
    brightness: 8,
    maxCutoff: 9000,
    release: 0.25,
  },
  // drawbars: the note and its octaves, held
  organ: {
    partials: [
      { type: 'sine', ratio: 0.5, amount: 0.5 },
      { type: 'sine', ratio: 1, amount: 1 },
      { type: 'sine', ratio: 2, amount: 0.6 },
      { type: 'sine', ratio: 4, amount: 0.25 },
    ],
    level: 0.12,
    attack: 0.01,
    sustain: 1,
    brightness: 10,
    maxCutoff: 6000,
    vibrato: 3,
    release: 0.08,
  },
  // cello: bowed, a slow attack
  cello: {
    partials: [
      { type: 'sawtooth', ratio: 1, amount: 0.7, detune: -4 },
      { type: 'sawtooth', ratio: 1, amount: 0.5, detune: 5 },
      { type: 'sine', ratio: 0.5, amount: 0.3 },
    ],
    level: 0.16,
    attack: 0.07,
    sustain: 0.85,
    brightness: 5,
    maxCutoff: 1500,
    vibrato: 6,
    vibratoDelay: 0.25,
    release: 0.25,
  },
  synthBass: {
    partials: [
      { type: 'sine', ratio: 1, amount: 1 },
      { type: 'triangle', ratio: 2, amount: 0.25 },
    ],
    level: 0.32,
    attack: 0.005,
    sustain: 0.35,
    brightness: 6,
    maxCutoff: 1400,
    release: 0.2,
  },
  // violins: a section, slightly apart, with vibrato
  strings: {
    partials: [
      { type: 'sawtooth', ratio: 1, amount: 0.5, detune: -7 },
      { type: 'sawtooth', ratio: 1, amount: 0.5, detune: 0 },
      { type: 'sawtooth', ratio: 1, amount: 0.5, detune: 8 },
    ],
    level: 0.09,
    attack: 0.09,
    sustain: 0.9,
    brightness: 4,
    maxCutoff: 3500,
    vibrato: 10,
    vibratoDelay: 0.2,
    release: 0.3,
  },
  synthLead: {
    partials: [
      { type: 'sawtooth', ratio: 1, amount: 0.6 },
      { type: 'square', ratio: 1.003, amount: 0.25 },
    ],
    level: 0.12,
    attack: 0.01,
    sustain: 0.6,
    brightness: 5,
    maxCutoff: 4000,
    vibrato: 4,
    release: 0.2,
  },
  // flute: a pure tone, some breath
  flute: {
    partials: [
      { type: 'sine', ratio: 1, amount: 1 },
      { type: 'sine', ratio: 2, amount: 0.12 },
      { type: 'triangle', ratio: 1, amount: 0.15 },
    ],
    level: 0.17,
    attack: 0.06,
    sustain: 0.9,
    brightness: 6,
    maxCutoff: 5000,
    vibrato: 7,
    vibratoDelay: 0.3,
    noise: { amount: 0.04, length: 0.12, frequency: 2500 },
    release: 0.2,
  },
  voice: {
    partials: [
      { type: 'triangle', ratio: 1, amount: 1 },
      { type: 'sine', ratio: 2, amount: 0.2 },
    ],
    level: 0.2,
    attack: 0.04,
    sustain: 0.8,
    brightness: 4,
    maxCutoff: 3500,
    vibrato: 6,
    release: 0.25,
  },
};

/**
 * Plucked strings (Karplus-Strong): a burst of noise going round a delay as long as the
 * note's period, a little softer and darker each time round
 */
type Pluck = {
  /** how much of the sound is left after each round (sustain) */
  feedback: number;
  /** how bright the pluck is (0: soft finger, 1: pick) */
  brightness: number;
  seconds: number;
  level: number;
  /** after the string: darker (bass), or overdriven (electric) */
  cutoff: number;
  drive?: number;
  release: number;
};

const PLUCKS: Record<PluckedName, Pluck> = {
  acousticGuitar: {
    feedback: 0.996,
    brightness: 0.55,
    seconds: 2.5,
    level: 0.55,
    cutoff: 5000,
    release: 0.12,
  },
  electricGuitar: {
    feedback: 0.998,
    brightness: 0.7,
    seconds: 3,
    level: 0.25,
    cutoff: 3200,
    drive: 6,
    release: 0.1,
  },
  bassGuitar: {
    feedback: 0.997,
    brightness: 0.35,
    seconds: 2.5,
    level: 0.7,
    cutoff: 900,
    release: 0.1,
  },
};

const isPlucked = (name: InstrumentName): name is PluckedName => name in PLUCKS;

/** The instrument of each part, for each style (until one is picked) */
const STYLE_INSTRUMENTS: Record<SoundStyle, Record<Channel, InstrumentName>> = {
  classical: {
    chords: 'piano',
    rhythm: 'piano',
    bass: 'cello',
    lead: 'strings',
    melody: 'flute',
    click: 'piano',
    keyboard: 'piano',
  },
  electric: {
    chords: 'epiano',
    rhythm: 'electricGuitar',
    bass: 'bassGuitar',
    lead: 'synthLead',
    melody: 'voice',
    click: 'piano',
    keyboard: 'epiano',
  },
};

/** How much of the sound goes through the reverb, for each style */
const REVERB: Record<SoundStyle, number> = { classical: 0.3, electric: 0.12 };

type Voice = { gain: GainNode; nodes: AudioScheduledSourceNode[]; release: number };

const midiToFrequency = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** A concert hall: a few seconds of fading noise, a little different in each ear */
function hallImpulse(context: AudioContext, seconds = 2.4) {
  const length = Math.floor(context.sampleRate * seconds);
  const impulse = context.createBuffer(2, length, context.sampleRate);
  [0, 1].forEach((channel) => {
    const data = impulse.getChannelData(channel);
    data.forEach((_, i) => {
      data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3;
    });
  });
  return impulse;
}

/** most plucked notes kept ready (they take a moment to make) */
const MAX_PLUCKS = 80;

/** The sound of a plucked string, made once per note */
function makePluck(context: BaseAudioContext, frequency: number, pluck: Pluck) {
  const rate = context.sampleRate;
  const length = Math.floor(rate * pluck.seconds);
  const period = Math.max(2, Math.round(rate / frequency));
  const buffer = context.createBuffer(1, length, rate);
  const out = buffer.getChannelData(0);
  // the pluck: noise, smoothed for a softer attack
  const ring = new Float32Array(period);
  let previous = 0;
  ring.forEach((_, i) => {
    previous = previous * (1 - pluck.brightness) + (Math.random() * 2 - 1) * pluck.brightness;
    ring[i] = previous;
  });
  // round and round: each sample is the average of two, a little softer
  let index = 0;
  out.forEach((_, i) => {
    const next = (index + 1) % period;
    out[i] = ring[index];
    ring[index] = pluck.feedback * 0.5 * (ring[index] + ring[next]);
    index = next;
  });
  return buffer;
}

/** A soft overdrive curve (electric guitar) */
function driveCurve(amount: number) {
  const curve = new Float32Array(1024);
  curve.forEach((_, i) => {
    const x = (i / 1023) * 2 - 1;
    curve[i] = Math.tanh(x * amount) / Math.tanh(amount);
  });
  return curve;
}

class Synth {
  private context: AudioContext | null = null;

  private master: GainNode | null = null;

  private wet: GainNode | null = null;

  private volume = 0.7;

  private style: SoundStyle = 'classical';

  private channels = new Map<Channel, GainNode>();

  private channelVolumes = new Map<Channel, number>();

  /** instruments picked for the parts (the style chooses the others) */
  private channelInstruments = new Map<Channel, InstrumentName>();

  /** plucked notes made (by instrument and note) */
  private plucks = new Map<string, AudioBuffer>();

  /** notes playing or to come (to stop them all) */
  private voices = new Set<Voice>();

  /** notes held from a keyboard (one voice per key) */
  private held = new Map<number, Voice>();

  /** keys released while the sustain pedal is down */
  private sustained = new Set<number>();

  private pedal = false;

  /** The audio output, created on first use (browsers start it after a user action) */
  private output() {
    if (!this.context) {
      this.context = new AudioContext();
      const compressor = this.context.createDynamicsCompressor();
      compressor.connect(this.context.destination);
      this.master = this.context.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(compressor);
      // reverb: sent from the master, mixed back in
      const reverb = this.context.createConvolver();
      reverb.buffer = hallImpulse(this.context);
      this.wet = this.context.createGain();
      this.wet.gain.value = REVERB[this.style];
      this.master.connect(reverb);
      reverb.connect(this.wet);
      this.wet.connect(compressor);
    }
    if (this.context.state === 'suspended') this.context.resume().catch(() => {});
    return { context: this.context, master: this.master as GainNode };
  }

  /** The volume of a part (created on first use) */
  private channel(name: Channel) {
    const { context, master } = this.output();
    let gain = this.channels.get(name);
    if (!gain) {
      gain = context.createGain();
      gain.gain.value = this.channelVolumes.get(name) ?? 1;
      gain.connect(master);
      this.channels.set(name, gain);
    }
    return gain;
  }

  /** Volume from 0 to 1 */
  setVolume(volume: number) {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.master) this.master.gain.value = this.volume;
  }

  /** Volume of a part, from 0 to 1 */
  setChannelVolume(name: Channel, volume: number) {
    const value = Math.max(0, Math.min(1, volume));
    this.channelVolumes.set(name, value);
    const gain = this.channels.get(name);
    if (gain) gain.gain.value = value;
  }

  /** The instrument of a part: picked, or the style's */
  instrumentOf(channel: Channel): InstrumentName {
    return this.channelInstruments.get(channel) ?? STYLE_INSTRUMENTS[this.style][channel];
  }

  /** Picks the instrument of a part (none: the style's) */
  setChannelInstrument(channel: Channel, instrument: InstrumentName | null) {
    if (instrument) this.channelInstruments.set(channel, instrument);
    else this.channelInstruments.delete(channel);
  }

  /** The part is played by a plucked instrument (its chords are strummed) */
  isPlucked(channel: Channel) {
    return isPlucked(this.instrumentOf(channel));
  }

  setStyle(style: SoundStyle) {
    this.style = style;
    if (this.wet) this.wet.gain.value = REVERB[style];
  }

  /** A note starting at `when` (audio time), with a sound, on a part */
  private voice(midi: number, velocity: number, when: number, channel: Channel): Voice {
    const { context } = this.output();
    const instrument = this.instrumentOf(channel);
    if (isPlucked(instrument)) return this.pluckVoice(midi, velocity, when, instrument, channel);
    const tone = TONES[instrument];
    const frequency = midiToFrequency(midi);
    // softer notes are also darker
    const strength = 0.3 + 0.7 * (velocity / 127);
    const level = tone.level * strength;

    const gain = context.createGain();
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(level, when + tone.attack);
    gain.gain.setTargetAtTime(level * Math.max(0.0001, tone.sustain), when + tone.attack, 0.6);

    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    const cutoff = Math.min(tone.maxCutoff, frequency * tone.brightness * (0.5 + strength / 2));
    filter.frequency.setValueAtTime(cutoff, when);
    filter.frequency.setTargetAtTime(
      Math.max(frequency * 1.5, cutoff / 2.5),
      when + tone.attack,
      0.5
    );
    filter.connect(gain);
    gain.connect(this.channel(channel));

    const nodes: AudioScheduledSourceNode[] = [];

    // vibrato: a slow wobble of the pitch (in cents)
    let vibrato: GainNode | null = null;
    if (tone.vibrato) {
      const lfo = context.createOscillator();
      lfo.frequency.value = 5.2 + Math.random() * 0.6;
      vibrato = context.createGain();
      vibrato.gain.setValueAtTime(0, when);
      vibrato.gain.linearRampToValueAtTime(tone.vibrato, when + (tone.vibratoDelay ?? 0.3) + 0.3);
      lfo.connect(vibrato);
      lfo.start(when);
      nodes.push(lfo);
    }

    tone.partials.forEach((partial) => {
      const oscillator = context.createOscillator();
      oscillator.type = partial.type;
      oscillator.frequency.value = frequency * partial.ratio;
      if (partial.detune) oscillator.detune.value = partial.detune;
      if (vibrato) vibrato.connect(oscillator.detune);
      const partialGain = context.createGain();
      partialGain.gain.setValueAtTime(partial.amount, when);
      // each partial fades on its own (higher ones faster, higher notes faster)
      if (partial.decay) {
        const decay = partial.decay * Math.max(0.3, 1 - (midi - 48) / 80);
        partialGain.gain.setTargetAtTime(partial.amount * 0.001, when + tone.attack, decay / 3);
      }
      oscillator.connect(partialGain);
      partialGain.connect(filter);
      oscillator.start(when);
      nodes.push(oscillator);
    });

    // hammer or breath
    if (tone.noise) {
      const samples = Math.floor(context.sampleRate * tone.noise.length);
      const buffer = context.createBuffer(1, samples, context.sampleRate);
      const data = buffer.getChannelData(0);
      data.forEach((_, i) => {
        data[i] = (Math.random() * 2 - 1) * (1 - i / samples);
      });
      const noise = context.createBufferSource();
      noise.buffer = buffer;
      const band = context.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = Math.min(8000, tone.noise.frequency + frequency);
      const noiseGain = context.createGain();
      noiseGain.gain.value = tone.noise.amount * strength;
      noise.connect(band);
      band.connect(noiseGain);
      noiseGain.connect(gain);
      noise.start(when);
      nodes.push(noise);
    }

    const voice: Voice = { gain, nodes, release: tone.release };
    this.voices.add(voice);
    return voice;
  }

  /** A plucked string: its sound made once, played with a level */
  private pluckVoice(
    midi: number,
    velocity: number,
    when: number,
    instrument: PluckedName,
    channel: Channel
  ): Voice {
    const { context } = this.output();
    const pluck = PLUCKS[instrument];
    const key = `${instrument}:${midi}`;
    let buffer = this.plucks.get(key);
    if (!buffer) {
      buffer = makePluck(context, midiToFrequency(midi), pluck);
      this.plucks.set(key, buffer);
      // the oldest notes made are forgotten
      if (this.plucks.size > MAX_PLUCKS) this.plucks.delete(this.plucks.keys().next().value);
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = pluck.cutoff;
    const gain = context.createGain();
    gain.gain.setValueAtTime(pluck.level * (0.3 + 0.7 * (velocity / 127)), when);
    if (pluck.drive) {
      const shaper = context.createWaveShaper();
      shaper.curve = driveCurve(pluck.drive);
      source.connect(shaper);
      shaper.connect(filter);
    } else {
      source.connect(filter);
    }
    filter.connect(gain);
    gain.connect(this.channel(channel));
    source.start(when);
    const voice: Voice = { gain, nodes: [source], release: pluck.release };
    this.voices.add(voice);
    return voice;
  }

  private release(voice: Voice, when: number) {
    voice.gain.gain.cancelScheduledValues(when);
    voice.gain.gain.setTargetAtTime(0, when, voice.release / 4);
    const end = when + voice.release + 0.05;
    voice.nodes.forEach((node) => {
      try {
        node.stop(end);
      } catch (e) {
        // already stopped
      }
    });
    const left = (end - (this.context?.currentTime ?? 0)) * 1000;
    setTimeout(() => this.voices.delete(voice), Math.max(0, left) + 100);
  }

  /** A key is pressed (the same key pressed again restarts) */
  noteOn(midi: number, velocity = 100) {
    const { context } = this.output();
    const playing = this.held.get(midi);
    if (playing) this.release(playing, context.currentTime);
    this.sustained.delete(midi);
    this.held.set(midi, this.voice(midi, velocity, context.currentTime, 'keyboard'));
  }

  /** A key is released (held on while the sustain pedal is down) */
  noteOff(midi: number) {
    if (this.pedal) {
      this.sustained.add(midi);
      return;
    }
    const voice = this.held.get(midi);
    if (!voice || !this.context) return;
    this.release(voice, this.context.currentTime);
    this.held.delete(midi);
  }

  /** The sustain pedal: released notes ring until it is lifted */
  setPedal(down: boolean) {
    this.pedal = down;
    if (!down) {
      this.sustained.forEach((midi) => this.noteOff(midi));
      this.sustained.clear();
    }
  }

  /**
   * Notes played together for a while (seconds), e.g. a chord of a song,
   * starting now or a little later (seconds)
   */
  play(
    midis: number[],
    duration: number,
    velocity = 90,
    delay = 0,
    channel: Channel = 'chords',
    // guitars: the notes of a chord one after the other (seconds between them)
    strum = 0
  ) {
    const { context } = this.output();
    const start = context.currentTime + Math.max(0, delay);
    [...midis]
      .sort((a, b) => a - b)
      .forEach((midi, i) =>
        this.release(
          this.voice(midi, velocity, start + i * strum, channel),
          start + Math.max(0.05, duration)
        )
      );
  }

  /** A click for the beat (higher on the first beat of a bar) */
  click(accent = false) {
    const { context } = this.output();
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'square';
    oscillator.frequency.value = accent ? 1760 : 1320;
    gain.gain.setValueAtTime(accent ? 0.12 : 0.07, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
    oscillator.connect(gain);
    gain.connect(this.channel('click'));
    oscillator.start(now);
    oscillator.stop(now + 0.06);
  }

  /** Every note stops now, also the ones scheduled to come (stop, or a jump in the song) */
  stopAll() {
    if (!this.context) return;
    const now = this.context.currentTime;
    this.voices.forEach((voice) => {
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setTargetAtTime(0, now, 0.02);
      voice.nodes.forEach((node) => {
        try {
          node.stop(now + 0.1);
        } catch (e) {
          // already stopped
        }
      });
    });
    this.voices.clear();
    this.held.clear();
    this.sustained.clear();
  }
}

/** The app's built-in sound */
export const synth = new Synth();
