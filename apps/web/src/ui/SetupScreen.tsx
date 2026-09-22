import { useRef, useState } from 'react';
import {
  configFromSetup,
  DEFAULT_BOARD,
  DEFAULT_MAP_ID,
  defaultKing,
  getMap,
  listMaps,
  PRESET_IDS,
  PRESETS,
  supportedModes,
  validateArmy,
  validateWarband,
  warbandCost,
  type MapDef,
  type MapLookup,
  type MatchSetup,
  type Warband,
} from '@fansong/content';
import { GAME_MODES, type GameMode, type Replay } from '@fansong/engine';
import type { Launch } from '../game/launch.js';
import { parseReplay } from '../game/replay-io.js';
import { MODE_LABELS } from './editorView.js';
import { browserStorage, customMapLookup, playableCustomMaps } from '../game/customMaps.js';
import { armyChoice, choiceWarband, isArmyChoice, playableArmies, type SavedArmy } from '../game/armies.js';

interface Props {
  initial: MatchSetup;
  onStart: (launch: Launch) => void;
  onLoadReplay: (replay: Replay) => void;
  onOpenEditor: () => void;
  onOpenArmies: () => void;
}

export type Mode = 'vsAI' | 'hotseat' | 'online';

/** Shown for a side that names nothing known (pickers only offer known ones). */
const FALLBACK_PRESET = PRESET_IDS[0]!;

/** The game mode + (kill-the-king) chosen Kings, as picked on the setup screen. */
export interface GameChoice {
  mode: GameMode;
  /** Index into each preset's units of its King; only used in kill-the-king. */
  kings?: [number, number];
}

/**
 * The launch for the chosen options. The default map and annihilation are left
 * implicit (no `mapId`/`mode`) so default setups stay byte-identical to pre-map
 * ones; Kings are only carried in kill-the-king. Online matches carry built-in
 * maps only — the worker can't resolve a browser's custom maps, so a custom pick
 * falls back to the default board there (see {@link effectiveMapId}).
 *
 * `sides` are preset ids or saved-army choices (`army:<id>`, looked up in
 * `armies`). When either side is a saved army both rosters are written out as
 * `warbands` (the army side labelled `custom`); all-preset setups are unchanged.
 * Online, side 0 is your army and side 1 only a stand-in: the opponent brings
 * their own.
 */
export function launchFor(
  mode: Mode,
  sides: [string, string],
  seed: number,
  mapId: string = DEFAULT_MAP_ID,
  game: GameChoice = { mode: 'annihilation' },
  armies: readonly SavedArmy[] = [],
): Launch {
  const kings = game.mode === 'kill-the-king' ? game.kings : undefined;
  const presets: [string, string] = [sideLabel(sides[0]), sideLabel(sides[1])];
  const warbands = explicitWarbands(sides, armies);
  if (mode === 'online') {
    const launch: Launch = { kind: 'online', presets, seed };
    if (warbands) launch.warbands = warbands;
    if (mapId !== DEFAULT_MAP_ID && getMap(mapId)) launch.mapId = mapId;
    if (game.mode !== 'annihilation') launch.gameMode = game.mode;
    if (kings) launch.kings = kings;
    return launch;
  }
  const seats = mode === 'vsAI' ? (['human', 'ai'] as const) : (['human', 'human'] as const);
  const setup: MatchSetup = { presets, seats: [seats[0], seats[1]], seed };
  if (warbands) setup.warbands = warbands;
  if (mapId !== DEFAULT_MAP_ID) setup.mapId = mapId;
  if (game.mode !== 'annihilation') setup.mode = game.mode;
  if (kings) setup.kings = kings;
  return { kind: 'local', setup };
}

