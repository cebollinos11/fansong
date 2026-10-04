import {
  EMPTY_MANIFEST,
  pickTake,
  resolvePlayable,
  sfxCue,
  STOCK_CLIPS,
  stockFile,
  takeFile,
  type SfxManifest,
  type SfxName,
  type StockClip,
} from './sfxCues.js';

/**
 * The game's sound effects: recordings from `public/sfx/`, played through Web
 * Audio. A cue not recorded yet plays its stock clip if it has one (see
 * `STOCK`), else nothing, so callers just name the cue.
 * The browser only lets sound start after a click or a key, so the first
 * effects of a page opened straight into a game may go unheard.
 */

const PREFS_KEY = 'fansong.sound';
/** The same cue asked for again this soon (a row of nerve checks, a group's footsteps) plays once. */
const REPEAT_GUARD_MS = 45;
/** Each play is pitched a hair up or down, so a repeated take doesn't sound stamped out. */
const PITCH_SPREAD = 0.05;
const AMBIENCE_FADE_S = 1.2;
/**
 * Ambience (a loop under the whole game, per backdrop) is switched off for now:
 * the user didn't like it. The player below is kept, so turning this back on
 * plays a recorded `amb-*` take, or a stock loop added to `STOCK`.
 */
const AMBIENCE_ON = false;

export interface PlayOptions {
  volume?: number;
  /** Playback speed (and pitch): under 1 for slow motion. */
  rate?: number;
}

/**
 * What the recording booth is trying out against the board: the one cue that
 * plays through the hush, from `takes` when it has some not yet saved, shifted
 * by `delayMs` in place of the delay on disk. `played` counts how often it has.
 */
