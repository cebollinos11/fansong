import { useEffect, useMemo, useState } from 'react';
import {
  canRedo,
  canUndo,
  clearFlags,
  commitEdit,
  createHistory,
  MAP_LIMITS,
  MAX_BRUSH_RADIUS,
  newEditorMap,
  redoEdit,
  undoEdit,
  type EditorHistory,
} from '@fansong/content';
import { MAX_ELEVATION, type Vec } from '@fansong/engine';
import { BoardCanvas } from './BoardCanvas.js';
import {
  applyDrag,
  applyMapName,
  applyTool,
  clampMapSize,
  CONQUEST_LABELS,
  dragCells,
  editorValidation,
  hexMarkings,
  historyShortcut,
  MAX_FOOTPRINT_SIDE,
  MAX_MAP_NAME,
  mapOverlays,
  mapPreviewState,
  MODE_LABELS,
  toolDrags,
  ZONE_COLORS,
  type EditorTool,
} from './editorView.js';
import { describeHex } from './hexInfo.js';

interface Props {
  onExit: () => void;
}

const DEFAULT_WIDTH = 14;
const DEFAULT_HEIGHT = 12;

type ToolId =
  | 'select'
  | 'raise'
  | 'lower'
  | 'set'
  | 'erase'
  | 'building'
  | 'forest'
  | 'rock'
  | 'deploy0'
  | 'deploy1'
  | 'flag0'
  | 'flag1'
  | 'hill'
  | 'conquest0'
  | 'conquest1'
  | 'conquest2';

interface ToolDef {
  id: ToolId;
  label: string;
  title: string;
  /** Legend swatch (the tool's board overlay colour). */
  color?: number;
}

const TOOLS: ToolDef[] = [
  { id: 'select', label: 'Select', title: 'Inspect a hex' },
  { id: 'raise', label: 'Raise', title: 'Raise elevation by one' },
  { id: 'lower', label: 'Lower', title: 'Lower elevation by one' },
  { id: 'set', label: 'Set', title: 'Set elevation to a level' },
  { id: 'erase', label: 'Erase', title: 'Flatten and clear features' },
];

const FEATURE_TOOLS: ToolDef[] = [
  {
    id: 'building',
    label: 'Building',
    title: `Click to place/remove a building; drag to stamp a footprint (up to ${MAX_FOOTPRINT_SIDE}×${MAX_FOOTPRINT_SIDE})`,
  },
  {
    id: 'forest',
    label: 'Forest',
    title: 'Click to paint forest with the brush (click forest to clear it); drag to fill a region',
  },
  {
    id: 'rock',
    label: 'Rock',
    title: 'Click to paint rocks with the brush (click a rock to clear them); drag to fill a region',
  },
];

const ZONE_HINT = 'click the zone to remove hexes; drag to fill a region';

const OBJECTIVE_TOOLS: ToolDef[] = [
  ...([0, 1] as const).map((p) => ({
    id: `deploy${p}` as ToolId,
    label: `Deploy P${p + 1}`,
    title: `Paint player ${p + 1}'s deploy zone with the brush (${ZONE_HINT})`,
    color: ZONE_COLORS.deploy[p],
  })),
  ...([0, 1] as const).map((p) => ({
    id: `flag${p}` as ToolId,
    label: `Flag P${p + 1}`,
    title: `Click to place player ${p + 1}'s flag base (capture-the-flag)`,
    color: ZONE_COLORS.deploy[p],
  })),
  { id: 'hill', label: 'Hill', title: `Paint the king-of-the-hill zone (${ZONE_HINT})`, color: ZONE_COLORS.hill },
  ...([0, 1, 2] as const).map((i) => ({
    id: `conquest${i}` as ToolId,
    label: `Zone ${CONQUEST_LABELS[i]}`,
    title: `Paint conquest zone ${CONQUEST_LABELS[i]} (${ZONE_HINT})`,
    color: ZONE_COLORS.conquest[i],
  })),
];

const swatch = (color: number) => `#${color.toString(16).padStart(6, '0')}`;

interface ToolbarProps {
  label: string;
  tools: ToolDef[];
  active: ToolId;
  onPick: (id: ToolId) => void;
}

function Toolbar({ label, tools, active, onPick }: ToolbarProps): JSX.Element {
  return (
    <div className="editor-toolbar" role="group" aria-label={label}>
      {tools.map((t) => (
        <button
          key={t.id}
          type="button"
          title={t.title}
          aria-pressed={active === t.id}
          className={active === t.id ? 'tool active' : 'tool'}
          onClick={() => onPick(t.id)}
        >
          {t.color !== undefined ? <span className="swatch" style={{ background: swatch(t.color) }} /> : null}
          {t.label}
        </button>
      ))}
    </div>
  );
}

