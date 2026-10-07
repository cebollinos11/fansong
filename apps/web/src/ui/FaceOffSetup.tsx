import { memo, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
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

// The screen every game is set up on, in the main menu's look: the two warbands
// square up across the screen, every unit standing on its own hex, with the
// battlefield and rules in a band below. One player at this browser arranges
// both sides; in an online room each player works their own side of it and the
// host sets the battlefield, so every side and control can be locked.

/** Everything the screen shows and every choice it can make. */
export interface SetupModel {
  title: string;
  /** Anything to show beside the title — online, the room code to share. */
  banner?: ReactNode;
  /** What to call each side. */
  names: [string, string];
  /** A word under each side's name: whether anyone holds the seat, and is ready. */
  notes?: [string | null, string | null];
  /** Each side's warband choice: a preset id, or `army:<id>` for a saved army. */
  sides: [string, string];
  warbands: [Warband, Warband];
  armies: readonly SavedArmy[];
  /** The sides this screen may change; in an online room, only your own seat. */
  mine: [boolean, boolean];
  pickSide: (owner: Owner, choice: string) => void;
  kings: [number, number];
  pickKing: (owner: Owner, index: number) => void;
  /** Open the army builder on what this side is fielding. */
  openBuilder: (owner: Owner) => void;
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
  /**
   * Given, the battlefield and the rules are someone else's to set (the online
   * host's): every control below is frozen, and this line says whose they are.
   */
  rulesLocked?: string;
  /** The seed, where this screen picks it; online the server does. */
  seed?: { value: number; set: (seed: number) => void };
  openSandbox?: () => void;
  problem: string | null;
  /** The button that gets the game going, and what it is still waiting on. */
  go: { label: string; onClick: () => void; status?: string };
  onBack: () => void;
  backLabel: string;
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
        {m.banner ? <div className="muster-banner">{m.banner}</div> : null}
      </header>
      <section className="fo-arena">
        {([0, 1] as const).map((owner) => (
          <FaceOffSide key={owner} m={m} owner={owner} />
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
          {m.rulesLocked ? <p className="muster-note">{m.rulesLocked}</p> : null}
          <div className="fo-rules-row">
            {m.gameMode === 'golden-pig' ? <EscortSwitch m={m} /> : null}
            <LengthControls m={m} />
          </div>
        </div>
        <div className="fo-go">
          <GoButton m={m} />
          {m.seed || m.openSandbox ? <Advanced m={m} /> : null}
        </div>
      </section>
    </div>
  );
}

function FaceOffSide({ m, owner }: { m: SetupModel; owner: Owner }): JSX.Element {
  const ktk = m.gameMode === 'kill-the-king';
  const mine = m.mine[owner];
  const name = m.names[owner];
  const note = m.notes?.[owner];
  const units = m.warbands[owner].units;
  const lead = ktk ? m.kings[owner] : Math.max(0, units.findIndex((u) => u.leader));
  return (
    <div className={`fo-side side-${owner}`}>
      <span className={`muster-label side-label-${owner}`}>{name}</span>
      <WarbandScene units={units} lead={lead} flip={owner === 1} />
      <div className="fo-name-row">
        {mine ? (
          <>
            <button type="button" className="fo-arrow" aria-label="Previous warband" onClick={() => cycle(m, owner, -1)}>
              ‹
            </button>
            <Picker
              title={`${name}: choose a warband`}
              kind="warband"
              groups={warbandGroups(m.armies)}
              value={m.sides[owner]}
              onPick={(id) => m.pickSide(owner, id)}
              className="fo-name"
            >
              <strong>{m.warbands[owner].name}</strong>
            </Picker>
            <button type="button" className="fo-arrow" aria-label="Next warband" onClick={() => cycle(m, owner, 1)}>
              ›
            </button>
          </>
        ) : (
          <span className="fo-name fo-name-fixed">
            <strong>{m.warbands[owner].name}</strong>
          </span>
        )}
      </div>
      <p className="muster-meta">
        {meta(m, owner)}
        {note ? <span className="fo-note">{note}</span> : null}
      </p>
      {mine ? (
        <button type="button" className="muster-link fo-build" onClick={() => m.openBuilder(owner)}>
          {isArmyChoice(m.sides[owner]) ? '⚒ Edit this army' : '⚒ Build your own army'}
        </button>
      ) : null}
      <details className="fo-roster" open={ktk || undefined}>
        <summary>{ktk && mine ? 'Roster · pick the King' : 'Roster'}</summary>
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

/**
 * Whether a side's warband is legal. The preset rules only bind a preset this
 * screen picked: another player's roster is whatever they built, so it is held
 * to the army builder's looser rules instead.
 */
function legal(m: SetupModel, owner: Owner): boolean {
  const wb = m.warbands[owner];
  const preset = m.mine[owner] && !isArmyChoice(m.sides[owner]);
  return (preset ? validateWarband(wb) : validateArmy(wb)).ok;
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
            disabled={!ok || m.rulesLocked !== undefined}
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
  const locked = m.rulesLocked !== undefined;
  const rules = MODE_RULES[m.gameMode];
  const unlimited = m.limits?.roundLimit === null;
  const base = m.defaultRounds ?? rules.roundLimit;
  const rounds = m.limits?.roundLimit ?? base;
  const target = m.limits?.targetScore ?? rules.targetScore;
  const emit = (next: GameLimits): void => m.setLimits(Object.keys(next).length > 0 ? next : undefined);
  return (
    <div className="length-controls">
      <Stepper label="Rounds" value={unlimited ? undefined : rounds} disabled={locked || unlimited || rounds === undefined} onChange={(n) => emit({ ...m.limits, roundLimit: n })} />
      <label className="muster-check">
        <input
          type="checkbox"
          checked={unlimited || rounds === undefined}
          disabled={locked}
          onChange={(e) => emit({ ...m.limits, roundLimit: e.target.checked ? null : (base ?? ROUND_LIMIT) })}
        />
        No limit
      </label>
      {target !== undefined ? (
        <Stepper label="Points to win" value={target} disabled={locked} onChange={(n) => emit({ ...m.limits, targetScore: n })} />
      ) : null}
      {m.limits && !locked ? (
        <button type="button" className="muster-link" onClick={() => m.setLimits(undefined)}>
          Reset
        </button>
      ) : null}
    </div>
  );
}

/** Golden Pig: which side escorts it, as a two-way switch. */
function EscortSwitch({ m }: { m: SetupModel }): JSX.Element {
  return (
    <div className="segmented" role="radiogroup" aria-label="Escort">
      {([0, 1] as const).map((p) => (
        <button
          key={p}
          type="button"
          role="radio"
          aria-checked={m.escort === p}
          className={m.escort === p ? 'on' : undefined}
          disabled={m.rulesLocked !== undefined}
          onClick={() => m.setEscort(p)}
        >
          {m.names[p]} escort{m.names[p] === 'You' ? '' : 's'}
        </button>
      ))}
    </div>
  );
}

/** Seed and the dev sandbox, tucked away. */
function Advanced({ m }: { m: SetupModel }): JSX.Element {
  const seed = m.seed;
  return (
    <details className="muster-advanced">
      <summary>Advanced</summary>
      {seed ? (
        <label>
          Seed
          <input type="number" value={seed.value} onChange={(e) => seed.set(parseInt(e.target.value, 10))} />
        </label>
      ) : null}
      {m.openSandbox ? (
        <button type="button" className="muster-link" onClick={m.openSandbox}>
          Sandbox…
        </button>
      ) : null}
    </details>
  );
}

function GoButton({ m }: { m: SetupModel }): JSX.Element {
  return (
    <>
      {m.problem ? <p className="muster-error">Can't start: {m.problem}</p> : null}
      <button type="button" className="muster-start" onClick={m.go.onClick} disabled={m.problem !== null}>
        {m.go.label}
      </button>
      {m.go.status ? <p className="muster-status">{m.go.status}</p> : null}
    </>
  );
}

function BackButton({ m }: { m: SetupModel }): JSX.Element {
  return (
    <button type="button" className="muster-back" onClick={m.onBack}>
      {m.backLabel}
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
  /** Given, the crown is this screen's to move. */
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
      {king === undefined ? null : onKing ? (
        <button
          type="button"
          className={king ? 'crown on' : 'crown'}
          aria-pressed={king}
          title={king ? 'This unit is the King' : 'Make this unit the King'}
          onClick={onKing}
        >
          ♛
        </button>
      ) : (
        <span className={king ? 'crown on' : 'crown'} title={king ? 'Their King' : undefined} aria-hidden={!king}>
          {king ? '♛' : ''}
        </span>
      )}
    </li>
  );
}

function UnitList({ m, owner }: { m: SetupModel; owner: Owner }): JSX.Element {
  const ktk = m.gameMode === 'kill-the-king';
  return (
    <ul className="unit-list">
      {m.warbands[owner].units.map((u, i) => (
        <UnitRow
          key={i}
          unit={u}
          king={ktk ? m.kings[owner] === i : undefined}
          onKing={m.mine[owner] ? () => m.pickKing(owner, i) : undefined}
        />
      ))}
    </ul>
  );
}

function MapCard({ m }: { m: SetupModel }): JSX.Element {
  const face = (
    <>
      <MapThumb map={m.map} />
      <span className="map-card-text">
        <span className="muster-label">Battlefield</span>
        <strong>{m.map.name}</strong>
        <span className="muster-meta">
          {m.map.width}×{m.map.height} hexes
        </span>
      </span>
    </>
  );
  if (m.rulesLocked !== undefined) return <div className="map-card map-card-fixed">{face}</div>;
  return (
    <Picker title="Choose a map" kind="map" groups={mapGroups(m.customMaps)} value={m.map.id} onPick={m.pickMap} className="map-card">
      {face}
    </Picker>
  );
}
