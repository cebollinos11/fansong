import { useEffect, useMemo, useState } from 'react';
import {
  configFromSetup,
  DEFAULT_BOARD,
  DEFAULT_MAP_ID,
  defaultKing,
  defaultPigRounds,
  getMap,
  PRESET_IDS,
  PRESETS,
  randomSeed,
  type MapDef,
  type MapLookup,
  type MatchSetup,
  type Warband,
} from '@fansong/content';
import { MODE_RULES, type GameLimits, type GameMode, type Owner } from '@fansong/engine';
import { normalizeRoomCode, ROOM_CODE_LENGTH } from '@fansong/protocol';
import type { Launch } from '../game/launch.js';
import { ArmyBuilderOverlay } from './ArmyBuilderScreen.js';
import { builderStart, choiceAfterBuilder } from './armyView.js';
import { browserStorage, customMapLookup, playableCustomMaps } from '../game/customMaps.js';
import { choiceWarband, isArmyChoice, playableArmies, type SavedArmy } from '../game/armies.js';
import { loadSetupPrefs, saveSetupPrefs } from '../game/setupPrefs.js';
import { limitsForMode, type LimitsByMode } from '../game/limits.js';
import { FaceOffSetup, type SetupModel } from './FaceOffSetup.js';
import { kingIn, modesOf } from './setupView.js';

interface Props {
  initial: MatchSetup;
  /** The way to play, picked on the main menu. */
  mode: Mode;
  onStart: (launch: Launch) => void;
  /** Back to the main menu. */
  onBack: () => void;
  /** With `?dev=1` in the URL: open the sandbox, starting from the chosen warbands and map. */
  onOpenSandbox?: (setup: MatchSetup) => void;
}

export type Mode = 'vsAI' | 'hotseat' | 'online';
/** The modes played in this browser, set up entirely on this screen. */
export type LocalMode = Exclude<Mode, 'online'>;

/** Shown for a side that names nothing known (pickers only offer known ones). */
const FALLBACK_PRESET = PRESET_IDS[0]!;

/** The game mode + (kill-the-king) chosen Kings, as picked on the setup screen. */
export interface GameChoice {
  mode: GameMode;
  /** Index into each preset's units of its King; only used in kill-the-king. */
  kings?: [number, number];
  /** The seat escorting the Pig; only used in the golden Pig mode. */
  escort?: Owner;
  /** Custom round limit / target score for the chosen mode. */
  limits?: GameLimits;
}

/**
 * The local launch for the chosen options. The default map and annihilation are
 * left implicit (no `mapId`/`mode`) so default setups stay byte-identical to
 * pre-map ones; Kings are only carried in kill-the-king, and the escort (when
 * it isn't player 0) in the golden Pig mode.
 *
 * `sides` are preset ids or saved-army choices (`army:<id>`, looked up in
 * `armies`). When either side is a saved army both rosters are written out as
 * `warbands` (the army side labelled `custom`); all-preset setups are unchanged.
 */
export function launchFor(
  mode: LocalMode,
  sides: [string, string],
  seed: number,
  mapId: string = DEFAULT_MAP_ID,
  game: GameChoice = { mode: 'annihilation' },
  armies: readonly SavedArmy[] = [],
): Extract<Launch, { kind: 'local' }> {
  const kings = game.mode === 'kill-the-king' ? game.kings : undefined;
  const presets: [string, string] = [sideLabel(sides[0]), sideLabel(sides[1])];
  const warbands = explicitWarbands(sides, armies);
  const seats = mode === 'vsAI' ? (['human', 'ai'] as const) : (['human', 'human'] as const);
  const setup: MatchSetup = { presets, seats: [seats[0], seats[1]], seed };
  if (warbands) setup.warbands = warbands;
  // The flat default board carries no objectives, so an objective mode names the map.
  if (mapId !== DEFAULT_MAP_ID || MODE_RULES[game.mode].requires) setup.mapId = mapId;
  if (game.mode !== 'annihilation') setup.mode = game.mode;
  if (kings) setup.kings = kings;
  if (game.mode === 'golden-pig' && game.escort) setup.escort = game.escort;
  const limits = limitsForMode(game.mode, game.limits);
  if (limits) setup.limits = limits;
  return { kind: 'local', setup };
}

/** A side's `presets` label: its preset id, or `custom` for a saved army. */
export function sideLabel(choice: string): string {
  return isArmyChoice(choice) ? 'custom' : choice;
}

/** Both sides' rosters if either is a saved army, else `undefined` (presets suffice). */
function explicitWarbands(sides: [string, string], armies: readonly SavedArmy[]): [Warband, Warband] | undefined {
  if (!sides.some(isArmyChoice)) return undefined;
  const w0 = choiceWarband(sides[0], armies);
  const w1 = choiceWarband(sides[1], armies);
  if (!w0 || !w1) throw new Error(`unknown army "${w0 ? sides[1] : sides[0]}"`);
  return [w0, w1];
}

