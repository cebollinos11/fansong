import { memo, useEffect, useState, type CSSProperties } from 'react';
import {
  listMaps,
  PRESET_IDS,
  PRESETS,
  unitCost,
  validateArmy,
  validateWarband,
  warbandCost,
  type MapDef,
  type Warband,
  type WarbandUnit,
} from '@fansong/content';
import { GAME_MODES, LIMIT_RANGE, MODE_RULES, ROUND_LIMIT, type GameLimits, type GameMode, type Owner } from '@fansong/engine';
import { armyChoice, isArmyChoice, type SavedArmy } from '../game/armies.js';
import { spriteFor } from '../three/unitSprites.js';
import { traitsOf, TRAIT_INFO, traitTitle } from './armyView.js';
import { MODE_LABELS } from './editorView.js';
import { MenuUnit } from './MenuScreen.js';
import { MapThumb, Picker, profileStats, UnitSprite, warbandItem, warmMapThumb, type PickerGroup, type PickerItem } from './Picker.js';
import { formation, modesOf } from './setupView.js';
import { StatIcons } from './StatIcons.js';
import type { LocalMode } from './SetupScreen.js';

// The setup screen for a game played in this browser, in the main menu's look:
// the two warbands square up across the screen, every unit standing on its own
// hex, with the battlefield and rules in a band below.

/** Everything the screen shows and every choice it can make. */
export interface SetupModel {
  mode: LocalMode;
  title: string;
  sides: [string, string];
  warbands: [Warband, Warband];
  armies: readonly SavedArmy[];
  pickSide: (owner: Owner, choice: string) => void;
  kings: [number, number];
  pickKing: (owner: Owner, index: number) => void;
  map: MapDef;
  customMaps: readonly MapDef[];
  pickMap: (id: string) => void;
  gameMode: GameMode;
  pickMode: (mode: GameMode) => void;
  escort: Owner;
  setEscort: (escort: Owner) => void;
  limits: GameLimits | undefined;
  setLimits: (limits: GameLimits | undefined) => void;
  defaultRounds: number | undefined;
  seed: number;
  setSeed: (seed: number) => void;
  problem: string | null;
  start: () => void;
  onBack: () => void;
  openSandbox?: () => void;
}

/** Each mode's mark and, in a line, how it is won. */
const MODE_INFO: Record<GameMode, { glyph: string; blurb: string }> = {
  annihilation: { glyph: '⚔', blurb: 'Fight until one warband is broken or slain.' },
  'kill-the-king': { glyph: '♛', blurb: 'Each side crowns a King. Fell theirs, guard yours.' },
  'king-of-the-hill': { glyph: '▲', blurb: 'Hold the hill at the end of each round to score.' },
  conquest: { glyph: '⬢', blurb: 'Score every round for each zone you control.' },
  'capture-the-flag': { glyph: '⚑', blurb: 'Seize the enemy flag and carry it back to your base.' },
  'golden-pig': { glyph: '✪', blurb: 'One side walks the golden Pig into the enemy camp; the other hunts it.' },
};

export function FaceOffSetup({ model: m }: { model: SetupModel }): JSX.Element {
  const names = sideNames(m);
  // Get every map's card ready one at a time while the screen sits idle, so the map gallery opens at once.
  useEffect(() => {
    const maps = [...listMaps(), ...m.customMaps];
    let timer: ReturnType<typeof setTimeout>;
    const next = (i: number): void => {
      const map = maps[i];
      if (!map) return;
      modesOf(map);
      warmMapThumb(map);
      timer = setTimeout(() => next(i + 1), 30);
    };
    timer = setTimeout(() => next(0), 300);
    return () => clearTimeout(timer);
  }, [m.customMaps]);
  return (
    <div className="muster">
      <header className="muster-top">
        <BackButton m={m} />
        <h1>{m.title}</h1>
      </header>
      <section className="fo-arena">
        {([0, 1] as const).map((owner) => (
          <FaceOffSide key={owner} m={m} owner={owner} name={names[owner]} />
        ))}
        <div className="fo-vs" aria-hidden="true">
          VS
        </div>
      </section>
      <section className="fo-field">
        <MapCard m={m} />
        <div className="fo-rules">
          <span className="muster-label">Game mode</span>
          <ModeTiles m={m} />
          <p className="muster-blurb">{MODE_INFO[m.gameMode].blurb}</p>
          <div className="fo-rules-row">
            {m.gameMode === 'golden-pig' ? <EscortSwitch m={m} /> : null}
            <LengthControls m={m} />
          </div>
        </div>
        <div className="fo-go">
          <StartButton m={m} />
          <Advanced m={m} />
        </div>
      </section>
    </div>
  );
}

