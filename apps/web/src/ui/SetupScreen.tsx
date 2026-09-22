import { useRef, useState } from 'react';
import {
  DEFAULT_MAP_ID,
  getMap,
  listMaps,
  PRESET_IDS,
  PRESETS,
  supportedModes,
  validateWarband,
  warbandCost,
  type MatchSetup,
} from '@fansong/content';
import type { Replay } from '@fansong/engine';
import type { Launch } from '../game/launch.js';
import { parseReplay } from '../game/replay-io.js';
import { MODE_LABELS } from './editorView.js';

interface Props {
  initial: MatchSetup;
  onStart: (launch: Launch) => void;
  onLoadReplay: (replay: Replay) => void;
  onOpenEditor: () => void;
}

export type Mode = 'vsAI' | 'hotseat' | 'online';

/**
 * The launch for the chosen options. The default map is left implicit (no
 * `mapId`) so default setups stay byte-identical to pre-map ones. Online matches
 * don't carry a map yet — the worker always plays the default board.
 */
export function launchFor(mode: Mode, presets: [string, string], seed: number, mapId: string = DEFAULT_MAP_ID): Launch {
  if (mode === 'online') return { kind: 'online', presets, seed };
  const seats = mode === 'vsAI' ? (['human', 'ai'] as const) : (['human', 'human'] as const);
  const setup: MatchSetup = { presets, seats: [seats[0], seats[1]], seed };
  if (mapId !== DEFAULT_MAP_ID) setup.mapId = mapId;
  return { kind: 'local', setup };
}

export function SetupScreen({ initial, onStart, onLoadReplay, onOpenEditor }: Props): JSX.Element {
  const [mode, setMode] = useState<Mode>(initial.seats[1] === 'ai' ? 'vsAI' : 'hotseat');
  const [p0, setP0] = useState(initial.presets[0]);
  const [p1, setP1] = useState(initial.presets[1]);
  const [seed, setSeed] = useState(initial.seed);
  const [mapId, setMapId] = useState(initial.mapId ?? DEFAULT_MAP_ID);
  const [replayError, setReplayError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const start = () => onStart(launchFor(mode, [p0, p1], Number.isFinite(seed) ? seed : 0, mapId));

  const loadReplayFile = async (file: File): Promise<void> => {
    setReplayError(null);
    try {
      onLoadReplay(parseReplay(await file.text()));
    } catch (e) {
      setReplayError(e instanceof Error ? e.message : String(e));
    }
  };

  const label0 = mode === 'vsAI' ? 'You — Player 0' : mode === 'online' ? 'Player 0 (you host)' : 'Player 0';
  const label1 = mode === 'vsAI' ? 'AI — Player 1' : mode === 'online' ? 'Player 1 (opponent)' : 'Player 1';

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
            You'll host a room and wait for the next player to queue. The first player to join
            takes Player 1; the host picks both warbands and the seed.
          </p>
        ) : null}

        <div className="warband-cols">
          <WarbandPicker label={label0} value={p0} onChange={setP0} />
          <WarbandPicker label={label1} value={p1} onChange={setP1} />
        </div>

        <MapPicker value={mapId} onChange={setMapId} disabled={mode === 'online'} />
        <button className="ghost" onClick={onOpenEditor}>
          Map editor…
        </button>

        <label className="seed-row">
          Seed
          <input
            type="number"
            value={seed}
            onChange={(e) => setSeed(parseInt(e.target.value, 10))}
          />
        </label>

        <button className="primary" onClick={start}>
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
  onChange,
}: {
  label: string;
  value: string;
  onChange: (id: string) => void;
}): JSX.Element {
  const wb = PRESETS[value]!;
  const check = validateWarband(wb);
  return (
    <div className="warband-picker">
      <h3>{label}</h3>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {PRESET_IDS.map((id) => (
          <option key={id} value={id}>
            {PRESETS[id]!.name}
          </option>
        ))}
      </select>
      <p className="warband-meta">
        {warbandCost(wb)} pts · {wb.units.length} units {check.ok ? '' : '· illegal'}
      </p>
      <ul className="roster">
        {wb.units.map((u, i) => (
          <li key={i}>
            <span>{u.name}</span>
            <span className="stats">Q{u.quality} C{u.combat} M{u.move}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MapPicker({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (id: string) => void;
  disabled: boolean;
}): JSX.Element {
  const map = getMap(disabled ? DEFAULT_MAP_ID : value)!;
  const modes = supportedModes(map).map((m) => MODE_LABELS[m]);
  return (
    <div className="map-picker">
      <h3>Map</h3>
      <select value={disabled ? DEFAULT_MAP_ID : value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {listMaps().map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
      <p className="warband-meta">
        {map.width}×{map.height} · {modes.join(', ')}
        {disabled ? ' · online matches use the default map' : ''}
      </p>
    </div>
  );
}
