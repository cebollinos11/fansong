import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createGame, reduce, type GameEvent, type GameState, type Owner } from '@fansong/engine';
import { sfx, type Audition } from '../audio/sfx.js';
import { MicRecorder, TAIL_SKIP_MS } from '../audio/recorder.js';
import { MAX_SFX_DELAY_MS, SFX_CUES, takeFile, type SfxCue, type SfxManifest } from '../audio/sfxCues.js';
import { cutTake, encodeWav, findTakes, resample, TAKE_RATE, type TakeRange } from '../audio/takes.js';
import { stageScene } from '../game/effectDemos.js';
import { soundScene } from '../game/soundScenes.js';
import { BoardCanvas } from './BoardCanvas.js';

/**
 * The recording booth (`?dev=1&record`): every sound effect in one sitting. It
 * shows one cue at a time and listens; make the sound, press Space, and that
 * stretch of microphone is cut into takes and saved under the cue's name by the
 * dev server. Nothing has to be named or chopped up afterwards, because the
 * booth always knows which cue it was asking for.
 *
 * Above the cue is the moment of the game it belongs to, staged on a real
 * board. Playing a take back plays that moment with the take in it, at the
 * instant the game would play it, and the timing control shifts it either way.
 *
 * A long recording made elsewhere can be dropped in instead: it is cut into its
 * sounds, and the booth walks the same list over them, a cue at a time.
 */

const HEARD_EVERY_MS = 250;
const PLAYBACK_GAP_S = 0.25;
/** A staged scene is shown this long (its sprites load meanwhile) before it plays. */
const SCENE_LEAD_MS = 700;
/** The microphone stays shut this long after a scene's last animation, for the sound's tail. */
const SCENE_TAIL_MS = 600;
const DELAY_STEP_MS = 10;
const DELAY_SAVE_MS = 400;
/** The booth watches from the first side's seat, so its loss is a defeat. */
const SEATS: readonly Owner[] = [0];
const NO_IDS: string[] = [];
const noop = () => {};

/** An empty table for the scenes to be staged on. */
function sceneBoard(): GameState {
  const unit = { name: 'Elvish Fighter', quality: 3, combat: 3 };
  return createGame({
    seed: 1,
    board: { width: 12, height: 10 },
    warbands: [[{ ...unit, pos: { x: 0, y: 0 } }], [{ ...unit, pos: { x: 11, y: 9 } }]],
  });
}

/** Takes are saved by the dev server into the repo, so a deployed build has nowhere to put them. */
const NO_SAVE = 'This is the deployed site, which cannot save recordings. Run the web dev server and open the booth at http://localhost:5173/?dev=1&record.';

/** A recording made elsewhere, cut into its sounds; `at` is the first one not yet used. */
interface Tape {
  samples: Float32Array;
  rate: number;
  sounds: TakeRange[];
  at: number;
  /** How many sounds the current cue takes from it. */
  span: number;
}

type Mic = { state: 'off' } | { state: 'asking' } | { state: 'on'; mic: MicRecorder } | { state: 'failed'; why: string };

