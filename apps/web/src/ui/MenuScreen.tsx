import { useEffect, useRef, useState } from 'react';
import { newRun, PRESET_IDS, PRESETS, type RunState } from '@fansong/content';
import { browserStorage } from '../game/customMaps.js';
import { addRunRecord, loadRun, loadRunRecords, pastWarbands, runRecord, type RunRecord } from '../game/runStore.js';
import { animationsFor, framesOf, type Clip } from '../three/unitAnimations.js';
import { spriteFor, spriteUrl } from '../three/unitSprites.js';
import { InstallPrompt } from './InstallPrompt.js';
import { tintedSpriteUrl } from './Picker.js';
import { RunRecords } from './RunScreen.js';
import { freshRunSeed, runMenuItem, runSeedFrom } from './runView.js';
import type { Mode } from './SetupScreen.js';
import { UpdateCheck } from './UpdateCheck.js';

interface Props {
  /** Open the setup for a way to play. */
  onPlay: (mode: Mode) => void;
  onOpenEditor: () => void;
  onOpenArmies: () => void;
  /** Play a run: the saved one picked back up, or a new one. */
  onRun: (run: RunState) => void;
  /** With `?dev=1` in the URL: open the preset unit editor. */
  onOpenPresets?: () => void;
}

/** A warband as it stands beside the menu: its leader in front, up to two others behind. */
interface MenuTeam {
  leader: string;
  rank: string[];
}

/** The first three different-looking units of a preset, as sprite paths. */
function teamOf(presetId: string): MenuTeam {
  const sprites = [...new Set(PRESETS[presetId]!.units.map((u) => spriteFor(u.look ?? u.name)))];
  return { leader: sprites[0]!, rank: sprites.slice(1, 3) };
}

/** Two different preset warbands, picked at random. */
function pickMatchup(): [string, string] {
  const ids = [...PRESET_IDS];
  const take = (): string => ids.splice(Math.floor(Math.random() * ids.length), 1)[0]!;
  return [take(), take()];
}

/** The matchup shown last time, so the next visit to the menu never repeats it. */
let lastMatchup = '';
function freshMatchup(): [MenuTeam, MenuTeam] {
  let pair = pickMatchup();
  while (pair.join() === lastMatchup) pair = pickMatchup();
  lastMatchup = pair.join();
  return [teamOf(pair[0]), teamOf(pair[1])];
}

const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The first screen: pick a way to play, or open one of the workshop tools. */
export function MenuScreen({ onPlay, onOpenEditor, onOpenArmies, onRun, onOpenPresets }: Props): JSX.Element {
  const [[home, away]] = useState(freshMatchup);
  const units = [...home.rank, home.leader, away.leader, ...away.rank];
  // Every so often one unit, picked at random, takes a swing.
  const [strike, setStrike] = useState({ unit: '', n: 0 });
  useEffect(() => {
    if (reducedMotion()) return;
    const timer = setTimeout(
      () => setStrike({ unit: units[Math.floor(Math.random() * units.length)]!, n: strike.n + 1 }),
      900 + Math.random() * 1300,
    );
    return () => clearTimeout(timer);
  }, [strike]);
  const strikeOf = (path: string): number => (strike.unit === path ? strike.n : 0);
  // The run in progress, if one is saved: the run button picks it back up.
  const [savedRun] = useState(() => loadRun(browserStorage()));
  const [newRunOpen, setNewRunOpen] = useState(false);
  const runItem = runMenuItem(savedRun);

  return (
    <div className="menu">
      <header className="menu-head">
        <h1>FanSong</h1>
        <p>You go, I go. A skirmish of blades and dice.</p>
      </header>

      <div className="menu-scene" aria-hidden="true">
        <div className="menu-team">
          <div className="menu-rank">
            {home.rank.map((path) => (
              <MenuUnit key={path} path={path} strike={strikeOf(path)} />
            ))}
          </div>
          <MenuUnit path={home.leader} strike={strikeOf(home.leader)} leader />
        </div>
        <div className="menu-team">
          <MenuUnit path={away.leader} strike={strikeOf(away.leader)} leader flip />
          <div className="menu-rank">
            {away.rank.map((path) => (
              <MenuUnit key={path} path={path} strike={strikeOf(path)} flip />
            ))}
          </div>
        </div>
      </div>

      <nav className="menu-actions">
        <div className="menu-play">
          <button className="menu-item primary" onClick={() => onPlay('vsAI')}>
            <strong>Play vs AI</strong>
            <span>Solo battle</span>
          </button>
          <button className="menu-item" onClick={() => (savedRun ? onRun(savedRun) : setNewRunOpen(true))}>
            <strong>{runItem.title}</strong>
            <span>{runItem.detail}</span>
          </button>
          {savedRun ? (
            <button className="menu-sub" onClick={() => setNewRunOpen(true)}>
              Start a new run…
            </button>
          ) : null}
          <button className="menu-item" onClick={() => onPlay('online')}>
            <strong>Online</strong>
            <span>Create or join a room</span>
          </button>
        </div>
        <div className="menu-workshop">
          <h2>Workshop</h2>
          <div className="menu-tools">
            <button onClick={onOpenArmies}>Army builder</button>
            <button onClick={onOpenEditor}>Map editor</button>
            {onOpenPresets ? (
              <button title="Dev tool: edit the preset warbands and export them" onClick={onOpenPresets}>
                Preset units
              </button>
            ) : null}
          </div>
        </div>
        <UpdateCheck />
      </nav>

      <p className="menu-foot">A fan project. Game design inspired by the wargame <em>Song of Blades and Heroes</em>. Unit art from Battle for Wesnoth (GPL).</p>

      <InstallPrompt />
      {newRunOpen ? <NewRunDialog saved={savedRun} onStart={onRun} onClose={() => setNewRunOpen(false)} /> : null}
    </div>
  );
}

