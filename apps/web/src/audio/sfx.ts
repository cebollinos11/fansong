/**
 * Sound effects. Every cue is a handful of recorded variants under
 * `public/sfx/` (`<cue>-<n>.mp3`; sources and licences in
 * `public/sfx/CREDITS.md`); each play picks one at random and nudges its pitch,
 * so a run of the same blow never sounds like a loop.
 *
 * Playback is Web Audio on one shared context. Browsers keep it suspended until
 * the first click or key press, so nothing plays (or downloads) before then.
 * Sound is purely cosmetic: callers fire cues as their animations reach the
 * matching frame, and a cue whose buffer isn't ready yet is simply dropped.
 */

/** The cues and how many recorded variants each has. */
const VARIANTS = {
  swing: 3,
  hit: 9,
  'heavy-hit': 5,
  clang: 4,
  armor: 5,
  bow: 4,
  'arrow-hit': 5,
  death: 5,
  gore: 1,
  thud: 3,
  grunt: 2,
  'war-cry': 2,
  step: 10,
  dice: 6,
  flag: 1,
  victory: 1,
  select: 1,
  press: 1,
  turnover: 1,
  alarm: 1,
  score: 1,
  capture: 1,
  round: 1,
  guard: 1,
  defeat: 1,
} as const;

export type Cue = keyof typeof VARIANTS;

/** The mix: each cue's level against the others (the files are all peak-normalised). */
const LEVEL: Record<Cue, number> = {
  swing: 0.35,
  hit: 0.6,
  'heavy-hit': 0.75,
  clang: 0.55,
  armor: 0.55,
  bow: 0.5,
  'arrow-hit': 0.5,
  death: 0.55,
  gore: 0.6,
  thud: 0.6,
  grunt: 0.45,
  'war-cry': 0.6,
  step: 0.12,
  dice: 0.4,
  flag: 0.5,
  victory: 0.6,
  select: 0.35,
  press: 0.25,
  turnover: 0.45,
  alarm: 0.5,
  score: 0.5,
  capture: 0.55,
  round: 0.4,
  guard: 0.4,
  defeat: 0.5,
};

/** How far a play may drift from the recording's pitch, either way (a fraction). */
const PITCH_JITTER = 0.06;
/** At most this many plays of one cue may start together; a crowd of footsteps stays a patter. */
const MAX_VOICES = 3;
/** "Together": within this many ms of each other. */
const VOICE_WINDOW_MS = 40;
/** A cue still loading when it was asked for plays late only within this window, else it's dropped. */
const LATE_MS = 120;

const MUTED_KEY = 'fansong.sfxMuted';
const VOLUME_KEY = 'fansong.sfxVolume';
const DEFAULT_VOLUME = 0.7;

export interface PlayOptions {
  /** Scales the cue's level (1 = as mixed). */
  volume?: number;
  /** Playback rate before jitter: below 1 is slower and deeper. */
  rate?: number;
}

type Listener = () => void;

class SoundBoard {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly buffers = new Map<string, AudioBuffer | null>();
  private readonly loading = new Map<string, Promise<AudioBuffer | null>>();
  private readonly recent = new Map<Cue, number[]>();
  private readonly listeners = new Set<Listener>();
  private mutedFlag = load(MUTED_KEY) === '1';
  private volumeLevel = clamp01(Number(load(VOLUME_KEY) ?? DEFAULT_VOLUME), DEFAULT_VOLUME);

  constructor() {
    if (typeof window === 'undefined') return;
    // Browsers only let audio start from a user gesture; the first one wakes it.
    const unlock = () => {
      if (!this.wake()) return;
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
    };
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
  }

  get muted(): boolean {
    return this.mutedFlag;
  }

  get volume(): number {
    return this.volumeLevel;
  }

  setMuted(muted: boolean): void {
    this.mutedFlag = muted;
    save(MUTED_KEY, muted ? '1' : '0');
    this.applyGain();
    this.changed();
  }

  setVolume(volume: number): void {
    this.volumeLevel = clamp01(volume, DEFAULT_VOLUME);
    save(VOLUME_KEY, String(this.volumeLevel));
    this.applyGain();
    this.changed();
  }

  /** Called whenever mute or volume changes (for the sound controls). */
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Play one variant of `cue` now. Silent while muted, locked or still loading. */
  play(cue: Cue, opts: PlayOptions = {}): void {
    if (this.mutedFlag || this.volumeLevel === 0) return;
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || !this.master) return;
    if (!this.claimVoice(cue)) return;
    const url = sfxUrl(cue, Math.floor(Math.random() * VARIANTS[cue]));
    const asked = performance.now();
    const start = (buffer: AudioBuffer | null) => {
      if (!buffer || !this.master || performance.now() - asked > LATE_MS) return;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = (opts.rate ?? 1) * (1 + (Math.random() * 2 - 1) * PITCH_JITTER);
      const gain = ctx.createGain();
      gain.gain.value = LEVEL[cue] * (opts.volume ?? 1);
      source.connect(gain).connect(this.master);
      source.start();
    };
    const ready = this.buffers.get(url);
    if (ready !== undefined) start(ready);
    else void this.fetch(url).then(start);
  }

  /** Start (or resume) the audio context; true once it is running or can't exist. */
  private wake(): boolean {
    const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return true;
    if (!this.ctx) {
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.applyGain();
      this.preload();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx.state !== 'suspended';
  }

  private preload(): void {
    for (const cue of Object.keys(VARIANTS) as Cue[]) {
      for (let i = 0; i < VARIANTS[cue]; i++) void this.fetch(sfxUrl(cue, i));
    }
  }

  private fetch(url: string): Promise<AudioBuffer | null> {
    const pending = this.loading.get(url);
    if (pending) return pending;
    const ctx = this.ctx;
    const promise = !ctx
      ? Promise.resolve(null)
      : fetch(url)
          .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(`${res.status} ${url}`))))
          .then((data) => ctx.decodeAudioData(data))
          .catch((err: unknown) => {
            console.warn('sound effect failed to load', err);
            return null;
          });
    this.loading.set(url, promise);
    void promise.then((buffer) => this.buffers.set(url, buffer));
    return promise;
  }

  private claimVoice(cue: Cue): boolean {
    const now = performance.now();
    const starts = (this.recent.get(cue) ?? []).filter((t) => now - t < VOICE_WINDOW_MS);
    if (starts.length >= MAX_VOICES) return false;
    starts.push(now);
    this.recent.set(cue, starts);
    return true;
  }

  private applyGain(): void {
    if (this.master) this.master.gain.value = this.mutedFlag ? 0 : this.volumeLevel;
  }

  private changed(): void {
    for (const fn of this.listeners) fn();
  }
}

function sfxUrl(cue: Cue, variant: number): string {
  return `${import.meta.env.BASE_URL}sfx/${cue}-${variant}.mp3`;
}

function clamp01(x: number, fallback: number): number {
  return Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : fallback;
}

function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function save(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not remembered; the setting still holds for this session.
  }
}

/** The game's one sound board. */
export const sfx = new SoundBoard();