function FaceOffSide({ m, owner, name }: { m: SetupModel; owner: Owner; name: string }): JSX.Element {
  const ktk = m.gameMode === 'kill-the-king';
  const units = m.warbands[owner].units;
  const lead = ktk ? m.kings[owner] : Math.max(0, units.findIndex((u) => u.leader));
  return (
    <div className={`fo-side side-${owner}`}>
      <span className={`muster-label side-label-${owner}`}>{name}</span>
      <WarbandScene units={units} lead={lead} flip={owner === 1} />
      <div className="fo-name-row">
        <button type="button" className="fo-arrow" aria-label="Previous warband" onClick={() => cycle(m, owner, -1)}>
          ‹
        </button>
        <Picker title={`${name}: choose a warband`} kind="warband" groups={warbandGroups(m.armies)} value={m.sides[owner]} onPick={(id) => m.pickSide(owner, id)} className="fo-name">
          <strong>{m.warbands[owner].name}</strong>
        </Picker>
        <button type="button" className="fo-arrow" aria-label="Next warband" onClick={() => cycle(m, owner, 1)}>
          ›
        </button>
      </div>
      <p className="muster-meta">{meta(m, owner)}</p>
      <details className="fo-roster" open={ktk || undefined}>
        <summary>{ktk ? 'Roster · pick the King' : 'Roster'}</summary>
        <UnitList m={m} owner={owner} />
      </details>
    </div>
  );
}

const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * A whole warband drawn up on a patch of hexes, facing its enemy: `lead` at the
 * front, Big units standing taller. Every so often one of them takes a swing,
 * as on the main menu. It keeps its own clock, so a swing redraws nothing else.
 */