/**
 * Starting a run: an optional seed (the same seed meets the same offers,
 * enemies and battlefields), and the best runs so far. Starting one over a
 * saved run gives that run up, which the dialog says first.
 */
function NewRunDialog({ saved, onStart, onClose }: { saved: RunState | null; onStart: (run: RunState) => void; onClose: () => void }): JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null);
  const [seedText, setSeedText] = useState('');
  const [records] = useState<RunRecord[]>(() => loadRunRecords(browserStorage()));
  const seed = runSeedFrom(seedText, 0);

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
  }, []);

  const start = (): void => {
    const picked = runSeedFrom(seedText, freshRunSeed());
    if (picked === null) return;
    // A run given up with battles won still counts among the best.
    const past = saved && saved.log.length > 0 ? addRunRecord(browserStorage(), runRecord(saved, 'abandoned')) : records;
    // Warbands of runs gone by come back as enemies.
    onStart(newRun(picked, pastWarbands(past)));
  };

  return (
    <dialog
      ref={dialog}
      className="picker-dialog run-dialog"
      aria-label="New run"
      onClose={onClose}
      // A click on the dialog itself (not its contents) is a click on the backdrop.
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <form
        className="picker-body"
        onSubmit={(e) => {
          e.preventDefault();
          start();
        }}
      >
        <header className="picker-head">
          <h3>New run</h3>
          <button type="button" className="ghost" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="picker-scroll run-dialog-body">
          <p>Draft a warband, then fight battle after battle against a growing enemy. You pick your road up a map of battles and safe stops to the boss at its top: a harder fight pays better, a stop is safe, and the enemy grows with every step either way. Each win brings experience, a reward and gold to spend. One lost battle ends the run.</p>
          {saved ? <p className="error">This gives up the run you have in progress (step {saved.round}, seed {saved.seed}).</p> : null}
          <label className="run-seed-field">
            Seed
            <input
              inputMode="numeric"
              placeholder="random"
              value={seedText}
              aria-invalid={seed === null}
              onChange={(e) => setSeedText(e.target.value)}
            />
          </label>
          <p className="hint">
            {seed === null ? 'A seed is a whole number.' : 'Optional. The same seed meets the same offers, enemies and battlefields.'}
          </p>
          <button type="submit" className="primary" disabled={seed === null}>
            Start the run
          </button>
          <RunRecords records={records} />
        </div>
      </form>
    </dialog>
  );
}

/**
 * A unit standing on a grass hex. It loops its standing clip if it has one, and
 * plays a melee swing each time `strike` changes to a new non-zero value. A
 * `big` unit stands taller, as on the board; a `tint` recolours every frame.
 */
export function MenuUnit({
  path,
  strike,
  leader = false,
  flip = false,
  big = false,
  tint,
}: {
  path: string;
  strike: number;
  leader?: boolean;
  flip?: boolean;
  big?: boolean;
  tint?: string;
}): JSX.Element {
  const [frame, setFrame] = useState(path);
  const [striking, setStriking] = useState(false);
  // Tinted copies of the frames, by frame path, once they are ready.
  const [tinted, setTinted] = useState<{ key: string; urls: Record<string, string> }>({ key: '', urls: {} });
  const tintKey = `${tint}:${path}`;

  // Fetch every frame up front, so a clip's first play doesn't flicker.
  useEffect(() => {
    if (!tint) {
      for (const p of framesOf(path)) new Image().src = spriteUrl(p);
      return;
    }
    let live = true;
    const frames = framesOf(path);
    void Promise.all(frames.map((p) => tintedSpriteUrl(spriteUrl(p), tint))).then(
      (urls) => live && setTinted({ key: tintKey, urls: Object.fromEntries(frames.map((p, i) => [p, urls[i]!])) }),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [path, tint, tintKey]);

  useEffect(() => {
    if (reducedMotion()) return;
    const anims = animationsFor(path);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const play = (clip: Clip, i: number, done: () => void): void => {
      const step = clip.frames[i];
      if (!step) return done();
      setFrame(step[0]);
      timer = setTimeout(() => play(clip, i + 1, done), step[1]);
    };
    const rest = (): void => {
      setStriking(false);
      const standing = anims.standing;
      if (standing && standing.frames.length > 1) play(standing, 0, rest);
      else setFrame(path);
    };
    const swings = anims.melee ?? [];
    if (strike > 0 && swings.length > 0) {
      setStriking(true);
      play(swings[Math.floor(Math.random() * swings.length)]!, 0, rest);
    } else {
      rest();
    }
    return () => clearTimeout(timer);
  }, [path, strike]);

  const classes = ['menu-sprite', flip ? 'flip' : '', striking ? 'striking' : ''].filter(Boolean).join(' ');
  // Until the tinted copies are ready, show the plain sprite rather than nothing.
  const src = (tinted.key === tintKey ? tinted.urls[frame] : undefined) ?? spriteUrl(frame);
  return (
    <div className={['menu-unit', leader ? 'leader' : '', big ? 'big' : ''].filter(Boolean).join(' ')}>
      <img className="menu-hex" src={`${import.meta.env.BASE_URL}sprites/terrain/grass/green.png`} alt="" />
      <img className={classes} src={src} alt="" />
    </div>
  );
}