function toolFor(id: ToolId, level: number): EditorTool {
  switch (id) {
    case 'select':
      return { kind: 'select' };
    case 'erase':
      return { kind: 'erase' };
    case 'building':
      return { kind: 'building' };
    case 'forest':
    case 'rock':
      return { kind: 'area', feature: id };
    case 'set':
      return { kind: 'elevation', brush: { kind: 'set', value: level } };
    case 'deploy0':
    case 'deploy1':
      return { kind: 'zone', zone: { kind: 'deploy', player: id === 'deploy0' ? 0 : 1 } };
    case 'flag0':
    case 'flag1':
      return { kind: 'flag', player: id === 'flag0' ? 0 : 1 };
    case 'hill':
      return { kind: 'zone', zone: { kind: 'hill' } };
    case 'conquest0':
    case 'conquest1':
    case 'conquest2':
      return { kind: 'zone', zone: { kind: 'conquest', index: Number(id.slice(-1)) as 0 | 1 | 2 } };
    default:
      return { kind: 'elevation', brush: { kind: id } };
  }
}

/**
 * The terrain editor. The map lives in an {@link EditorHistory} (pure ops from
 * `@fansong/content`); the board is rendered through the same {@link BoardCanvas}
 * as play, rebuilt after each edit. Clicking a hex selects it and, with a
 * painting tool active, applies that tool's brush there as one undo step.
 * Drag tools (buildings, forest, rocks, zones) stamp/fill the dragged region on release instead.
 * Deploy zones and objectives are drawn as tinted overlays. Undo/redo (buttons
 * or Ctrl+Z / Ctrl+Y) walk the history; the map name is committed on blur/Enter
 * as one undo step; `validateMap` problems are listed inline as the map changes.
 */