const WarbandScene = memo(function WarbandScene({
  units,
  lead,
  flip,
}: {
  units: readonly WarbandUnit[];
  lead: number;
  flip: boolean;
}): JSX.Element {
  const [strike, setStrike] = useState({ index: -1, n: 0 });
  useEffect(() => {
    if (reducedMotion() || units.length === 0) return;
    const timer = setTimeout(
      () => setStrike((s) => ({ index: Math.floor(Math.random() * units.length), n: s.n + 1 })),
      1100 + Math.random() * 1600,
    );
    return () => clearTimeout(timer);
  }, [strike, units]);

  const f = formation(units, lead);
  return (
    <div className={`fo-scene fo-scene-${f.size}`} aria-hidden="true">
      <div className="fo-formation" style={{ '--cols': f.cols, '--rows': f.rows } as CSSProperties}>
        {f.slots.map(({ index, col, row }) => {
          const unit = units[index]!;
          // File 0 stands nearest the enemy, in the middle of the screen.
          const x = flip ? col : f.cols - 1 - col;
          return (
            <div
              key={index}
              className="fo-slot"
              style={{ '--x': x, '--y': row + (x % 2) / 2, zIndex: row * 2 + (x % 2) } as CSSProperties}
            >
              <MenuUnit
                path={spriteFor(unit.look ?? unit.name)}
                strike={strike.index === index ? strike.n : 0}
                leader={index === lead}
                flip={flip}
                big={unit.big}
                tint={unit.tint}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
});

const sideNames = (m: SetupModel): [string, string] => (m.mode === 'vsAI' ? ['You', 'AI'] : ['Player 1', 'Player 2']);

/** Every warband on offer, in picker order. */
function choices(armies: readonly SavedArmy[]): string[] {
  return [...PRESET_IDS, ...armies.map((a) => armyChoice(a.id))];
}

function warbandGroups(armies: readonly SavedArmy[]): () => PickerGroup[] {
  return () => {
    const presets = PRESET_IDS.map((id) => warbandItem(id, PRESETS[id]!));
    if (armies.length === 0) return [{ items: presets }];
    return [
      { label: 'Presets', items: presets },
      { label: 'Your armies', items: armies.map((a) => warbandItem(armyChoice(a.id), a.warband)) },
    ];
  };
}

function mapGroups(custom: readonly MapDef[]): () => PickerGroup[] {
  const item = (m: MapDef): PickerItem => ({
    key: m.id,
    title: m.name,
    detail: `${m.width}×${m.height} · ${modesOf(m).map((x) => MODE_LABELS[x]).join(', ')}`,
    preview: <MapThumb map={m} />,
  });
  return () =>
    custom.length === 0
      ? [{ items: listMaps().map(item) }]
      : [
          { label: 'Built-in', items: listMaps().map(item) },
          { label: 'Custom', items: custom.map(item) },
        ];
}

/** Step to the previous or next warband on offer. */
function cycle(m: SetupModel, owner: Owner, by: 1 | -1): void {
  const all = choices(m.armies);
  const i = all.indexOf(m.sides[owner]);
  m.pickSide(owner, all[(i + by + all.length) % all.length]!);
}

function legal(m: SetupModel, owner: Owner): boolean {
  const wb = m.warbands[owner];
  return (isArmyChoice(m.sides[owner]) ? validateArmy(wb) : validateWarband(wb)).ok;
}

function meta(m: SetupModel, owner: Owner): string {
  const wb = m.warbands[owner];
  return `${warbandCost(wb)} pts · ${wb.units.length} units${legal(m, owner) ? '' : ' · illegal'}`;
}

/** The game mode as a set of tiles; ones the map can't host are greyed out. */
function ModeTiles({ m }: { m: SetupModel }): JSX.Element {
  const supported = modesOf(m.map);
  return (
    <div className="mode-tiles" role="radiogroup" aria-label="Game mode">
      {GAME_MODES.map((mode) => {
        const ok = supported.includes(mode);
        return (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={m.gameMode === mode}
            className={m.gameMode === mode ? 'mode-tile on' : 'mode-tile'}
            disabled={!ok}
            title={ok ? MODE_INFO[mode].blurb : `${MODE_LABELS[mode]}: not on this map`}
            onClick={() => m.pickMode(mode)}
          >
            <span className="mode-glyph" aria-hidden="true">
              {MODE_INFO[mode].glyph}
            </span>
            <span className="mode-name">{MODE_LABELS[mode]}</span>
          </button>
        );
      })}
    </div>
  );
}

/** A number with − and + beside it. */
function Stepper({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: number | undefined;
  onChange: (n: number) => void;
  disabled?: boolean;
}): JSX.Element {
  const clamp = (n: number): number => Math.min(LIMIT_RANGE.max, Math.max(LIMIT_RANGE.min, n));
  return (
    <span className="stepper">
      <span className="stepper-label">{label}</span>
      <button type="button" aria-label={`Fewer ${label.toLowerCase()}`} disabled={disabled || value === undefined} onClick={() => onChange(clamp((value ?? 0) - 1))}>
        −
      </button>
      <span className="stepper-value">{disabled || value === undefined ? '∞' : value}</span>
      <button type="button" aria-label={`More ${label.toLowerCase()}`} disabled={disabled || value === undefined} onClick={() => onChange(clamp((value ?? 0) + 1))}>
        +
      </button>
    </span>
  );
}

/** Round limit and points to win, as steppers. */
function LengthControls({ m }: { m: SetupModel }): JSX.Element {
  const rules = MODE_RULES[m.gameMode];
  const unlimited = m.limits?.roundLimit === null;
  const base = m.defaultRounds ?? rules.roundLimit;
  const rounds = m.limits?.roundLimit ?? base;
  const target = m.limits?.targetScore ?? rules.targetScore;
  const emit = (next: GameLimits): void => m.setLimits(Object.keys(next).length > 0 ? next : undefined);
  return (
    <div className="length-controls">
      <Stepper label="Rounds" value={unlimited ? undefined : rounds} disabled={unlimited || rounds === undefined} onChange={(n) => emit({ ...m.limits, roundLimit: n })} />
      <label className="muster-check">
        <input
          type="checkbox"
          checked={unlimited || rounds === undefined}
          onChange={(e) => emit({ ...m.limits, roundLimit: e.target.checked ? null : (base ?? ROUND_LIMIT) })}
        />
        No limit
      </label>
      {target !== undefined ? <Stepper label="Points to win" value={target} onChange={(n) => emit({ ...m.limits, targetScore: n })} /> : null}
      {m.limits ? (
        <button type="button" className="muster-link" onClick={() => m.setLimits(undefined)}>
          Reset
        </button>
      ) : null}
    </div>
  );
}

/** Golden Pig: which side escorts it, as a two-way switch. */
function EscortSwitch({ m }: { m: SetupModel }): JSX.Element {
  const names = sideNames(m);
  return (
    <div className="segmented" role="radiogroup" aria-label="Escort">
      {([0, 1] as const).map((p) => (
        <button key={p} type="button" role="radio" aria-checked={m.escort === p} className={m.escort === p ? 'on' : undefined} onClick={() => m.setEscort(p)}>
          {names[p]} escort{p === 0 && m.mode === 'vsAI' ? '' : 's'}
        </button>
      ))}
    </div>
  );
}

/** Seed and the dev sandbox, tucked away. */
function Advanced({ m }: { m: SetupModel }): JSX.Element {
  return (
    <details className="muster-advanced">
      <summary>Advanced</summary>
      <label>
        Seed
        <input type="number" value={m.seed} onChange={(e) => m.setSeed(parseInt(e.target.value, 10))} />
      </label>
      {m.openSandbox ? (
        <button type="button" className="muster-link" onClick={m.openSandbox}>
          Sandbox…
        </button>
      ) : null}
    </details>
  );
}

function StartButton({ m }: { m: SetupModel }): JSX.Element {
  return (
    <>
      {m.problem ? <p className="muster-error">Can't start: {m.problem}</p> : null}
      <button type="button" className="muster-start" onClick={m.start} disabled={m.problem !== null}>
        Start battle
      </button>
    </>
  );
}

function BackButton({ m }: { m: SetupModel }): JSX.Element {
  return (
    <button type="button" className="muster-back" onClick={m.onBack}>
      ⟵ Menu
    </button>
  );
}

/** A unit as a roster line: sprite, name, stats, traits, cost; in kill-the-king, a crown to pick. */
function UnitRow({
  unit,
  king,
  onKing,
}: {
  unit: WarbandUnit;
  /** Kill-the-king only: whether this unit is the King. */
  king?: boolean;
  onKing?: () => void;
}): JSX.Element {
  return (
    <li className={king ? 'unit-row king' : 'unit-row'}>
      <span className="unit-row-sprite">
        <UnitSprite unit={unit} />
      </span>
      <span className="unit-row-main">
        <span className="unit-row-name">{unit.name}</span>
        <span className="unit-row-traits">
          {traitsOf(unit).map((t) => (
            <span key={t} className="trait-tag" title={traitTitle(t)}>
              {TRAIT_INFO[t].label}
            </span>
          ))}
        </span>
      </span>
      <span className="unit-row-stats">
        <StatIcons stats={profileStats(unit)} />
      </span>
      <span className="unit-row-cost">{unitCost(unit)}</span>
      {king !== undefined ? (
        <button
          type="button"
          className={king ? 'crown on' : 'crown'}
          aria-pressed={king}
          title={king ? 'This unit is the King' : 'Make this unit the King'}
          onClick={onKing}
        >
          ♛
        </button>
      ) : null}
    </li>
  );
}

function UnitList({ m, owner }: { m: SetupModel; owner: Owner }): JSX.Element {
  const ktk = m.gameMode === 'kill-the-king';
  return (
    <ul className="unit-list">
      {m.warbands[owner].units.map((u, i) => (
        <UnitRow key={i} unit={u} king={ktk ? m.kings[owner] === i : undefined} onKing={() => m.pickKing(owner, i)} />
      ))}
    </ul>
  );
}

function MapCard({ m }: { m: SetupModel }): JSX.Element {
  return (
    <Picker title="Choose a map" kind="map" groups={mapGroups(m.customMaps)} value={m.map.id} onPick={m.pickMap} className="map-card">
      <MapThumb map={m.map} />
      <span className="map-card-text">
        <span className="muster-label">Battlefield</span>
        <strong>{m.map.name}</strong>
        <span className="muster-meta">
          {m.map.width}×{m.map.height} hexes
        </span>
      </span>
    </Picker>
  );
}