export interface Audition {
  name: string;
  takes?: AudioBuffer[];
  delayMs: number;
  played: number;
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
  /** Stock clips never change, so unlike the takes they survive a reload. */
  private readonly stock = new Map<string, AudioBuffer>();
  private readonly stockLoading = new Map<string, Promise<AudioBuffer | null>>();
  private stockRequested = false;
  private readonly lastPlay = new Map<string, { take: number; at: number }>();
  private readonly listeners = new Set<() => void>();
  private prefs: Prefs | null = null;
  private started = false;
  /** While set, nothing plays: the recording booth has the microphone open. */
  hush = false;
  audition: Audition | null = null;
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
      this.manifest = { version: json.version ?? 0, takes: json.takes ?? {}, delays: json.delays ?? {} };
    } catch {
      this.manifest = EMPTY_MANIFEST;
    }
    this.buffers.clear();
    this.loading.clear();
    for (const [name, count] of Object.entries(this.manifest.takes)) {
      for (let take = 1; take <= count; take++) void this.load(name, take);
    }
    this.loadStock();
    this.playAmbience(this.wantAmbient, true);
    this.notify();
  }

  /** Whether `name` plays a stock clip, for now: nothing down its chain is recorded but a stock sound fits. */
  stockFor(name: string): StockClip | null {
    return resolvePlayable(name, this.manifest)?.stock ?? null;
  }

  /** How many takes of `name` itself are recorded. */
  recorded(name: string): number {
    return this.manifest.takes[name] ?? 0;
  }

  play(name: SfxName, opts: PlayOptions = {}): void {
    const ctx = this.context();
    const audition = this.audition;
    const fresh = audition?.takes?.length ? audition.takes : null;
    // Takes the booth has not saved yet count as recorded, so they are found down a chain of stand-ins too.
    const takes = fresh ? { ...this.manifest.takes, [audition!.name]: fresh.length } : this.manifest.takes;
    const found = resolvePlayable(name, { ...this.manifest, takes });
    if (!ctx || !this.master || !found || ctx.state !== 'running') return;
    // A stock clip is only ever a stand-in: never what the booth is auditioning.
    const playing = found.cue;
    const stock: StockClip | undefined = found.stock;
    const auditioned = !stock && audition !== null && playing === audition.name;
    if (!auditioned && (this.muted || this.hush)) return;
    const key = stock ? `stock:${stock}` : playing;
    const last = this.lastPlay.get(key);
    const now = performance.now();
    if (last && now - last.at < REPEAT_GUARD_MS) return;
    const take = pickTake(stock ? STOCK_CLIPS[stock].count : (takes[playing] ?? 0), last?.take);
    const buffer = stock
      ? this.stock.get(stockFile(stock, take))
      : auditioned && fresh
        ? fresh[take - 1]
        : this.buffers.get(takeFile(playing, take));
    if (!buffer) {
      // Still loading; an ambience loop only starts loading now, to be heard next time.
      if (stock) void this.loadStockFile(stockFile(stock, take));
      return;
    }
    this.lastPlay.set(key, { take, at: now });
    const rate = Math.max(0.3, Math.min(2, opts.rate ?? 1));
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate * (1 + (Math.random() * 2 - 1) * PITCH_SPREAD);
    const gain = ctx.createGain();
    // The loudness is the cue that was asked for's, even when a stand-in plays.
    gain.gain.value = (opts.volume ?? 1) * (sfxCue(name)?.gain ?? 1) * (stock ? STOCK_CLIPS[stock].level : 1);
    // An audition is heard even with the game's sound switched off.
    source.connect(gain).connect(auditioned && this.muted ? ctx.destination : this.master);
    // A delay tuned in the booth belongs to a recording; stock clips start on their moment.
    const delayMs = auditioned ? audition.delayMs : stock ? 0 : (this.manifest.delays?.[playing] ?? 0);
    // Late by the board's clock (longer in slow motion), or early by skipping into the recording.
    if (delayMs >= 0) source.start(ctx.currentTime + delayMs / 1000 / rate);
    else source.start(0, Math.min(buffer.duration, -delayMs / 1000));
    if (auditioned) audition.played += 1;
  }

  /** Loop `name` under everything else (null for silence), fading from whatever was looping. */
  playAmbience(name: SfxName | string | null, restart = false): void {
    if (!AMBIENCE_ON) name = null;
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
    const found = name && !this.ambient && !this.hush ? resolvePlayable(name, this.manifest) : null;
    if (!name || !found) return;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.master);
    const ambient: NonNullable<Sfx['ambient']> = { name, gain, source: null };
    this.ambient = ambient;
    const level = (sfxCue(name)?.gain ?? 1) * (found.stock ? STOCK_CLIPS[found.stock].level : 1);
    const loading = found.stock ? this.loadStockFile(stockFile(found.stock, 1)) : this.load(found.cue, 1);
    void loading.then((buffer) => {
      if (!buffer || this.ambient !== ambient) return;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.connect(gain);
      source.start();
      ambient.source = source;
      gain.gain.setTargetAtTime(level, ctx.currentTime, AMBIENCE_FADE_S / 3);
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

  /** Fetch every stock clip once (about a megabyte), except the ambience loops, fetched when first played. */
  private loadStock(): void {
    if (!this.context() || this.stockRequested) return;
    this.stockRequested = true;
    for (const [clip, set] of Object.entries(STOCK_CLIPS) as [StockClip, (typeof STOCK_CLIPS)[StockClip]][]) {
      if ('loop' in set) continue;
      for (let take = 1; take <= set.count; take++) void this.loadStockFile(stockFile(clip, take));
    }
  }

  private loadStockFile(file: string): Promise<AudioBuffer | null> {
    const known = this.stockLoading.get(file);
    if (known) return known;
    const ctx = this.context();
    const request = !ctx
      ? Promise.resolve(null)
      : fetch(`${import.meta.env.BASE_URL}sfx/${file}`)
          .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(`${res.status}`))))
          .then((data) => ctx.decodeAudioData(data))
          .then((buffer) => {
            this.stock.set(file, buffer);
            return buffer;
          })
          .catch(() => null);
    this.stockLoading.set(file, request);
    return request;
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