export function EditorScreen({ onExit }: Props): JSX.Element {
  const [history, setHistory] = useState<EditorHistory>(() =>
    createHistory(newEditorMap(DEFAULT_WIDTH, DEFAULT_HEIGHT)),
  );
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const [selected, setSelected] = useState<Vec | null>(null);
  const [toolId, setToolId] = useState<ToolId>('raise');
  const [level, setLevel] = useState(1);
  const [radius, setRadius] = useState(0);
  /** The footprint of an in-progress drag, previewed as highlighted hexes. */
  const [dragPreview, setDragPreview] = useState<Vec[] | null>(null);

  const map = history.present;
  const tool = toolFor(toolId, level);
  const state = useMemo(() => mapPreviewState(map), [map]);
  const overlays = useMemo(() => mapOverlays(map), [map]);
  const selectedInfo = selected ? describeHex(state, selected) : null;
  const selectedMarks = selected ? hexMarkings(map, selected) : [];
  const highlight = useMemo(() => dragPreview ?? (selected ? [selected] : []), [dragPreview, selected]);
  const validation = useMemo(() => editorValidation(map), [map]);

  const undo = (): void => setHistory(undoEdit);
  const redo = (): void => setHistory(redoEdit);

  // Ctrl/⌘+Z undoes, Ctrl/⌘+Y or Ctrl/⌘+Shift+Z redoes — except while typing in a field.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      const action = historyShortcut(e);
      if (!action) return;
      e.preventDefault();
      setHistory(action === 'undo' ? undoEdit : redoEdit);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const rename = (raw: string): void => setHistory((h) => commitEdit(h, applyMapName(h.present, raw)));

  const newMap = (): void => {
    const w = clampMapSize(width, 'width');
    const h = clampMapSize(height, 'height');
    setWidth(w);
    setHeight(h);
    setSelected(null);
    setHistory(createHistory(newEditorMap(w, h, map.name)));
  };

  const onCellClick = (cell: Vec): void => {
    setSelected(cell);
    setHistory((h) => commitEdit(h, applyTool(h.present, tool, cell, radius)));
  };

  // A drag previews its footprint and commits it as one undo step on release.
  const onCellDrag = (from: Vec, to: Vec, done: boolean): void => {
    if (!done) return setDragPreview(dragCells(map, tool, from, to));
    setDragPreview(null);
    setSelected(to);
    setHistory((h) => commitEdit(h, applyDrag(h.present, tool, from, to)));
  };

  return (
    <div className="game">
      <BoardCanvas
        state={state}
        moveTargets={highlight}
        attackTargetIds={[]}
        selectableUnitIds={[]}
        selectedUnitId={null}
        interactive
        events={[]}
        onUnitClick={() => {}}
        onCellClick={onCellClick}
        onCellDrag={toolDrags(tool) ? onCellDrag : undefined}
        liveTerrain
        overlays={overlays}
      />
      <div className="hud">
        <div className="hud-top">
          <h2>Map editor</h2>
          <button className="ghost" onClick={onExit}>
            ⟵ Back
          </button>
        </div>

        <div className="editor-meta">
          <label>
            Name
            {/* Uncontrolled and keyed on the name, so undo/redo of a rename resets the field. */}
            <input
              key={map.name}
              type="text"
              defaultValue={map.name}
              maxLength={MAX_MAP_NAME}
              aria-label="Map name"
              onBlur={(e) => {
                rename(e.target.value);
                e.target.value = applyMapName(map, e.target.value).name;
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') {
                  e.currentTarget.value = map.name;
                  e.currentTarget.blur();
                }
              }}
            />
          </label>
          <span className="hint">
            {map.id} · {map.width}×{map.height}
          </span>
          <div className="editor-history" role="group" aria-label="History">
            <button type="button" title="Undo (Ctrl+Z)" disabled={!canUndo(history)} onClick={undo}>
              ↶ Undo
            </button>
            <button type="button" title="Redo (Ctrl+Y)" disabled={!canRedo(history)} onClick={redo}>
              ↷ Redo
            </button>
          </div>
        </div>

        <div className={validation.ok ? 'editor-validation ok' : 'editor-validation'} aria-live="polite">
          {validation.ok ? (
            <p>
              ✓ Valid · modes: {validation.modes.map((m) => MODE_LABELS[m]).join(', ')}
            </p>
          ) : (
            <>
              <p className="error">Map has problems:</p>
              <ul>
                {validation.errors.map((err) => (
                  <li key={err}>{err}</li>
                ))}
              </ul>
            </>
          )}
        </div>

        <fieldset className="editor-new">
          <legend>New map</legend>
          <label>
            Width
            <input
              type="number"
              min={MAP_LIMITS.minWidth}
              max={MAP_LIMITS.maxWidth}
              value={width}
              onChange={(e) => setWidth(parseInt(e.target.value, 10))}
            />
          </label>
          <label>
            Height
            <input
              type="number"
              min={MAP_LIMITS.minHeight}
              max={MAP_LIMITS.maxHeight}
              value={height}
              onChange={(e) => setHeight(parseInt(e.target.value, 10))}
            />
          </label>
          <button onClick={newMap}>New map</button>
        </fieldset>

        <fieldset className="editor-tools">
          <legend>Terrain</legend>
          <Toolbar label="Tool" tools={TOOLS} active={toolId} onPick={setToolId} />
          <label>
            Level
            <select value={level} disabled={toolId !== 'set'} onChange={(e) => setLevel(parseInt(e.target.value, 10))}>
              {Array.from({ length: MAX_ELEVATION + 1 }, (_, e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </label>
          <label>
            Brush
            <select
              value={radius}
              disabled={toolId === 'select' || toolId === 'building' || tool.kind === 'flag'}
              onChange={(e) => setRadius(parseInt(e.target.value, 10))}
            >
              {Array.from({ length: MAX_BRUSH_RADIUS + 1 }, (_, r) => (
                <option key={r} value={r}>
                  {r === 0 ? 'Single hex' : `Radius ${r}`}
                </option>
              ))}
            </select>
          </label>
        </fieldset>

        <fieldset className="editor-tools">
          <legend>Features</legend>
          <Toolbar label="Feature tool" tools={FEATURE_TOOLS} active={toolId} onPick={setToolId} />
          {tool.kind === 'building' ? (
            <p className="hint">Click: single hex · drag: footprint · middle-drag orbits.</p>
          ) : tool.kind === 'area' ? (
            <p className="hint">
              Click: brush (on a {tool.feature}: clears) · drag: fill region (from a {tool.feature}: clears) ·
              middle-drag orbits.
            </p>
          ) : null}
        </fieldset>

        <fieldset className="editor-tools">
          <legend>Zones &amp; objectives</legend>
          <Toolbar label="Zone tool" tools={OBJECTIVE_TOOLS} active={toolId} onPick={setToolId} />
          {tool.kind === 'zone' ? (
            <p className="hint">Click: brush (on the zone: removes) · drag: fill region · middle-drag orbits.</p>
          ) : tool.kind === 'flag' ? (
            <p className="hint">Click a hex to move the flag base (the first flag mirrors the other).</p>
          ) : null}
          <p className="hint">
            P1 deploy {map.deployZones[0].length} · P2 deploy {map.deployZones[1].length} · hill{' '}
            {map.objectives.hill?.length ?? 0} · conquest{' '}
            {map.objectives.conquest ? map.objectives.conquest.map((z) => z.length).join('/') : '—'} · flags{' '}
            {map.objectives.flags ? 'set' : '—'}
          </p>
          <button
            type="button"
            className="ghost"
            disabled={!map.objectives.flags}
            onClick={() => setHistory((h) => commitEdit(h, clearFlags(h.present)))}
          >
            Remove flags
          </button>
        </fieldset>

        <div className="editor-selection">
          <h3>Selected hex</h3>
          {selectedInfo ? (
            <>
              <strong>{selectedInfo.title}</strong>
              {[...selectedInfo.lines, ...selectedMarks].map((line) => (
                <div key={line}>{line}</div>
              ))}
            </>
          ) : (
            <p className="muted">Click a hex to select it.</p>
          )}
        </div>
      </div>
    </div>
  );
}
