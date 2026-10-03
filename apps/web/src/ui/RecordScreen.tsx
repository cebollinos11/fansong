import { useCallback, useEffect, useRef, useState } from 'react';
import { sfx } from '../audio/sfx.js';
import { MicRecorder, TAIL_SKIP_MS } from '../audio/recorder.js';
import { SFX_CUES, takeFile, type SfxCue } from '../audio/sfxCues.js';
import { cutTake, encodeWav, findTakes, resample, TAKE_RATE, type TakeRange } from '../audio/takes.js';

/**
 * The recording booth (`?dev=1&record`): every sound effect in one sitting. It
 * shows one cue at a time and listens; make the sound, press Space, and that
 * stretch of microphone is cut into takes and saved under the cue's name by the
 * dev server. Nothing has to be named or chopped up afterwards, because the
 * booth always knows which cue it was asking for.
 *
 * A long recording made elsewhere can be dropped in instead: it is cut into its
 * sounds, and the booth walks the same list over them, a cue at a time.
 */

const HEARD_EVERY_MS = 250;
const PLAYBACK_GAP_S = 0.25;

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
  const [index, setIndex] = useState(0);
  const [mic, setMic] = useState<Mic>({ state: 'off' });
  const [tape, setTape] = useState<Tape | null>(null);
  const [heard, setHeard] = useState(0);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const meter = useRef<HTMLDivElement>(null);
  const cue = SFX_CUES[index]!;
  const recorder = mic.state === 'on' ? mic.mic : null;

  // What is already on disk; the session picks up at the first cue without a recording.
  useEffect(() => {
    let cancelled = false;
    fetch(`${import.meta.env.BASE_URL}sfx/manifest.json`, { cache: 'no-store' })
      .then((res) => (res.ok ? (res.json() as Promise<{ takes?: Record<string, number> }>) : {}))
      .catch(() => ({}))
      .then((json: { takes?: Record<string, number> }) => {
        if (cancelled) return;
        const takes = json.takes ?? {};
        setRecorded(takes);
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
    return () => {
      sfx.hush = false;
      void sfx.reload();
    };
  }, []);

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

  /** Play back what the current cue would save (or, with nothing new, what it has saved already). */
  const playBack = useCallback(() => {
    const ctx = sfx.context();
    const a = audio();
    if (!ctx) return;
    void ctx.resume();
    const takes = a ? findTakes(a.samples, a.rate, cue.takes) : [];
    // The microphone must not hear its own playback.
    if (recorder) recorder.paused = true;
    const resume = (until: number) =>
      setTimeout(() => {
        if (recorder) recorder.paused = false;
      }, Math.max(0, until - ctx.currentTime) * 1000);
    if (!a || takes.length === 0) {
      void playSaved(ctx, cue.name, recorded?.[cue.name] ?? 0).then(resume);
      return;
    }
    let at = ctx.currentTime + 0.05;
    for (const range of takes) {
      const cut = cutTake(a.samples, range, a.rate);
      const buffer = ctx.createBuffer(1, cut.length, a.rate);
      buffer.getChannelData(0).set(cut);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(at);
      at += buffer.duration + PLAYBACK_GAP_S;
    }
    resume(at);
  }, [audio, cue, recorded, recorder]);

  /** Save the current cue's takes (if it heard any) and bring up the next cue. */
  const saveAndNext = useCallback(async () => {
    if (busy) return;
    const a = audio(TAIL_SKIP_MS);
    const ranges = a ? findTakes(a.samples, a.rate, cue.takes) : [];
    if (a && ranges.length > 0) {
      setBusy(true);
      try {
        const takes = ranges.slice(0, 8).map((r) => base64(encodeWav(resample(cutTake(a.samples, r, a.rate), a.rate, TAKE_RATE), TAKE_RATE)));
        const res = await fetch(`/__sfx/${cue.name}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ takes }),
        });
        if (!res.ok) throw new Error(await res.text());
        const manifest = (await res.json()) as { takes: Record<string, number> };
        setRecorded(manifest.takes);
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
      if (ev.target instanceof HTMLInputElement) return;
      const act: Record<string, () => void> = {
        ' ': () => void saveAndNext(),
        Enter: playBack,
        Backspace: redo,
        ArrowRight: () => goTo(index + 1),
        ArrowLeft: () => goTo(index - 1),
        ArrowUp: () => setTape((t) => (t ? { ...t, span: t.span + 1 } : t)),
        ArrowDown: () => setTape((t) => (t ? { ...t, span: Math.max(1, t.span - 1) } : t)),
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
  }, [saveAndNext, playBack, redo, goTo, index]);

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
              <kbd>Space</kbd> save and next · <kbd>Enter</kbd> play it back · <kbd>Backspace</kbd>{' '}
              {tape ? 'skip a sound on the tape' : 'start this one again'} · <kbd>←</kbd> <kbd>→</kbd> move without saving
              {tape ? (
                <>
                  {' '}
                  · <kbd>↑</kbd> <kbd>↓</kbd> take more or fewer sounds
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
