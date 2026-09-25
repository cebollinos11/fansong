import { useEffect, useMemo, useRef, useState } from 'react';
import {
  MAX_ELEVATION,
  TERRAIN_FEATURES,
  unitById,
  type Command,
  type GameState,
  type Owner,
  type TerrainFeature,
  type Unit,
} from '@fansong/engine';
import { PRESETS, profileMove, type MatchSetup, type WarbandUnit } from '@fansong/content';
import { playableArmies } from '../game/armies.js';
import { browserStorage } from '../game/customMaps.js';
import * as sandboxOps from '../game/sandbox.js';
import {
  activateUnit,
  clearUnits,
  forceDice,
  freshRound,
  MAX_FORCED_DICE,
  OUTCOME_RULES,
  outcomeRule,
  paintHex,
  parseDicePattern,
  parseSandboxState,
  patchUnit,
  peekDice,
  removeUnit,
  rerollRng,
  resumeGame,
  setActivePlayer,
  setBenched,
  setRound,
  setScores,
  spawnUnit,
  stuckReason,
  teleportUnit,
  type HexPaint,
  type UnitPatch,
} from '../game/sandbox.js';
import { SandboxClient, type SandboxInfo } from '../game/SandboxClient.js';
import {
  deleteSnapshot,
  loadSnapshots,
  saveAutosave,
  saveSnapshot,
  type Snapshot,
} from '../game/sandboxStore.js';
import { GameScreen, type SandboxHooks } from './GameScreen.js';

/** What a board click does while the sandbox panel is open. */
type Tool = 'play' | 'select' | 'spawn' | 'move' | 'delete' | 'terrain';

const TOOLS: { id: Tool; label: string; hint: string }[] = [
  { id: 'play', label: 'Play', hint: 'Clicks play the game as normal (a clicked unit is also inspected)' },
  { id: 'select', label: 'Inspect', hint: 'Click a unit to inspect and edit it' },
  { id: 'spawn', label: 'Spawn', hint: 'Click an empty hex to place the spawn template' },
  { id: 'move', label: 'Teleport', hint: 'Click a unit, then a hex: it jumps there (no action, no free hacks)' },
  { id: 'delete', label: 'Delete', hint: 'Click a unit to take it off the board' },
  { id: 'terrain', label: 'Terrain', hint: 'Click a hex to paint it with the terrain brush' },
];

/** One spawnable profile: a preset's unit or a saved army's. */
interface PaletteEntry {
  key: string;
  group: string;
  unit: WarbandUnit;
}

function buildPalette(): PaletteEntry[] {
  const out: PaletteEntry[] = [];
  for (const [id, wb] of Object.entries(PRESETS)) {
    wb.units.forEach((unit, i) => out.push({ key: `${id}/${i}`, group: wb.name, unit }));
  }
  for (const army of playableArmies(browserStorage())) {
    army.warband.units.forEach((unit, i) =>
      out.push({ key: `army:${army.id}/${i}`, group: `Army: ${army.warband.name}`, unit }),
    );
  }
  return out;
}

/** The terrain brush: which attribute a click paints, and with what. */
type Brush =
  | { kind: 'elevation'; value: number }
  | { kind: 'feature'; value: TerrainFeature | null }
  | { kind: 'blocked'; value: boolean };

function paintFor(brush: Brush): HexPaint {
  if (brush.kind === 'elevation') return { elevation: brush.value };
  if (brush.kind === 'feature') return { feature: brush.value };
  return { blocked: brush.value };
}

interface Props {
  initial: GameState;
  setup: MatchSetup;
  onExit: () => void;
}

/**
 * The dev sandbox: a local match whose state can be rewritten at will — spawn
 * and teleport units, edit their stats and status, hand out actions, paint
 * terrain, force the dice or the outcome of the next roll, hand either side to
 * the AI, undo anything, and save situations to come back to. The game itself
 * is the ordinary {@link GameScreen}; the panel borrows its board clicks.
 */