/**
 * Why a local launch can't start, or `null` if it can: the exact match build the
 * game runs, so it also catches an army too big for the whole map.
 */
export function launchProblem(launch: Extract<Launch, { kind: 'local' }>, lookup: MapLookup): string | null {
  try {
    configFromSetup(launch.setup, DEFAULT_BOARD, lookup);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** `wanted` if the map supports it, else annihilation (which every map does). */
export function modeFor(map: MapDef, wanted: GameMode): GameMode {
  return modesOf(map).includes(wanted) ? wanted : 'annihilation';
}

const MODE_TITLES: Record<Mode, string> = {
  vsAI: 'Play vs AI',
  hotseat: 'Hotseat',
  online: 'Online with a friend',
};

export function SetupScreen({ initial, mode, onStart, onBack, onOpenSandbox }: Props): JSX.Element {
  // The choices made last time on this screen, where they are still on offer.
  const [saved] = useState(() => loadSetupPrefs(browserStorage()));
  // A new seed per visit, so each battle rolls its own coin toss and its own dice
  // (the Advanced box still takes one by hand, to play a match again exactly).
  const [seed, setSeed] = useState(randomSeed);
  // Custom maps saved from the editor (read once; the editor is a separate screen).
  const [customMaps] = useState(() => playableCustomMaps(browserStorage()));
  // Saved army-builder armies that can be played; read again whenever the
  // builder, which this screen can open, hands control back.
  const [armies, setArmies] = useState(() => playableArmies(browserStorage()));
  // The side whose army is being built in front of this screen, if any.
  const [builderFor, setBuilderFor] = useState<Owner | null>(null);
  const unitsIn = (choice: string, list: readonly SavedArmy[]) =>
    (choiceWarband(choice, list) ?? PRESETS[FALLBACK_PRESET]!).units;
  const unitsOf = (choice: string) => unitsIn(choice, armies);
  const savedSide = (owner: 0 | 1): string | undefined => {
    const choice = saved.sides?.[owner];
    return choice !== undefined && choiceWarband(choice, armies) ? choice : undefined;
  };
  const [p0, setP0] = useState(() => savedSide(0) ?? initial.presets[0]);
  const [p1, setP1] = useState(() => savedSide(1) ?? initial.presets[1]);
  const [mapId, setMapId] = useState(() => {
    const id = saved.mapId ?? initial.mapId ?? DEFAULT_MAP_ID;
    return getMap(id) || customMaps.some((m) => m.id === id) ? id : DEFAULT_MAP_ID;
  });
  const [wantedMode, setWantedMode] = useState<GameMode>(saved.gameMode ?? initial.mode ?? 'annihilation');
  const [kings, setKings] = useState<[number, number]>(() => {
    // A side's saved King only if that side's saved warband came back and still has that unit.
    const king = (owner: 0 | 1, side: string): number => {
      const k = savedSide(owner) === side ? saved.kings?.[owner] : initial.kings?.[owner];
      return k !== undefined && k < unitsOf(side).length ? k : defaultKing(unitsOf(side));
    };
    return [king(0, p0), king(1, p1)];
  });
  const [escort, setEscort] = useState<Owner>(saved.escort ?? initial.escort ?? 0);
  const [limitsByMode, setLimitsByMode] = useState<LimitsByMode>(() => saved.limits ?? {});
  useEffect(() => {
    saveSetupPrefs(browserStorage(), { mode, sides: [p0, p1], mapId, gameMode: wantedMode, kings, escort, limits: limitsByMode });
  }, [mode, p0, p1, mapId, wantedMode, kings, escort, limitsByMode]);
  // The map played and a mode it supports.
  const playedMap = getMap(mapId) ?? customMaps.find((m) => m.id === mapId) ?? getMap(DEFAULT_MAP_ID)!;
  const gameMode = modeFor(playedMap, wantedMode);

  const pickPreset = (owner: 0 | 1, id: string) => {
    (owner === 0 ? setP0 : setP1)(id);
    setKings((k) => (owner === 0 ? [defaultKing(unitsOf(id)), k[1]] : [k[0], defaultKing(unitsOf(id))]));
  };
  const pickKing = (owner: 0 | 1, i: number) => setKings((k) => (owner === 0 ? [i, k[1]] : [k[0], i]));
  const localMode: LocalMode = mode === 'online' ? 'hotseat' : mode;
  const limits = limitsByMode[gameMode];
  // Checking a launch builds the whole match, so only do it when a choice changes.
  const [mapLookup] = useState(() => customMapLookup(browserStorage()));
  const launch = useMemo(
    () => launchFor(localMode, [p0, p1], Number.isFinite(seed) ? seed : 0, playedMap.id, { mode: gameMode, kings, escort, limits }, armies),
    [localMode, p0, p1, seed, playedMap, gameMode, kings, escort, limits, armies],
  );
  const problem = useMemo(() => launchProblem(launch, mapLookup), [launch, mapLookup]);
  const start = () => onStart(launch);

  /** The warband a side falls back on when the one it had stops being playable. */
  const fallbackSide = (owner: 0 | 1): string =>
    PRESETS[initial.presets[owner]] ? initial.presets[owner] : FALLBACK_PRESET;

  /**
   * The army builder hands control back: take in whatever it saved, field the
   * army it was told to use, and leave both sides on a warband that can still
   * be played — either of them can have been edited or deleted in there.
   */
  const closeBuilder = (used: string | null): void => {
    const owner = builderFor;
    setBuilderFor(null);
    if (owner === null) return;
    const next = playableArmies(browserStorage());
    setArmies(next);
    const sides: [string, string] = [
      choiceAfterBuilder(p0, owner === 0 ? used : null, next, fallbackSide(0)),
      choiceAfterBuilder(p1, owner === 1 ? used : null, next, fallbackSide(1)),
    ];
    setP0(sides[0]);
    setP1(sides[1]);
    // A side that changed warbands crowns that one's own King; a side that kept
    // its warband keeps its King, unless the roster under it grew shorter.
    setKings(([k0, k1]) => [
      sides[0] === p0 ? kingIn(unitsIn(sides[0], next), k0) : defaultKing(unitsIn(sides[0], next)),
      sides[1] === p1 ? kingIn(unitsIn(sides[1], next), k1) : defaultKing(unitsIn(sides[1], next)),
    ]);
  };

  if (mode !== 'online') {
    const model: SetupModel = {
      title: MODE_TITLES[mode],
      names: localMode === 'vsAI' ? ['You', 'AI'] : ['Player 1', 'Player 2'],
      sides: [p0, p1],
      warbands: [choiceWarband(p0, armies) ?? PRESETS[FALLBACK_PRESET]!, choiceWarband(p1, armies) ?? PRESETS[FALLBACK_PRESET]!],
      armies,
      // One player at this browser arranges both warbands.
      mine: [true, true],
      pickSide: pickPreset,
      kings,
      pickKing,
      openBuilder: (owner) => setBuilderFor(owner),
      map: playedMap,
      customMaps,
      pickMap: setMapId,
      gameMode,
      pickMode: setWantedMode,
      escort,
      setEscort,
      limits,
      setLimits: (next) => setLimitsByMode((all) => ({ ...all, [gameMode]: next })),
      defaultRounds: gameMode === 'golden-pig' ? defaultPigRounds(playedMap, escort) : undefined,
      seed: { value: seed, set: setSeed },
      openSandbox: onOpenSandbox && problem === null ? () => onOpenSandbox(launch.setup) : undefined,
      problem,
      go: { label: 'Start battle', onClick: start },
      onBack,
      backLabel: '⟵ Menu',
    };
    return (
      <>
        <FaceOffSetup model={model} />
        {builderFor !== null ? (
          <ArmyBuilderOverlay
            start={builderStart(builderFor === 0 ? p0 : p1)}
            backLabel="⟵ Back to setup"
            onUse={closeBuilder}
            onExit={() => closeBuilder(null)}
          />
        ) : null}
      </>
    );
  }

  // Creating or joining a room, in the same look as the room it leads to.
  return (
    <div className="muster muster-plain">
      <header className="muster-top">
        <button type="button" className="muster-back" onClick={onBack}>
          ⟵ Menu
        </button>
        <h1>{MODE_TITLES[mode]}</h1>
      </header>
      <div className="muster-plain-body">
        <OnlinePanel onStart={onStart} />
      </div>
    </div>
  );
}

/** Online: create a room to share, or join a friend's by its code. */
function OnlinePanel({ onStart }: { onStart: (launch: Launch) => void }): JSX.Element {
  const [code, setCode] = useState('');
  const join = normalizeRoomCode(code);
  return (
    <div className="online-panel">
      <p className="hint">
        Create a room and send the code (or link) to a friend, or enter the code they sent you. Once you're both in
        the room, you each pick your army and the host picks the map and game mode.
      </p>
      <button type="button" className="muster-start" onClick={() => onStart({ kind: 'online', code: null })}>
        Create a room
      </button>
      <form
        className="join-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (join.length === ROOM_CODE_LENGTH) onStart({ kind: 'online', code: join });
        }}
      >
        <input
          aria-label="Room code"
          placeholder="Room code"
          value={code}
          maxLength={ROOM_CODE_LENGTH + 4}
          autoCapitalize="characters"
          spellCheck={false}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
        />
        <button type="submit" disabled={join.length !== ROOM_CODE_LENGTH}>
          Join room
        </button>
      </form>
    </div>
  );
}