/** A side's `presets` label: its preset id, or `custom` for a saved army. */
function sideLabel(choice: string): string {
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
 * Why a launch can't start, or `null` if it can: the exact match build the game
 * runs, so it also catches an army too big for the map's deploy zone. Online
 * only your own army is really checked (the server checks the opponent's).
 */
export function launchProblem(launch: Launch, lookup: MapLookup): string | null {
  const setup: MatchSetup =
    launch.kind === 'local'
      ? launch.setup
      : {
          presets: launch.presets,
          seats: ['human', 'human'],
          seed: launch.seed,
          ...(launch.warbands ? { warbands: launch.warbands } : {}),
          ...(launch.mapId ? { mapId: launch.mapId } : {}),
          ...(launch.gameMode ? { mode: launch.gameMode } : {}),
          ...(launch.kings ? { kings: launch.kings } : {}),
        };
  try {
    configFromSetup(setup, DEFAULT_BOARD, lookup);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** The map a match will actually use: online play is limited to built-in maps. */
export function effectiveMapId(mode: Mode, mapId: string): string {
  return mode === 'online' && !getMap(mapId) ? DEFAULT_MAP_ID : mapId;
}

/** `wanted` if the map supports it, else annihilation (which every map does). */
export function modeFor(map: MapDef, wanted: GameMode): GameMode {
  return supportedModes(map).includes(wanted) ? wanted : 'annihilation';
}

export function SetupScreen({ initial, onStart, onLoadReplay, onOpenEditor, onOpenArmies }: Props): JSX.Element {
  const [mode, setMode] = useState<Mode>(initial.seats[1] === 'ai' ? 'vsAI' : 'hotseat');
  const [p0, setP0] = useState(initial.presets[0]);
  const [p1, setP1] = useState(initial.presets[1]);
  const [seed, setSeed] = useState(initial.seed);
  // Custom maps saved from the editor (read once; the editor is a separate screen).
  const [customMaps] = useState(() => playableCustomMaps(browserStorage()));
  // Saved army-builder armies that can be played (read once, like custom maps).
  const [armies] = useState(() => playableArmies(browserStorage()));
  const unitsOf = (choice: string) => (choiceWarband(choice, armies) ?? PRESETS[FALLBACK_PRESET]!).units;
  const [mapId, setMapId] = useState(() => {
    const id = initial.mapId ?? DEFAULT_MAP_ID;
    return getMap(id) || customMaps.some((m) => m.id === id) ? id : DEFAULT_MAP_ID;
  });
  const [wantedMode, setWantedMode] = useState<GameMode>(initial.mode ?? 'annihilation');
  const [kings, setKings] = useState<[number, number]>(
    () => initial.kings ?? [defaultKing(unitsOf(initial.presets[0])), defaultKing(unitsOf(initial.presets[1]))],
  );
  const [replayError, setReplayError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // The map actually played (online can't use custom maps) and a mode it supports.
  const playedMapId = effectiveMapId(mode, mapId);
  const playedMap = getMap(playedMapId) ?? customMaps.find((m) => m.id === playedMapId) ?? getMap(DEFAULT_MAP_ID)!;
  const gameMode = modeFor(playedMap, wantedMode);

  const pickPreset = (owner: 0 | 1, id: string) => {
    (owner === 0 ? setP0 : setP1)(id);
    setKings((k) => (owner === 0 ? [defaultKing(unitsOf(id)), k[1]] : [k[0], defaultKing(unitsOf(id))]));
  };
  const pickKing = (owner: 0 | 1, i: number) => setKings((k) => (owner === 0 ? [i, k[1]] : [k[0], i]));
  // Online you bring only your own army (and King); side 1 is a stand-in copy of it.
  const sides: [string, string] = mode === 'online' ? [p0, p0] : [p0, p1];
  const playedKings: [number, number] = mode === 'online' ? [kings[0], defaultKing(unitsOf(p0))] : kings;

  const launch = launchFor(mode, sides, Number.isFinite(seed) ? seed : 0, playedMapId, { mode: gameMode, kings: playedKings }, armies);
  const problem = launchProblem(launch, customMapLookup(browserStorage()));
  const start = () => onStart(launch);

  const loadReplayFile = async (file: File): Promise<void> => {
    setReplayError(null);
    try {
      onLoadReplay(parseReplay(await file.text()));
    } catch (e) {
      setReplayError(e instanceof Error ? e.message : String(e));
    }
  };

  const label0 = mode === 'vsAI' ? 'You — Player 0' : mode === 'online' ? 'Your warband' : 'Player 0';
  const label1 = mode === 'vsAI' ? 'AI — Player 1' : 'Player 1';

  return (
    <div className="setup">
      <div className="setup-card">
        <h1>FanSong</h1>
        <p className="tagline">A "you go, I go" skirmish. Pick two warbands and fight.</p>

        <fieldset>
          <legend>Mode</legend>
          <label>
            <input type="radio" checked={mode === 'vsAI'} onChange={() => setMode('vsAI')} />
            You vs AI
          </label>
          <label>
            <input type="radio" checked={mode === 'hotseat'} onChange={() => setMode('hotseat')} />
            Local hotseat (two humans)
          </label>
          <label>
            <input type="radio" checked={mode === 'online'} onChange={() => setMode('online')} />
            Online vs a human (matchmaking)
          </label>
        </fieldset>

        {mode === 'online' ? (
          <p className="hint">
            You bring your own warband, and so does your opponent. You'll join a player waiting for
            the same map and game mode, or host a room and wait for one. The host picks the seed.
          </p>
        ) : null}

        <div className="warband-cols">
          <WarbandPicker
            label={label0}
            value={p0}
            armies={armies}
            onChange={(id) => pickPreset(0, id)}
            king={gameMode === 'kill-the-king' ? kings[0] : undefined}
            onKing={(i) => pickKing(0, i)}
          />
          {mode === 'online' ? null : (
            <WarbandPicker
              label={label1}
              value={p1}
              armies={armies}
              onChange={(id) => pickPreset(1, id)}
              king={gameMode === 'kill-the-king' ? playedKings[1] : undefined}
              onKing={(i) => pickKing(1, i)}
            />
          )}
        </div>
        <div className="setup-links">
          <button className="ghost" onClick={onOpenArmies}>
            Army builder…
          </button>
          <button className="ghost" onClick={onOpenEditor}>
            Map editor…
          </button>
        </div>

        <MapPicker value={playedMapId} custom={mode === 'online' ? [] : customMaps} onChange={setMapId} online={mode === 'online'} />

        <GameModePicker map={playedMap} value={gameMode} onChange={setWantedMode} />

        <label className="seed-row">
          Seed
          <input
            type="number"
            value={seed}
            onChange={(e) => setSeed(parseInt(e.target.value, 10))}
          />
        </label>

        {problem ? <p className="error">Can't start: {problem}</p> : null}
        <button className="primary" onClick={start} disabled={problem !== null}>
          {mode === 'online' ? 'Find a match' : 'Start battle'}
        </button>

        <div className="replay-load">
          <button className="ghost" onClick={() => fileInput.current?.click()}>
            Load a replay…
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void loadReplayFile(file);
              e.target.value = ''; // allow re-selecting the same file
            }}
          />
          {replayError ? <p className="error">{replayError}</p> : null}
        </div>
      </div>
    </div>
  );
}

function WarbandPicker({
  label,
  value,
  armies,
  onChange,
  king,
  onKing,
}: {
  label: string;
  /** A preset id or a saved-army choice. */
  value: string;
  /** Playable saved armies, offered after the presets. */
  armies: readonly SavedArmy[];
  onChange: (id: string) => void;
  /** Kill-the-king: index of the chosen King (omitted in other modes). */
  king?: number;
  onKing: (index: number) => void;
}): JSX.Element {
  const wb = choiceWarband(value, armies) ?? PRESETS[FALLBACK_PRESET]!;
  const check = isArmyChoice(value) ? validateArmy(wb) : validateWarband(wb);
  const presetOptions = PRESET_IDS.map((id) => (
    <option key={id} value={id}>
      {PRESETS[id]!.name}
    </option>
  ));
  return (
    <div className="warband-picker">
      <h3>{label}</h3>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {armies.length === 0 ? (
          presetOptions
        ) : (
          <>
            <optgroup label="Presets">{presetOptions}</optgroup>
            <optgroup label="Your armies">
              {armies.map((a) => (
                <option key={a.id} value={armyChoice(a.id)}>
                  {a.warband.name}
                </option>
              ))}
            </optgroup>
          </>
        )}
      </select>
      <p className="warband-meta">
        {warbandCost(wb)} pts · {wb.units.length} units {check.ok ? '' : '· illegal'}
      </p>
      <ul className="roster">
        {wb.units.map((u, i) => (
          <li key={i} className={king === i ? 'king' : undefined}>
            {king === undefined ? (
              <span>{u.name}</span>
            ) : (
              <label title="Choose this unit as King">
                <input type="radio" checked={king === i} onChange={() => onKing(i)} />
                {king === i ? '♛ ' : ''}
                {u.name}
              </label>
            )}
            <span className="stats">
              Q{u.quality} C{u.combat} M{u.move}
              {u.ranged ? ` R${u.ranged}` : ''}
              {u.tough ? ' Tough' : ''}
              {u.guard ? ' Guard' : ''}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MapPicker({
  value,
  custom,
  onChange,
  online,
}: {
  value: string;
  /** Playable custom maps, listed after the built-ins. */
  custom: readonly MapDef[];
  onChange: (id: string) => void;
  /** Online play: built-in maps only. */
  online: boolean;
}): JSX.Element {
  const map = getMap(value) ?? custom.find((m) => m.id === value) ?? getMap(DEFAULT_MAP_ID)!;
  const modes = supportedModes(map).map((m) => MODE_LABELS[m]);
  const option = (m: MapDef) => (
    <option key={m.id} value={m.id}>
      {m.name}
    </option>
  );
  return (
    <div className="map-picker">
      <h3>Map</h3>
      <select value={map.id} onChange={(e) => onChange(e.target.value)}>
        {custom.length === 0 ? (
          listMaps().map(option)
        ) : (
          <>
            <optgroup label="Built-in">{listMaps().map(option)}</optgroup>
            <optgroup label="Custom">{custom.map(option)}</optgroup>
          </>
        )}
      </select>
      <p className="warband-meta">
        {map.width}×{map.height} · {modes.join(', ')}
        {online ? ' · online matches use built-in maps only' : ''}
      </p>
    </div>
  );
}

/** Game mode radio list; modes the map can't host are shown disabled. */
function GameModePicker({
  map,
  value,
  onChange,
}: {
  map: MapDef;
  value: GameMode;
  onChange: (mode: GameMode) => void;
}): JSX.Element {
  const supported = supportedModes(map);
  return (
    <fieldset className="mode-picker">
      <legend>Game mode</legend>
      {GAME_MODES.map((m) => (
        <label key={m} className={supported.includes(m) ? undefined : 'unsupported'}>
          <input type="radio" checked={value === m} disabled={!supported.includes(m)} onChange={() => onChange(m)} />
          {MODE_LABELS[m]}
          {supported.includes(m) ? '' : ' (not on this map)'}
        </label>
      ))}
      {value === 'kill-the-king' ? <p className="hint">Pick each side's King in its roster above.</p> : null}
    </fieldset>
  );
}
