import { EMPTY_MANIFEST, pickTake, resolveSfx, sfxCue, takeFile, type SfxManifest, type SfxName } from './sfxCues.js';

/**
 * The game's sound effects: recordings from `public/sfx/`, played through Web
 * Audio. Anything not recorded yet is silent, so callers just name the cue.
 * The browser only lets sound start after a click or a key, so the first
 * effects of a page opened straight into a game may go unheard.
 */

const PREFS_KEY = 'fansong.sound';
/** The same cue asked for again this soon (a row of nerve checks, a group's footsteps) plays once. */
const REPEAT_GUARD_MS = 45;
/** Each play is pitched a hair up or down, so a repeated take doesn't sound stamped out. */
const PITCH_SPREAD = 0.05;
const AMBIENCE_FADE_S = 1.2;

export interface PlayOptions {
  volume?: number;
  /** Playback speed (and pitch): under 1 for slow motion. */
  rate?: number;
}

interface Prefs {
  volume: number;
  muted: boolean;
}

function loadPrefs(): Prefs {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>;
    const volume = typeof saved.volume === 'number' && saved.volume >= 0 && saved.volume <= 1 ? saved.volume : 0.8;
    return { volume, muted: saved.muted === true };
  } catch {
    return { volume: 0.8, muted: false };
  }
}

class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private manifest: SfxManifest = EMPTY_MANIFEST;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly loading = new Map<string, Promise<AudioBuffer | null>>();
  private readonly lastPlay = new Map<string, { take: number; at: number }>();
  private readonly listeners = new Set<() => void>();
  private prefs: Prefs | null = null;
  private started = false;
  /** While set, nothing plays: the recording booth has the microphone open. */
  hush = false;
  private ambient: { name: string; gain: GainNode; source: AudioBufferSourceNode | null } | null = null;
  private wantAmbient: string | null = null;

  /** Load what has been recorded and start listening for buttons. Safe to call again. */
  start(): void {
    if (this.started) return;
    this.started = true;
    const wake = () => void this.context()?.resume();
    window.addEventListener('pointerdown', wake, true);
    window.addEventListener('keydown', wake, true);
    document.addEventListener(
      'click',
      (ev) => {
        if (onButton(ev.target)) this.play('ui-click');
      },
      true,
    );
    let over: Element | null = null;
    document.addEventListener(
      'pointerover',
      (ev) => {
        const button = onButton(ev.target);
        if (button && button !== over && ev.pointerType === 'mouse') this.play('ui-hover');
        over = button;
      },
      true,
    );
    void this.reload();
  }

  /** Read the manifest again (the booth has just saved something) and load what it lists. */
  async reload(): Promise<void> {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}sfx/manifest.json`, { cache: 'no-store' });
      const json = res.ok ? ((await res.json()) as Partial<SfxManifest>) : {};
      this.manifest = { version: json.version ?? 0, takes: json.takes ?? {} };
    } catch {
      this.manifest = EMPTY_MANIFEST;
    }
    this.buffers.clear();
    this.loading.clear();
    for (const [name, count] of Object.entries(this.manifest.takes)) {
      for (let take = 1; take <= count; take++) void this.load(name, take);
    }
    this.playAmbience(this.wantAmbient, true);
    this.notify();
  }

  /** How many takes of `name` itself are recorded. */
  recorded(name: string): number {
    return this.manifest.takes[name] ?? 0;
  }

  play(name: SfxName, opts: PlayOptions = {}): void {
    const ctx = this.context();
    const playing = resolveSfx(name, this.manifest);
    if (!ctx || !this.master || !playing || this.muted || this.hush || ctx.state !== 'running') return;
    const last = this.lastPlay.get(playing);
    const now = performance.now();
    if (last && now - last.at < REPEAT_GUARD_MS) return;
    const take = pickTake(this.manifest.takes[playing] ?? 0, last?.take);
    const buffer = this.buffers.get(takeFile(playing, take));
    if (!buffer) return; // still loading
    this.lastPlay.set(playing, { take, at: now });
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = Math.max(0.3, Math.min(2, opts.rate ?? 1)) * (1 + (Math.random() * 2 - 1) * PITCH_SPREAD);
    const gain = ctx.createGain();
    // The loudness is the cue that was asked for's, even when a stand-in plays.
    gain.gain.value = (opts.volume ?? 1) * (sfxCue(name)?.gain ?? 1);
    source.connect(gain).connect(this.master);
    source.start();
  }

  /** Loop `name` under everything else (null for silence), fading from whatever was looping. */
  playAmbience(name: SfxName | string | null, restart = false): void {
    this.wantAmbient = name;
    const ctx = this.context();
    if (!ctx || !this.master) return;
    if (this.ambient && (this.ambient.name !== name || restart)) {
      const old = this.ambient;
      this.ambient = null;
      old.gain.gain.setTargetAtTime(0, ctx.currentTime, AMBIENCE_FADE_S / 3);
      setTimeout(() => {
        old.source?.stop();
        old.gain.disconnect();
      }, AMBIENCE_FADE_S * 1000);
    }
    if (!name || this.ambient || this.recorded(name) === 0) return;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.master);
    const ambient: NonNullable<Sfx['ambient']> = { name, gain, source: null };
    this.ambient = ambient;
    void this.load(name, 1).then((buffer) => {
      if (!buffer || this.ambient !== ambient) return;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.connect(gain);
      source.start();
      ambient.source = source;
      gain.gain.setTargetAtTime(sfxCue(name)?.gain ?? 1, ctx.currentTime, AMBIENCE_FADE_S / 3);
    });
  }

  get volume(): number {
    return (this.prefs ??= loadPrefs()).volume;
  }

  get muted(): boolean {
    return (this.prefs ??= loadPrefs()).muted;
  }

  setVolume(volume: number): void {
    this.savePrefs({ volume: Math.max(0, Math.min(1, volume)), muted: false });
  }

  setMuted(muted: boolean): void {
    this.savePrefs({ volume: this.volume, muted });
  }

  /** Call `fn` whenever the volume, the mute or the set of recordings changes. Returns the unsubscribe. */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** The shared audio context (the booth records and plays back through it too); null where there is no Web Audio. */
  context(): AudioContext | null {
    if (this.ctx || typeof AudioContext === 'undefined') return this.ctx;
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(this.ctx.destination);
    return this.ctx;
  }

  private savePrefs(prefs: Prefs): void {
    this.prefs = prefs;
    if (this.master) this.master.gain.value = prefs.muted ? 0 : prefs.volume;
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // Not remembered; the control still works for this session.
    }
    this.notify();
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }

  private load(name: string, take: number): Promise<AudioBuffer | null> {
    const file = takeFile(name, take);
    const known = this.loading.get(file);
    if (known) return known;
    const ctx = this.context();
    const version = this.manifest.version;
    const request = !ctx
      ? Promise.resolve(null)
      : fetch(`${import.meta.env.BASE_URL}sfx/${file}?v=${version}`)
          .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(`${res.status}`))))
          .then((data) => ctx.decodeAudioData(data))
          .then((buffer) => {
            if (this.manifest.version === version) this.buffers.set(file, buffer);
            return buffer;
          })
          .catch(() => null);
    this.loading.set(file, request);
    return request;
  }
}

/** The button (or thing that acts as one) `target` is on, if any. */
function onButton(target: EventTarget | null): Element | null {
  return target instanceof Element ? target.closest('button:not(:disabled), [role="button"]') : null;
}

export const sfx = new Sfx();