export function SandboxScreen({ initial, setup, onExit }: Props): JSX.Element {
  const [client] = useState(() => new SandboxClient(initial, setup));
  useEffect(() => () => client.dispose(), [client]);

  const [state, setState] = useState<GameState>(() => client.getState());
  const [info, setInfo] = useState<SandboxInfo>(() => client.info());
  const [tool, setTool] = useState<Tool>('select');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const palette = useMemo(buildPalette, []);
  const [spawnOwner, setSpawnOwner] = useState<Owner>(0);
  const [template, setTemplate] = useState<WarbandUnit>(() => palette[0]!.unit);
  const [brush, setBrush] = useState<Brush>({ kind: 'elevation', value: 1 });

  // The panel shows the client's latest state (the board may still be animating toward it).
  useEffect(() => {
    const store = browserStorage();
    const unsub = client.subscribe((t) => {
      setState(t.state);
      saveAutosave(store, t.state);
    });
    const unsubInfo = client.onInfo(setInfo);
    saveAutosave(store, client.getState());
    return () => {
      unsub();
      unsubInfo();
    };
  }, [client]);

  const say = (text: string, error = false) => setMessage({ text, error });

  /** Apply an edit, reporting (not throwing) what went wrong. */
  const edit = (fn: (s: GameState) => GameState, done?: string): boolean => {
    try {
      client.edit(fn);
      if (done) say(done);
      else setMessage(null);
      return true;
    } catch (e) {
      say(e instanceof Error ? e.message : String(e), true);
      return false;
    }
  };

  // Devtools access: `fansong.state()`, `fansong.edit(s => ...)`, `fansong.ops.spawnUnit(...)`.
  useEffect(() => {
    const w = window as unknown as { fansong?: unknown };
    w.fansong = { client, state: () => client.getState(), edit: (fn: (s: GameState) => GameState) => client.edit(fn), ops: sandboxOps };
    return () => {
      delete w.fansong;
    };
  }, [client]);

  // Ctrl+Z / Ctrl+Shift+Z (or Ctrl+Y) undo and redo anything, command or edit.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        client.undo();
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault();
        client.redo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [client]);

  const selected = selectedId ? unitById(state, selectedId) : undefined;

  const hooks: SandboxHooks = {
    selectedUnitId: selected ? selected.id : null,
    onUnitClick: (id) => {
      const unit = unitById(client.getState(), id);
      switch (tool) {
        case 'play':
          setSelectedId(id);
          return false;
        case 'delete':
          edit((s) => removeUnit(s, id), `Removed ${unit?.name ?? id}.`);
          if (selectedId === id) setSelectedId(null);
          return true;
        case 'terrain':
          if (unit) edit((s) => paintHex(s, unit.pos, paintFor(brush)));
          return true;
        default:
          setSelectedId(id);
          return true;
      }
    },
    onCellClick: (cell) => {
      switch (tool) {
        case 'play':
          return false;
        case 'spawn':
          edit((s) => spawnUnit(s, spawnOwner, template, cell));
          return true;
        case 'move':
          if (selectedId) edit((s) => teleportUnit(s, selectedId, cell));
          else say('Click a unit first, then the hex to move it to.', true);
          return true;
        case 'terrain':
          edit((s) => paintHex(s, cell, paintFor(brush)));
          return true;
        default:
          setSelectedId(null);
          return true;
      }
    },
  };

  return (
    <GameScreen client={client} onExit={onExit} onWatchReplay={() => {}} sandbox={hooks}>
      <div className={`sandbox${collapsed ? ' collapsed' : ''}`}>
        <div className="sandbox-head">
          <strong>Sandbox</strong>
          <button type="button" className="sb-mini" title="Undo (Ctrl+Z)" disabled={!info.canUndo} onClick={() => client.undo()}>
            ↶ Undo
          </button>
          <button type="button" className="sb-mini" title="Redo (Ctrl+Shift+Z)" disabled={!info.canRedo} onClick={() => client.redo()}>
            ↷ Redo
          </button>
          <button type="button" className="sb-mini" onClick={() => setCollapsed((c) => !c)}>
            {collapsed ? 'Show' : 'Hide'}
          </button>
        </div>
        {collapsed ? null : (
          <div className="sandbox-body">
            <div className="sb-tools">
              {TOOLS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={tool === t.id ? 'on' : ''}
                  title={t.hint}
                  onClick={() => setTool(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <p className="sb-hint">{TOOLS.find((t) => t.id === tool)!.hint}</p>
            {message ? <p className={message.error ? 'sb-msg error' : 'sb-msg'}>{message.text}</p> : null}

            {tool === 'spawn' ? (
              <SpawnSection
                palette={palette}
                owner={spawnOwner}
                onOwner={setSpawnOwner}
                template={template}
                onTemplate={setTemplate}
              />
            ) : null}
            {tool === 'terrain' ? <TerrainSection brush={brush} onBrush={setBrush} /> : null}

            {selected ? (
              <UnitSection
                unit={selected}
                state={state}
                onPatch={(patch) => edit((s) => patchUnit(s, selected.id, patch))}
                onActivate={(n) => edit((s) => activateUnit(s, selected.id, n), `${selected.name} acts with ${n} action${n > 1 ? 's' : ''}.`)}
                onDelete={() => {
                  edit((s) => removeUnit(s, selected.id), `Removed ${selected.name}.`);
                  setSelectedId(null);
                }}
                onTemplate={() => {
                  setTemplate(templateOf(selected));
                  setSpawnOwner(selected.owner);
                  setTool('spawn');
                }}
              />
            ) : null}

            <TurnSection state={state} client={client} info={info} edit={edit} />
            <DiceSection state={state} client={client} info={info} edit={edit} say={say} />
            <StateSection state={state} edit={edit} say={say} />
          </div>
        )}
      </div>
    </GameScreen>
  );
}

/** A unit's profile, for spawning copies of it. */
function templateOf(u: Unit): WarbandUnit {
  const t: WarbandUnit = { name: u.name, quality: u.quality, combat: u.combat, ...u.traits };
  if (u.look !== undefined) t.look = u.look;
  return t;
}

// --- Sections ---------------------------------------------------------------

function Section({ title, children, open = true }: { title: string; children: React.ReactNode; open?: boolean }) {
  return (
    <details className="sb-section" open={open}>
      <summary>{title}</summary>
      {children}
    </details>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  return (
    <label className="sb-num">
      {label}
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          if (Number.isFinite(n)) onChange(Math.max(min, Math.min(max, n)));
        }}
      />
    </label>
  );
}

const TRAITS = ['slow', 'fast', 'tough', 'guard', 'big', 'flying', 'reassembling'] as const;

/** Stat and trait fields shared by the spawn template and the unit inspector. */
function ProfileFields({
  profile,
  onChange,
}: {
  profile: WarbandUnit;
  onChange: (patch: Partial<WarbandUnit>) => void;
}) {
  return (
    <>
      <div className="sb-row">
        <NumberField label="Q" value={profile.quality} min={1} max={6} onChange={(quality) => onChange({ quality })} />
        <NumberField label="C" value={profile.combat} min={0} max={9} onChange={(combat) => onChange({ combat })} />
        <NumberField label="Rng" value={profile.ranged ?? 0} min={0} max={9} onChange={(ranged) => onChange({ ranged })} />
      </div>
      <div className="sb-row sb-checks">
        {TRAITS.map((t) => (
          <label key={t}>
            <input
              type="checkbox"
              checked={profile[t] ?? false}
              onChange={(e) => {
                const on = e.target.checked;
                // Slow and Fast exclude each other.
                if (on && t === 'slow') onChange({ slow: true, fast: false });
                else if (on && t === 'fast') onChange({ fast: true, slow: false });
                else onChange({ [t]: on });
              }}
            />
            {t}
          </label>
        ))}
      </div>
    </>
  );
}

function OwnerPicker({ value, onChange }: { value: Owner; onChange: (o: Owner) => void }) {
  return (
    <div className="sb-owner">
      {([0, 1] as const).map((o) => (
        <button key={o} type="button" className={`p${o}${value === o ? ' on' : ''}`} onClick={() => onChange(o)}>
          Player {o}
        </button>
      ))}
    </div>
  );
}

function SpawnSection({
  palette,
  owner,
  onOwner,
  template,
  onTemplate,
}: {
  palette: PaletteEntry[];
  owner: Owner;
  onOwner: (o: Owner) => void;
  template: WarbandUnit;
  onTemplate: (u: WarbandUnit) => void;
}) {
  const groups = useMemo(() => [...new Set(palette.map((p) => p.group))], [palette]);
  return (
    <Section title="Spawn template">
      <OwnerPicker value={owner} onChange={onOwner} />
      <select
        value=""
        onChange={(e) => {
          const entry = palette.find((p) => p.key === e.target.value);
          if (entry) onTemplate({ ...entry.unit });
        }}
      >
        <option value="">Load a unit profile…</option>
        {groups.map((g) => (
          <optgroup key={g} label={g}>
            {palette
              .filter((p) => p.group === g)
              .map((p) => (
                <option key={p.key} value={p.key}>
                  {p.unit.name} (Q{p.unit.quality} C{p.unit.combat} M{profileMove(p.unit)})
                </option>
              ))}
          </optgroup>
        ))}
      </select>
      <label className="sb-text">
        Name
        <input value={template.name} onChange={(e) => onTemplate({ ...template, name: e.target.value })} />
      </label>
      <ProfileFields profile={template} onChange={(patch) => onTemplate({ ...template, ...patch })} />
    </Section>
  );
}

function TerrainSection({ brush, onBrush }: { brush: Brush; onBrush: (b: Brush) => void }) {
  return (
    <Section title="Terrain brush">
      <div className="sb-row">
        <span className="sb-label">Height</span>
        {Array.from({ length: MAX_ELEVATION + 1 }, (_, h) => (
          <button
            key={h}
            type="button"
            className={brush.kind === 'elevation' && brush.value === h ? 'on' : ''}
            onClick={() => onBrush({ kind: 'elevation', value: h })}
          >
            {h}
          </button>
        ))}
      </div>
      <div className="sb-row">
        <span className="sb-label">Feature</span>
        {[null, ...TERRAIN_FEATURES].map((f) => (
          <button
            key={f ?? 'none'}
            type="button"
            className={brush.kind === 'feature' && brush.value === f ? 'on' : ''}
            onClick={() => onBrush({ kind: 'feature', value: f })}
          >
            {f ?? 'none'}
          </button>
        ))}
      </div>
      <div className="sb-row">
        <span className="sb-label">Blocked</span>
        {[true, false].map((b) => (
          <button
            key={String(b)}
            type="button"
            className={brush.kind === 'blocked' && brush.value === b ? 'on' : ''}
            onClick={() => onBrush({ kind: 'blocked', value: b })}
          >
            {b ? 'block' : 'unblock'}
          </button>
        ))}
      </div>
    </Section>
  );
}

function UnitSection({
  unit,
  state,
  onPatch,
  onActivate,
  onDelete,
  onTemplate,
}: {
  unit: Unit;
  state: GameState;
  onPatch: (patch: UnitPatch) => void;
  onActivate: (actions: number) => void;
  onDelete: () => void;
  onTemplate: () => void;
}) {
  const acting = state.activeUnitId === unit.id;
  return (
    <Section title={`Unit: ${unit.name}`}>
      <div className="sb-meta">
        {unit.id} · hex {unit.pos.x},{unit.pos.y}
        {acting ? ` · acting, ${state.actionsRemaining} action${state.actionsRemaining === 1 ? '' : 's'} left` : ''}
      </div>
      <label className="sb-text">
        Name
        <input value={unit.name} onChange={(e) => onPatch({ name: e.target.value })} />
      </label>
      <OwnerPicker value={unit.owner} onChange={(owner) => onPatch({ owner })} />
      <ProfileFields
        profile={templateOf(unit)}
        onChange={({ quality, combat, ...traits }) =>
          onPatch({
            ...(quality !== undefined ? { quality } : {}),
            ...(combat !== undefined ? { combat } : {}),
            traits,
          })
        }
      />
      <div className="sb-row sb-checks">
        {(
          [
            ['knockedDown', 'knocked down'],
            ['guarding', 'guarding'],
            ['activatedThisRound', 'activated'],
            ['dead', 'dead'],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            <input type="checkbox" checked={unit[key]} onChange={(e) => onPatch({ [key]: e.target.checked })} />
            {label}
          </label>
        ))}
      </div>
      <div className="sb-row">
        <span className="sb-label">Act now with</span>
        {[1, 2, 3].map((n) => (
          <button key={n} type="button" title={`Skip the roll: ${unit.name} acts with ${n} action(s)`} onClick={() => onActivate(n)} disabled={unit.dead}>
            {n}
          </button>
        ))}
      </div>
      <div className="sb-row">
        <button type="button" onClick={onTemplate}>
          Spawn copies…
        </button>
        <button type="button" className="danger" onClick={onDelete}>
          Delete
        </button>
      </div>
    </Section>
  );
}

type EditFn = (fn: (s: GameState) => GameState, done?: string) => boolean;

function TurnSection({
  state,
  client,
  info,
  edit,
}: {
  state: GameState;
  client: SandboxClient;
  info: SandboxInfo;
  edit: EditFn;
}) {
  const legal = client.legalCommands();
  const stuck = stuckReason(state, legal.length);
  const acting = state.activeUnitId ? unitById(state, state.activeUnitId) : undefined;
  return (
    <Section title="Turn">
      <div className="sb-meta">
        Round {state.round} · {state.phase}
        {state.phase === 'gameOver' ? ` · winner P${state.winner}` : ` · P${state.active} to act`}
        {acting ? ` · ${acting.name} (${state.actionsRemaining} left)` : ''}
        {state.benched.map((b, p) => (b ? ` · P${p} benched` : '')).join('')}
      </div>
      {stuck ? <p className="sb-msg error">Stuck: {stuck} Try "Fresh round".</p> : null}
      <div className="sb-row">
        <span className="sb-label">To act</span>
        {([0, 1] as const).map((o) => (
          <button key={o} type="button" className={`p${o}${state.active === o ? ' on' : ''}`} onClick={() => edit((s) => setActivePlayer(s, o))}>
            P{o}
          </button>
        ))}
        <button type="button" title="Everyone may activate again; no one benched" onClick={() => edit(freshRound, 'Fresh round: everyone is ready.')}>
          Fresh round
        </button>
      </div>
      <div className="sb-row">
        <span className="sb-label">Benched</span>
        {([0, 1] as const).map((o) => (
          <label key={o}>
            <input type="checkbox" checked={state.benched[o]} onChange={(e) => edit((s) => setBenched(s, o, e.target.checked))} />
            P{o}
          </label>
        ))}
        {state.phase === 'gameOver' ? (
          <button type="button" onClick={() => edit(resumeGame, 'Game resumed.')}>
            Resume game
          </button>
        ) : null}
      </div>
      <div className="sb-row">
        <NumberField label="Round" value={state.round} min={1} max={99} onChange={(n) => edit((s) => setRound(s, n))} />
        {state.mode ? (
          <>
            <NumberField label="P0 pts" value={state.mode.scores[0]} min={0} max={99} onChange={(n) => edit((s) => setScores(s, [n, s.mode!.scores[1]]))} />
            <NumberField label="P1 pts" value={state.mode.scores[1]} min={0} max={99} onChange={(n) => edit((s) => setScores(s, [s.mode!.scores[0], n]))} />
          </>
        ) : null}
      </div>
      <div className="sb-row">
        <span className="sb-label">AI plays</span>
        {([0, 1] as const).map((o) => (
          <label key={o}>
            <input type="checkbox" checked={info.aiSeats[o]} onChange={(e) => client.setAi(o, e.target.checked)} />
            P{o}
          </label>
        ))}
        <button type="button" title="The AI plays one command for whoever is to act" disabled={legal.length === 0} onClick={() => client.aiStep()}>
          AI: one step
        </button>
      </div>
      <details className="sb-legal">
        <summary>{legal.length} legal command{legal.length === 1 ? '' : 's'}</summary>
        <ul>
          {legal.map((c, i) => (
            <li key={i}>
              <button type="button" className="sb-link" onClick={() => client.send(c)}>
                {describeCommand(state, c)}
              </button>
            </li>
          ))}
        </ul>
      </details>
    </Section>
  );
}

function describeCommand(state: GameState, c: Command): string {
  const name = (id: string) => unitById(state, id)?.name ?? id;
  switch (c.type) {
    case 'ChooseActivation':
      return `Activate ${name(c.unitId)} with ${c.diceCount}d`;
    case 'Move':
      return `Move ${name(c.unitId)} → ${c.to.x},${c.to.y}`;
    case 'Attack':
      return `${c.power ? 'Power blow' : 'Attack'}: ${name(c.attackerId)} → ${name(c.targetId)}`;
    case 'Shoot':
      return `${c.aimed ? 'Aimed shot' : 'Shoot'}: ${name(c.attackerId)} → ${name(c.targetId)}`;
    case 'Guard':
      return `Guard: ${name(c.unitId)}`;
    case 'EndActivation':
      return 'End activation';
  }
}

function DiceSection({
  state,
  client,
  info,
  edit,
  say,
}: {
  state: GameState;
  client: SandboxClient;
  info: SandboxInfo;
  edit: EditFn;
  say: (text: string, error?: boolean) => void;
}) {
  const [pattern, setPattern] = useState('');
  // Picking a result arms it at once; "Off" disarms.
  const armedId = info.armed?.ruleId ?? '';
  const sticky = info.armed?.sticky ?? false;
  const [stickyPref, setStickyPref] = useState(false);
  const upcoming = peekDice(state, 8);
  const groups = [...new Set(OUTCOME_RULES.map((r) => r.group))];

  const applyPattern = (): void => {
    let dice;
    try {
      dice = parseDicePattern(pattern);
    } catch (e) {
      say(e instanceof Error ? e.message : String(e), true);
      return;
    }
    if (dice.length === 0) return;
    edit((s) => forceDice(s, dice), `The next dice will be ${dice.map((d) => d ?? '?').join(' ')}.`);
  };

  const last = info.lastForce;
  const lastRule = last ? outcomeRule(last.ruleId) : undefined;

  return (
    <Section title="Dice & outcomes">
      <div className="sb-meta">
        Next dice: <span className="sb-dice">{upcoming.join(' ')}</span>
      </div>
      <p className="sb-hint">
        Rolls are drawn in order: activation dice, then attacker/defender per clash, then nerve checks.
      </p>
      <form
        className="sb-row"
        onSubmit={(e) => {
          e.preventDefault();
          applyPattern();
        }}
      >
        <input
          className="sb-grow"
          placeholder={`e.g. 6 1 ? 4 (up to ${MAX_FORCED_DICE} fixed)`}
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
        />
        <button type="submit">Set</button>
        <button type="button" title="A fresh random RNG state" onClick={() => edit(rerollRng)}>
          Reroll
        </button>
      </form>

      <div className="sb-label">Force the next result</div>
      <div className="sb-row">
        <select
          className={`sb-grow${armedId ? ' armed' : ''}`}
          value={armedId}
          onChange={(e) => client.arm(e.target.value ? { ruleId: e.target.value, sticky: stickyPref } : null)}
        >
          <option value="">Off — roll normally</option>
          {groups.map((g) => (
            <optgroup key={g} label={g}>
              {OUTCOME_RULES.filter((r) => r.group === g).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      <div className="sb-row">
        <label title="Keep forcing it on every roll it applies to, instead of only the next one">
          <input
            type="checkbox"
            checked={info.armed ? sticky : stickyPref}
            onChange={(e) => {
              setStickyPref(e.target.checked);
              if (info.armed) client.arm({ ...info.armed, sticky: e.target.checked });
            }}
          />
          every time (otherwise just the next roll)
        </label>
      </div>
      {info.armed ? (
        <p className="sb-msg armed">
          Armed: {outcomeRule(info.armed.ruleId)?.label}
          {info.armed.sticky ? ' (every time)' : ' (next roll only)'}. Now make the roll.
        </p>
      ) : null}
      {last && lastRule ? (
        <p className={last.status.kind === 'impossible' ? 'sb-msg error' : 'sb-msg'}>
          {last.status.kind === 'impossible'
            ? `Couldn't force "${lastRule.label}": impossible here (e.g. a shot can't hurt the shooter, Tough survives its first kill, or the scores can't reach a double). It rolled normally.`
            : last.status.kind === 'forced'
              ? `Forced "${lastRule.label}"${last.status.tries === 0 ? ' (it came up anyway)' : ` after ${last.status.tries} ${last.status.tries === 1 ? 'try' : 'tries'}`}.`
              : ''}
        </p>
      ) : null}
    </Section>
  );
}

function StateSection({
  state,
  edit,
  say,
}: {
  state: GameState;
  edit: EditFn;
  say: (text: string, error?: boolean) => void;
}) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>(() => loadSnapshots(browserStorage()));
  const [name, setName] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const guard = (fn: () => void): void => {
    try {
      fn();
    } catch (e) {
      say(e instanceof Error ? e.message : String(e), true);
    }
  };

  const json = (): string => JSON.stringify(state, null, 2);

  return (
    <Section title="Board & state" open={false}>
      <div className="sb-row">
        <button type="button" onClick={() => edit((s) => clearUnits(s, 0), 'Cleared player 0.')}>
          Clear P0
        </button>
        <button type="button" onClick={() => edit((s) => clearUnits(s, 1), 'Cleared player 1.')}>
          Clear P1
        </button>
        <button type="button" className="danger" onClick={() => edit((s) => clearUnits(s), 'Cleared the board.')}>
          Clear all
        </button>
      </div>
      <form
        className="sb-row"
        onSubmit={(e) => {
          e.preventDefault();
          guard(() => {
            setSnapshots(saveSnapshot(browserStorage(), name, state));
            say(`Saved "${name.trim() || 'Untitled'}".`);
          });
        }}
      >
        <input className="sb-grow" placeholder="Snapshot name" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="submit">Save</button>
      </form>
      {snapshots.length > 0 ? (
        <ul className="sb-snapshots">
          {snapshots.map((snap) => (
            <li key={snap.name}>
              <button type="button" className="sb-link" title="Load this snapshot" onClick={() => edit(() => structuredClone(snap.state), `Loaded "${snap.name}".`)}>
                {snap.name}
              </button>
              <button
                type="button"
                className="sb-mini"
                title="Delete this snapshot"
                onClick={() => guard(() => setSnapshots(deleteSnapshot(browserStorage(), snap.name)))}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="sb-row">
        <button
          type="button"
          title="Copy the full GameState as JSON (e.g. for a regression test)"
          onClick={() =>
            void navigator.clipboard.writeText(json()).then(
              () => say('State JSON copied.'),
              () => say("Couldn't reach the clipboard.", true),
            )
          }
        >
          Copy JSON
        </button>
        <button
          type="button"
          onClick={() => {
            const url = URL.createObjectURL(new Blob([json()], { type: 'application/json' }));
            const a = document.createElement('a');
            a.href = url;
            a.download = `fansong-sandbox-${Date.now()}.json`;
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          Download
        </button>
        <button type="button" onClick={() => fileInput.current?.click()}>
          Load file…
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            try {
              const loaded = parseSandboxState(JSON.parse(await file.text()));
              edit(() => loaded, `Loaded ${file.name}.`);
            } catch (err) {
              say(err instanceof Error ? err.message : String(err), true);
            }
          }}
        />
      </div>
      <p className="sb-hint">
        Autosaved: open the app with <code>?dev=1&amp;sandbox</code> to resume here. From the console, <code>fansong</code>{' '}
        scripts the sandbox (e.g. <code>fansong.edit(s =&gt; …)</code>).
      </p>
    </Section>
  );
}