export function RecordScreen({ onExit }: { onExit: () => void }): JSX.Element {
  const [recorded, setRecorded] = useState<Record<string, number> | null>(null);
  const [delays, setDelays] = useState<Record<string, number>>({});
  const [index, setIndex] = useState(0);
  const [mic, setMic] = useState<Mic>({ state: 'off' });
  const [tape, setTape] = useState<Tape | null>(null);
  const [heard, setHeard] = useState(0);
  const [note, setNote] = useState(import.meta.env.DEV ? '' : NO_SAVE);
  const [busy, setBusy] = useState(false);
  const meter = useRef<HTMLDivElement>(null);
  const cue = SFX_CUES[index]!;
  const recorder = mic.state === 'on' ? mic.mic : null;
  const delay = delays[cue.name] ?? 0;

  const table = useMemo(sceneBoard, []);
  const scene = useMemo(() => soundScene(cue.name), [cue]);
  const [board, setBoard] = useState<{ state: GameState; events: GameEvent[] }>(() => ({ state: table, events: [] }));
  /** The scene being played: its audition, and whether its command has been set off yet. */
  const run = useRef<{ audition: Audition; started: boolean } | null>(null);
  const sceneTimer = useRef<number>();
  const delayTimers = useRef(new Map<string, number>());

  // What is already on disk; the session picks up at the first cue without a recording.
  useEffect(() => {
    let cancelled = false;
    fetch(`${import.meta.env.BASE_URL}sfx/manifest.json`, { cache: 'no-store' })
      .then((res) => (res.ok ? (res.json() as Promise<Partial<SfxManifest>>) : {}))
      .catch(() => ({}))
      .then((json: Partial<SfxManifest>) => {
        if (cancelled) return;
        const takes = json.takes ?? {};
        setRecorded(takes);
        setDelays(json.delays ?? {});
        const first = SFX_CUES.findIndex((c) => !takes[c.name]);
        setIndex(first < 0 ? 0 : first);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The game's own sounds stay out of the microphone while the booth is open.
  useEffect(() => {
    sfx.hush = true;
    // The board started its backdrop's ambience as it mounted.
    sfx.playAmbience(null);
    return () => {
      sfx.hush = false;
      sfx.audition = null;
      void sfx.reload();
    };
  }, []);

  /** Stop whatever scene is playing and let the microphone hear again. */
  const endScene = useCallback(() => {
    window.clearTimeout(sceneTimer.current);
    run.current = null;
    if (recorder) recorder.paused = false;
  }, [recorder]);
  useEffect(() => endScene, [endScene]);

  // Each cue comes up with its scene laid out, waiting to be played.
  useEffect(() => {
    endScene();
    if (!scene) return;
    try {
      setBoard({ state: stageScene(table, scene).state, events: [] });
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    }
  }, [scene, table, endScene]);

  /** The board has started (or cut short) a batch of animations lasting `ms`. */
  const onScenePlayed = useCallback(
    (ms: number) => {
      const playing = run.current;
      if (!playing?.started) return;
      window.clearTimeout(sceneTimer.current);
      sceneTimer.current = window.setTimeout(
        () => {
          if (run.current !== playing) return;
          if (playing.audition.played === 0) {
            setNote(
              playing.audition.takes || recorded?.[playing.audition.name]
                ? `That scene never played ${playing.audition.name}: another recording stood in for it.`
                : `Nothing recorded for ${playing.audition.name} yet, so the scene played without it.`,
            );
          }
          endScene();
        },
        ms > 0 ? ms + SCENE_TAIL_MS : 0,
      );
    },
    [endScene, recorded],
  );

  /** Shift the current cue against the board, and (on the dev server) keep that in the manifest. */
  const setDelay = useCallback(
    (ms: number) => {
      const name = cue.name;
      const next = Math.max(-MAX_SFX_DELAY_MS, Math.min(MAX_SFX_DELAY_MS, Math.round(ms)));
      setDelays((d) => ({ ...d, [name]: next }));
      window.clearTimeout(delayTimers.current.get(name));
      if (!import.meta.env.DEV) return;
      delayTimers.current.set(
        name,
        window.setTimeout(() => {
          fetch(`/__sfx/${name}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ delayMs: next }),
          })
            .then(async (res) => {
              if (!res.ok) throw new Error((await res.text()) || `the server answered ${res.status}`);
            })
            .catch((err) => setNote(`Could not save the timing of ${name}: ${err instanceof Error ? err.message : String(err)}`));
        }, DELAY_SAVE_MS),
      );
    },
    [cue],
  );

  useEffect(() => () => recorder?.close(), [recorder]);

  /** The audio the current cue would be cut from: the microphone since the cue came up, or its share of the tape. */
  const audio = useCallback(
    (tailMs = 0): { samples: Float32Array; rate: number } | null => {
      if (tape) {
        const sounds = tape.sounds.slice(tape.at, tape.at + tape.span);
        if (sounds.length === 0) return null;
        return { samples: tape.samples.slice(sounds[0]!.start, sounds[sounds.length - 1]!.end), rate: tape.rate };
      }
      return recorder ? { samples: recorder.audio(tailMs), rate: recorder.rate } : null;
    },
    [tape, recorder],
  );

  // The level meter and the count of takes heard so far.
  useEffect(() => {
    if (!recorder || tape) return;
    let frame = 0;
    const draw = () => {
      if (meter.current) meter.current.style.width = `${Math.min(100, Math.sqrt(recorder.level) * 140)}%`;
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    const count = setInterval(() => setHeard(findTakes(recorder.audio(), recorder.rate, cue.takes).length), HEARD_EVERY_MS);
    return () => {
      cancelAnimationFrame(frame);
      clearInterval(count);
    };
  }, [recorder, tape, cue]);

  useEffect(() => {
    if (!tape) return;
    const a = audio();
    setHeard(a ? findTakes(a.samples, a.rate, cue.takes).length : 0);
  }, [tape, audio, cue]);

  const goTo = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(SFX_CUES.length - 1, next));
      setIndex(clamped);
      setHeard(0);
      recorder?.restart();
      setTape((t) => (t ? { ...t, span: SFX_CUES[clamped]!.takes } : t));
    },
    [recorder],
  );

  const startMic = useCallback(async () => {
    const ctx = sfx.context();
    if (!ctx || !navigator.mediaDevices) return setMic({ state: 'failed', why: 'This browser cannot record.' });
    setMic({ state: 'asking' });
    try {
      setMic({ state: 'on', mic: await MicRecorder.open(ctx) });
      setTape(null);
      setNote('');
    } catch (err) {
      setMic({ state: 'failed', why: err instanceof Error ? err.message : String(err) });
    }
  }, []);

  const loadTape = useCallback(
    async (file: File) => {
      const ctx = sfx.context();
      if (!ctx) return;
      try {
        const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
        const samples = buffer.getChannelData(0).slice();
        const sounds = findTakes(samples, buffer.sampleRate, 2);
        setTape({ samples, rate: buffer.sampleRate, sounds, at: 0, span: cue.takes });
        setNote(`${file.name}: ${sounds.length} sounds found. Each cue takes the next ones in order.`);
      } catch {
        setNote(`${file.name} is not an audio file this browser can read.`);
      }
    },
    [cue],
  );

  /**
   * Play back what the current cue would save (or, with nothing new, what it has
   * saved already): in its scene when it has one, else one take after another.
   */
  const playBack = useCallback(() => {
    const ctx = sfx.context();
    const a = audio();
    if (!ctx) return;
    void ctx.resume();
    const takes = a ? findTakes(a.samples, a.rate, cue.takes) : [];
    const buffers = takes.map((range) => {
      const cut = cutTake(a!.samples, range, a!.rate);
      const buffer = ctx.createBuffer(1, cut.length, a!.rate);
      buffer.getChannelData(0).set(cut);
      return buffer;
    });
    endScene();
    // The microphone must not hear its own playback.
    if (recorder) recorder.paused = true;
    if (scene) {
      try {
        const staged = stageScene(table, scene);
        const playing = { audition: { name: cue.name, takes: buffers.length > 0 ? buffers : undefined, delayMs: delay, played: 0 }, started: false };
        run.current = playing;
        sfx.audition = playing.audition;
        setNote('');
        setBoard({ state: staged.state, events: [] });
        sceneTimer.current = window.setTimeout(() => {
          const result = reduce(staged.state, staged.command);
          playing.started = true;
          setBoard({ state: result.state, events: result.events });
        }, SCENE_LEAD_MS);
        return;
      } catch (err) {
        setNote(err instanceof Error ? err.message : String(err));
      }
    }
    const resume = (until: number) =>
      setTimeout(() => {
        if (recorder && !run.current) recorder.paused = false;
      }, Math.max(0, until - ctx.currentTime) * 1000);
    if (buffers.length === 0) {
      void playSaved(ctx, cue.name, recorded?.[cue.name] ?? 0).then(resume);
      return;
    }
    let at = ctx.currentTime + 0.05;
    for (const buffer of buffers) {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(at);
      at += buffer.duration + PLAYBACK_GAP_S;
    }
    resume(at);
  }, [audio, cue, delay, endScene, recorded, recorder, scene, table]);

  /** Save the current cue's takes (if it heard any) and bring up the next cue. */
  const saveAndNext = useCallback(async () => {
    if (busy) return;
    const a = audio(TAIL_SKIP_MS);
    const ranges = a ? findTakes(a.samples, a.rate, cue.takes) : [];
    if (a && ranges.length > 0) {
      setBusy(true);
      try {
        if (!import.meta.env.DEV) throw new Error(NO_SAVE);
        const takes = ranges.slice(0, 8).map((r) => base64(encodeWav(resample(cutTake(a.samples, r, a.rate), a.rate, TAKE_RATE), TAKE_RATE)));
        const res = await fetch(`/__sfx/${cue.name}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ takes }),
        });
        if (!res.ok) throw new Error((await res.text()) || `the server answered ${res.status}`);
        const manifest = (await res.json()) as { takes: Record<string, number> };
        setRecorded(manifest.takes);
        // So the scene plays the takes now on disk.
        void sfx.reload();
        setNote(`Saved ${cue.name}: ${takes.length} ${takes.length === 1 ? 'take' : 'takes'}.`);
        setTape((t) => (t ? { ...t, at: t.at + t.span } : t));
      } catch (err) {
        setNote(`Could not save ${cue.name}: ${err instanceof Error ? err.message : String(err)}`);
        setBusy(false);
        return;
      }
      setBusy(false);
    }
    goTo(index + 1);
  }, [audio, busy, cue, goTo, index]);

  /** Throw away what was just heard and listen again (on a tape: skip its next sound). */
  const redo = useCallback(() => {
    recorder?.restart();
    setHeard(0);
    setTape((t) => (t ? { ...t, at: Math.min(t.sounds.length, t.at + 1) } : t));
  }, [recorder]);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.target instanceof HTMLInputElement && ev.target.type !== 'range') return;
      const act: Record<string, () => void> = {
        ' ': () => void saveAndNext(),
        Enter: playBack,
        Backspace: redo,
        ArrowRight: () => goTo(index + 1),
        ArrowLeft: () => goTo(index - 1),
        ArrowUp: () => setTape((t) => (t ? { ...t, span: t.span + 1 } : t)),
        ArrowDown: () => setTape((t) => (t ? { ...t, span: Math.max(1, t.span - 1) } : t)),
        '-': () => setDelay(delay - DELAY_STEP_MS),
        '=': () => setDelay(delay + DELAY_STEP_MS),
        '+': () => setDelay(delay + DELAY_STEP_MS),
      };
      const fn = act[ev.key];
      if (!fn) return;
      // The key must not also press whichever button was clicked last.
      ev.preventDefault();
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      fn();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saveAndNext, playBack, redo, goTo, index, setDelay, delay]);

  const live = recorder !== null || tape !== null;
  const done = recorded ? SFX_CUES.filter((c) => recorded[c.name]).length : 0;

  return (
    <div className="booth">
      <header className="booth-head">
        <h1>Recording booth</h1>
        <span className="booth-progress">
          {done} of {SFX_CUES.length} sounds recorded
        </span>
        <button type="button" className="ghost" onClick={onExit}>
          ⟵ Back
        </button>
      </header>

      <main className="booth-stage">
        {scene ? (
          <div className="booth-board">
            <BoardCanvas
              state={board.state}
              events={board.events}
              onEventsPlayed={onScenePlayed}
              reach={[]}
              attackTargetIds={NO_IDS}
              selectableUnitIds={NO_IDS}
              selectedUnitId={null}
              interactive={false}
              localSeats={SEATS}
              onUnitClick={noop}
              onCellClick={noop}
              liveTerrain
              playing
              spectating
            />
            <div className="booth-scene">{scene.label}</div>
          </div>
        ) : null}
        <div className="booth-tier">
          Tier {cue.tier} · {cue.group} · {index + 1} of {SFX_CUES.length}
        </div>
        <div className="booth-name">{cue.name}</div>
        <div className="booth-when">{cue.when}</div>
        <div className="booth-idea">{cue.idea}</div>
        <div className="booth-want">
          {cue.takes === 1
            ? 'Once. Pauses inside the sound are fine.'
            : `${cue.takes} times, with half a second of quiet between each.`}
          {recorded?.[cue.name] ? ` (Already recorded: ${recorded[cue.name]} on disk. Recording again replaces them.)` : ''}
        </div>

        {scene ? (
          <div className="booth-delay">
            <span>Timing</span>
            <button type="button" className="ghost" title="Earlier (−)" onClick={() => setDelay(delay - DELAY_STEP_MS)}>
              −
            </button>
            <input
              type="range"
              min={-MAX_SFX_DELAY_MS}
              max={MAX_SFX_DELAY_MS}
              step={DELAY_STEP_MS}
              value={delay}
              onChange={(ev) => setDelay(Number(ev.target.value))}
              onPointerUp={(ev) => ev.currentTarget.blur()}
            />
            <button type="button" className="ghost" title="Later (+)" onClick={() => setDelay(delay + DELAY_STEP_MS)}>
              +
            </button>
            <output title={delay < 0 ? 'A sound cannot start before its moment, so this much of its start is skipped instead.' : undefined}>
              {delay === 0 ? 'on its moment' : delay > 0 ? `${delay} ms later` : `${-delay} ms earlier`}
            </output>
            {delay !== 0 ? (
              <button type="button" className="ghost" onClick={() => setDelay(0)}>
                Reset
              </button>
            ) : null}
          </div>
        ) : (
          <div className="booth-tip">No scene plays this one, so Enter plays it on its own.</div>
        )}

        {live ? (
          <>
            {tape ? (
              <div className="booth-tape">
                Sounds {tape.at + 1}–{Math.min(tape.sounds.length, tape.at + tape.span)} of {tape.sounds.length} on the tape
              </div>
            ) : (
              <div className="booth-meter">
                <div ref={meter} />
              </div>
            )}
            <div className={`booth-heard${heard >= cue.takes ? ' enough' : ''}`}>
              {heard === 0 ? 'Listening…' : `Heard ${heard} ${heard === 1 ? 'take' : 'takes'}`}
            </div>
            <div className="booth-keys">
              <kbd>Space</kbd> save and next · <kbd>Enter</kbd> {scene ? 'play it in the scene' : 'play it back'} · <kbd>Backspace</kbd>{' '}
              {tape ? 'skip a sound on the tape' : 'start this one again'} · <kbd>←</kbd> <kbd>→</kbd> move without saving
              {tape ? (
                <>
                  {' '}
                  · <kbd>↑</kbd> <kbd>↓</kbd> take more or fewer sounds
                </>
              ) : null}
              {scene ? (
                <>
                  {' '}
                  · <kbd>−</kbd> <kbd>+</kbd> earlier or later
                </>
              ) : null}
            </div>
            {tape ? null : <p className="booth-tip">Wait a beat after your last sound before pressing Space, so the key isn't in it.</p>}
          </>
        ) : (
          <div className="booth-start">
            <button type="button" disabled={mic.state === 'asking'} onClick={() => void startMic()}>
              {mic.state === 'asking' ? 'Waiting for the microphone…' : 'Start the microphone'}
            </button>
            <label className="booth-file">
              or use a recording made elsewhere
              <input type="file" accept="audio/*" onChange={(ev) => ev.target.files?.[0] && void loadTape(ev.target.files[0])} />
            </label>
            {mic.state === 'failed' ? <p className="error">No microphone: {mic.why}</p> : null}
            <p className="booth-tip">
              Headphones off is fine; the game is silent while the booth is open. A recording made elsewhere should follow
              the list on the right in order, with a clear pause between sounds.
            </p>
          </div>
        )}
        <div className="booth-note">{note}</div>
      </main>

      <aside className="booth-list">
        {groupsOf(SFX_CUES).map(([title, cues]) => (
          <div key={title}>
            <div className="booth-list-title">{title}</div>
            {cues.map((c) => (
              <button
                key={c.name}
                type="button"
                className={`booth-cue${c === cue ? ' current' : ''}${recorded?.[c.name] ? ' done' : ''}`}
                onClick={() => goTo(SFX_CUES.indexOf(c))}
              >
                <span>{recorded?.[c.name] ? '✓' : '·'}</span>
                {c.name}
                {c.takes > 1 ? <em>×{c.takes}</em> : null}
              </button>
            ))}
          </div>
        ))}
      </aside>
    </div>
  );
}

/** The cues under their headings, in the booth's order. */
function groupsOf(cues: readonly SfxCue[]): [string, SfxCue[]][] {
  const groups = new Map<string, SfxCue[]>();
  for (const cue of cues) {
    const title = `Tier ${cue.tier} · ${cue.group}`;
    groups.set(title, [...(groups.get(title) ?? []), cue]);
  }
  return [...groups];
}

/** Play a cue's saved takes one after another, straight from disk. Resolves to when (on the context's clock) the last one ends. */
async function playSaved(ctx: AudioContext, name: string, count: number): Promise<number> {
  let at = ctx.currentTime + 0.05;
  for (let take = 1; take <= count; take++) {
    const res = await fetch(`${import.meta.env.BASE_URL}sfx/${takeFile(name, take)}`, { cache: 'no-store' });
    if (!res.ok) continue;
    const buffer = await ctx.decodeAudioData(await res.arrayBuffer());
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    at = Math.max(at, ctx.currentTime + 0.05);
    source.start(at);
    at += buffer.duration + PLAYBACK_GAP_S;
  }
  return at;
}

function base64(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}
