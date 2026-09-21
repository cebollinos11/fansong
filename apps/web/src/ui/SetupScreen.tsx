import { useState } from 'react';
import { PRESET_IDS, PRESETS, validateWarband, warbandCost } from '@fansong/content';
import type { MatchSetup, Seat } from '../game/types.js';

interface Props {
  initial: MatchSetup;
  onStart: (setup: MatchSetup) => void;
}

type Mode = 'vsAI' | 'hotseat';

function seatsForMode(mode: Mode): [Seat, Seat] {
  return mode === 'vsAI' ? ['human', 'ai'] : ['human', 'human'];
}

export function SetupScreen({ initial, onStart }: Props): JSX.Element {
  const [mode, setMode] = useState<Mode>(initial.seats[1] === 'ai' ? 'vsAI' : 'hotseat');
  const [p0, setP0] = useState(initial.presets[0]);
  const [p1, setP1] = useState(initial.presets[1]);
  const [seed, setSeed] = useState(initial.seed);

  const start = () =>
    onStart({ presets: [p0, p1], seats: seatsForMode(mode), seed: Number.isFinite(seed) ? seed : 0 });

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
        </fieldset>

        <div className="warband-cols">
          <WarbandPicker
            label={mode === 'vsAI' ? 'You — Player 0' : 'Player 0'}
            value={p0}
            onChange={setP0}
          />
          <WarbandPicker
            label={mode === 'vsAI' ? 'AI — Player 1' : 'Player 1'}
            value={p1}
            onChange={setP1}
          />
        </div>

        <label className="seed-row">
          Seed
          <input
            type="number"
            value={seed}
            onChange={(e) => setSeed(parseInt(e.target.value, 10))}
          />
        </label>

        <button className="primary" onClick={start}>
          Start battle
        </button>
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
