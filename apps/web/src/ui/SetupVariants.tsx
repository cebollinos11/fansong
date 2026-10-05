import { useEffect, useState, type ReactNode } from 'react';
import {
  listMaps,
  PRESET_IDS,
  PRESETS,
  supportedModes,
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
import { MapThumb, Picker, profileStats, UnitSprite, warbandItem, type PickerGroup, type PickerItem } from './Picker.js';
import { StatIcons } from './StatIcons.js';
import type { LocalMode } from './SetupScreen.js';

// A layout trial for the setup screen: three takes on it in the main menu's
// look, switchable with `?setup=a|b|c` (or the switcher in the corner). They
// share one model, so they differ only in how they lay the choices out.

export type SetupVariant = 'a' | 'b' | 'c' | 'old';

const VARIANTS: readonly { key: SetupVariant; label: string }[] = [
  { key: 'a', label: 'A · Face-off' },
  { key: 'b', label: 'B · Muster list' },
  { key: 'c', label: 'C · War table' },
  { key: 'old', label: 'Current' },
];

/** The variant named by `?setup=` in the URL, else A. */
export function setupVariant(): SetupVariant {
  const v = new URLSearchParams(window.location.search).get('setup');
  return VARIANTS.some((x) => x.key === v) ? (v as SetupVariant) : 'a';
}

/** Everything a layout shows and every choice it can make. */
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

export function SetupLayout({
  variant,
  model,
  onVariant,
}: {
  variant: Exclude<SetupVariant, 'old'>;
  model: SetupModel;
  onVariant: (v: SetupVariant) => void;
}): JSX.Element {
  const Layout = variant === 'a' ? FaceOff : variant === 'b' ? MusterList : WarTable;
  return (
    <div className={`muster muster-${variant}`}>
      <Layout m={model} />
      <VariantSwitch value={variant} onChange={onVariant} />
    </div>
  );
}

/** The trial's layout switcher, pinned to a corner. */
export function VariantSwitch({ value, onChange }: { value: SetupVariant; onChange: (v: SetupVariant) => void }): JSX.Element {
  const pick = (v: SetupVariant): void => {
    const url = new URL(window.location.href);
    url.searchParams.set('setup', v);
    window.history.replaceState(null, '', url);
    onChange(v);
  };
  return (
    <div className="variant-switch" role="group" aria-label="Setup layout">
      {VARIANTS.map((v) => (
        <button key={v.key} type="button" className={v.key === value ? 'on' : undefined} onClick={() => pick(v.key)}>
          {v.label}
        </button>
      ))}
    </div>
  );
}

// --- Shared pieces ------------------------------------------------------------

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
    detail: `${m.width}×${m.height} · ${supportedModes(m).map((x) => MODE_LABELS[x]).join(', ')}`,
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

/** The warband's front man (its King in kill-the-king) and up to two other looks behind. */
function teamOf(m: SetupModel, owner: Owner, size = 3): { leader: string; rank: string[] } {
  const units = m.warbands[owner].units;
  const lead =
    m.gameMode === 'kill-the-king' ? m.kings[owner] : Math.max(0, units.findIndex((u) => u.leader));
  const look = (u: WarbandUnit): string => spriteFor(u.look ?? u.name);
  const leader = look(units[lead] ?? units[0]!);
  const rank = [...new Set(units.map(look))].filter((p) => p !== leader).slice(0, size - 1);
  return { leader, rank };
}

const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Every so often one of `units` takes a swing, as on the main menu. */
function useStrikes(units: readonly string[]): (path: string) => number {
  const [strike, setStrike] = useState({ unit: '', n: 0 });
  const key = units.join();
  useEffect(() => {
    if (reducedMotion() || units.length === 0) return;
    const timer = setTimeout(
      () => setStrike((s) => ({ unit: units[Math.floor(Math.random() * units.length)]!, n: s.n + 1 })),
      1100 + Math.random() * 1600,
    );
    return () => clearTimeout(timer);
  }, [strike, key]);
  return (path) => (strike.unit === path ? strike.n : 0);
}

/** Two warbands squaring up on grass hexes, leaders in front. */
function FaceOffScene({ m, size = 3, className = '' }: { m: SetupModel; size?: number; className?: string }): JSX.Element {
  const home = teamOf(m, 0, size);
  const away = teamOf(m, 1, size);
  const strikeOf = useStrikes([...home.rank, home.leader, away.leader, ...away.rank]);
  return (
    <div className={`muster-scene ${className}`} aria-hidden="true">
      <div className="muster-team">
        {home.rank.map((p) => (
          <MenuUnit key={`r${p}`} path={p} strike={strikeOf(p)} />
        ))}
        <MenuUnit key={`l${home.leader}`} path={home.leader} strike={strikeOf(home.leader)} leader />
      </div>
      <div className="muster-team">
        <MenuUnit key={`l${away.leader}`} path={away.leader} strike={strikeOf(away.leader)} leader flip />
        {away.rank.map((p) => (
          <MenuUnit key={`r${p}`} path={p} strike={strikeOf(p)} flip />
        ))}
      </div>
    </div>
  );
}

/** The game mode as a set of tiles; ones the map can't host are greyed out. */
function ModeTiles({ m, blurbs = false }: { m: SetupModel; blurbs?: boolean }): JSX.Element {
  const supported = supportedModes(m.map);
  return (
    <div className={blurbs ? 'mode-tiles with-blurbs' : 'mode-tiles'} role="radiogroup" aria-label="Game mode">
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
            {blurbs ? <span className="mode-blurb">{ok ? MODE_INFO[mode].blurb : 'Not on this map'}</span> : null}
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

/** "12 rounds · first to 5", or "No round limit". */
function lengthSummary(m: SetupModel): string {
  const rules = MODE_RULES[m.gameMode];
  const rounds = m.limits?.roundLimit === null ? undefined : (m.limits?.roundLimit ?? m.defaultRounds ?? rules.roundLimit);
  const target = m.limits?.targetScore ?? rules.targetScore;
  const parts = [rounds === undefined ? 'No round limit' : `${rounds} rounds`];
  if (target !== undefined) parts.push(`first to ${target}`);
  return parts.join(' · ');
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

function StartButton({ m, children = 'Start battle' }: { m: SetupModel; children?: ReactNode }): JSX.Element {
  return (
    <>
      {m.problem ? <p className="muster-error">Can't start: {m.problem}</p> : null}
      <button type="button" className="muster-start" onClick={m.start} disabled={m.problem !== null}>
        {children}
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

function MapCard({ m, className = '' }: { m: SetupModel; className?: string }): JSX.Element {
  return (
    <Picker title="Choose a map" kind="map" groups={mapGroups(m.customMaps)} value={m.map.id} onPick={m.pickMap} className={`map-card ${className}`}>
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

// --- A · Face-off ---------------------------------------------------------------
// The two warbands square up across the screen like on the main menu; the
// battlefield and rules sit in a band below, with the Start button at the end.

function FaceOff({ m }: { m: SetupModel }): JSX.Element {
  const names = sideNames(m);
  return (
    <>
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
    </>
  );
}

function FaceOffSide({ m, owner, name }: { m: SetupModel; owner: Owner; name: string }): JSX.Element {
  const team = teamOf(m, owner);
  const strikeOf = useStrikes([team.leader, ...team.rank]);
  const flip = owner === 1;
  const units = [...team.rank.map((p) => ({ p, leader: false })), { p: team.leader, leader: true }];
  return (
    <div className={`fo-side side-${owner}`}>
      <span className={`muster-label side-label-${owner}`}>{name}</span>
      <div className="fo-scene" aria-hidden="true">
        {(flip ? [...units].reverse() : units).map(({ p, leader }) => (
          <MenuUnit key={`${leader}${p}`} path={p} strike={strikeOf(p)} leader={leader} flip={flip} />
        ))}
      </div>
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
      <details className="fo-roster" open={m.gameMode === 'kill-the-king' || undefined}>
        <summary>{m.gameMode === 'kill-the-king' ? 'Roster · pick the King' : 'Roster'}</summary>
        <UnitList m={m} owner={owner} />
      </details>
    </div>
  );
}

// --- B · Muster list ------------------------------------------------------------
// The main menu's own shape: a column of big gold-edged rows on the left, one
// per choice, and the matchup standing on the chosen map on the right.

type Open = 'mode' | 'length' | 'kings' | null;

function MusterList({ m }: { m: SetupModel }): JSX.Element {
  const [open, setOpen] = useState<Open>(null);
  const names = sideNames(m);
  const toggle = (o: Open): void => setOpen((cur) => (cur === o ? null : o));
  const ktk = m.gameMode === 'kill-the-king';
  return (
    <>
      <header className="mb-head">
        <BackButton m={m} />
        <h1>{m.title}</h1>
        <p>Muster your warband, choose the field, then fight.</p>
      </header>

      <nav className="mb-rows">
        {([0, 1] as const).map((owner) => (
          <Picker
            key={owner}
            title={`${names[owner]}: choose a warband`}
            kind="warband"
            groups={warbandGroups(m.armies)}
            value={m.sides[owner]}
            onPick={(id) => m.pickSide(owner, id)}
            className={`mb-row side-${owner}`}
          >
            <span className="mb-row-text">
              <span className={`muster-label side-label-${owner}`}>{m.mode === 'vsAI' ? (owner === 0 ? 'Your warband' : 'Enemy warband') : `${names[owner]}'s warband`}</span>
              <strong>{m.warbands[owner].name}</strong>
            </span>
            <span className="mb-row-detail">{meta(m, owner)}</span>
          </Picker>
        ))}

        <Picker title="Choose a map" kind="map" groups={mapGroups(m.customMaps)} value={m.map.id} onPick={m.pickMap} className="mb-row">
          <span className="mb-row-text">
            <span className="muster-label">Battlefield</span>
            <strong>{m.map.name}</strong>
          </span>
          <span className="mb-row-detail">
            {m.map.width}×{m.map.height}
          </span>
        </Picker>

        <button type="button" className={open === 'mode' ? 'mb-row open' : 'mb-row'} aria-expanded={open === 'mode'} onClick={() => toggle('mode')}>
          <span className="mb-row-text">
            <span className="muster-label">Game mode</span>
            <strong>
              <span className="mode-glyph">{MODE_INFO[m.gameMode].glyph}</span> {MODE_LABELS[m.gameMode]}
            </strong>
          </span>
          <span className="mb-row-detail">{supportedModes(m.map).length} on this map</span>
        </button>
        {open === 'mode' ? (
          <div className="mb-drawer">
            <ModeTiles m={m} blurbs />
            {m.gameMode === 'golden-pig' ? <EscortSwitch m={m} /> : null}
          </div>
        ) : null}

        {ktk ? (
          <>
            <button type="button" className={open === 'kings' ? 'mb-row open' : 'mb-row'} aria-expanded={open === 'kings'} onClick={() => toggle('kings')}>
              <span className="mb-row-text">
                <span className="muster-label">Kings</span>
                <strong>
                  {m.warbands[0].units[m.kings[0]]?.name} · {m.warbands[1].units[m.kings[1]]?.name}
                </strong>
              </span>
            </button>
            {open === 'kings' ? (
              <div className="mb-drawer mb-kings">
                {([0, 1] as const).map((owner) => (
                  <div key={owner}>
                    <span className={`muster-label side-label-${owner}`}>{names[owner]}</span>
                    <UnitList m={m} owner={owner} />
                  </div>
                ))}
              </div>
            ) : null}
          </>
        ) : null}

        <button type="button" className={open === 'length' ? 'mb-row open' : 'mb-row'} aria-expanded={open === 'length'} onClick={() => toggle('length')}>
          <span className="mb-row-text">
            <span className="muster-label">Game length</span>
            <strong>{lengthSummary(m)}</strong>
          </span>
        </button>
        {open === 'length' ? (
          <div className="mb-drawer">
            <LengthControls m={m} />
          </div>
        ) : null}

        <StartButton m={m} />
        <Advanced m={m} />
      </nav>

      <div className="mb-stage">
        <div className="mb-table">
          <MapThumb map={m.map} className="map-thumb mb-map" />
        </div>
        <FaceOffScene m={m} />
        <p className="mb-caption">
          <span className="mode-glyph">{MODE_INFO[m.gameMode].glyph}</span> {MODE_INFO[m.gameMode].blurb}
        </p>
      </div>
    </>
  );
}

// --- C · War table --------------------------------------------------------------
// Everything at once: both full rosters with stats and traits on the flanks,
// the battlefield and rules in the middle, and a bar to start along the bottom.

function WarTable({ m }: { m: SetupModel }): JSX.Element {
  const names = sideNames(m);
  return (
    <>
      <header className="muster-top">
        <BackButton m={m} />
        <h1>{m.title}</h1>
      </header>
      <div className="wt-grid">
        <RosterCard m={m} owner={0} name={names[0]} />
        <section className="wt-card wt-field">
          <MapCard m={m} className="wt-map" />
          <span className="muster-label">Game mode</span>
          <ModeTiles m={m} blurbs />
          {m.gameMode === 'golden-pig' ? (
            <>
              <span className="muster-label">Escort</span>
              <EscortSwitch m={m} />
            </>
          ) : null}
          <span className="muster-label">Game length</span>
          <LengthControls m={m} />
          <Advanced m={m} />
        </section>
        <RosterCard m={m} owner={1} name={names[1]} />
      </div>
      <footer className="wt-bar">
        <span className="wt-summary">
          <strong className="side-label-0">{m.warbands[0].name}</strong>
          <span className="wt-vs">vs</span>
          <strong className="side-label-1">{m.warbands[1].name}</strong>
          <span className="muster-meta">
            {' '}
            · {m.map.name} · {MODE_LABELS[m.gameMode]} · {lengthSummary(m)}
          </span>
        </span>
        <span className="wt-go">
          <StartButton m={m} />
        </span>
      </footer>
    </>
  );
}

function RosterCard({ m, owner, name }: { m: SetupModel; owner: Owner; name: string }): JSX.Element {
  const team = teamOf(m, owner, 1);
  return (
    <section className={`wt-card wt-roster side-${owner}`}>
      <div className="wt-roster-head">
        <MenuUnit path={team.leader} strike={0} leader flip={owner === 1} />
        <div className="wt-roster-title">
          <span className={`muster-label side-label-${owner}`}>{name}</span>
          <Picker title={`${name}: choose a warband`} kind="warband" groups={warbandGroups(m.armies)} value={m.sides[owner]} onPick={(id) => m.pickSide(owner, id)} className="wt-name">
            <strong>{m.warbands[owner].name}</strong>
          </Picker>
          <span className="muster-meta">{meta(m, owner)}</span>
        </div>
      </div>
      {m.gameMode === 'kill-the-king' ? <p className="muster-blurb">Tap a crown to choose this side's King.</p> : null}
      <UnitList m={m} owner={owner} />
    </section>
  );
}
