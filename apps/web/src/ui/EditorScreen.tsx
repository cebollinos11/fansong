import { useMemo, useState } from 'react';
import {
  commitEdit,
  createHistory,
  MAP_LIMITS,
  MAX_BRUSH_RADIUS,
  newEditorMap,
  type EditorHistory,
} from '@fansong/content';
import { MAX_ELEVATION, type Vec } from '@fansong/engine';
import { BoardCanvas } from './BoardCanvas.js';
import { applyTool, clampMapSize, mapPreviewState, type EditorTool } from './editorView.js';
import { describeHex } from './hexInfo.js';

interface Props {
  onExit: () => void;
}

const DEFAULT_WIDTH = 14;
const DEFAULT_HEIGHT = 12;

type ToolId = 'select' | 'raise' | 'lower' | 'set' | 'erase';

const TOOLS: { id: ToolId; label: string; title: string }[] = [
  { id: 'select', label: 'Select', title: 'Inspect a hex' },
  { id: 'raise', label: 'Raise', title: 'Raise elevation by one' },
  { id: 'lower', label: 'Lower', title: 'Lower elevation by one' },
  { id: 'set', label: 'Set', title: 'Set elevation to a level' },
  { id: 'erase', label: 'Erase', title: 'Flatten and clear features' },
];

function toolFor(id: ToolId, level: number): EditorTool {
  switch (id) {
    case 'select':
      return { kind: 'select' };
    case 'erase':
      return { kind: 'erase' };
    case 'set':
      return { kind: 'elevation', brush: { kind: 'set', value: level } };
    default:
      return { kind: 'elevation', brush: { kind: id } };
  }
}

/**
 * The terrain editor. The map lives in an {@link EditorHistory} (pure ops from
 * `@fansong/content`); the board is rendered through the same {@link BoardCanvas}
 * as play, rebuilt after each edit. Clicking a hex selects it and, with a
 * painting tool active, applies that tool's brush there as one undo step.
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

  const map = history.present;
  const state = useMemo(() => mapPreviewState(map), [map]);
  const selectedInfo = selected ? describeHex(state, selected) : null;
  const highlight = useMemo(() => (selected ? [selected] : []), [selected]);

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
    setHistory((h) => commitEdit(h, applyTool(h.present, toolFor(toolId, level), cell, radius)));
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
        liveTerrain
      />
      <div className="hud">
        <div className="hud-top">
          <h2>Map editor</h2>
          <button className="ghost" onClick={onExit}>
            ⟵ Back
          </button>
        </div>

        <p className="hint">
          {map.name} · {map.width}×{map.height}
        </p>

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
          <div className="editor-toolbar" role="group" aria-label="Tool">
            {TOOLS.map((t) => (
              <button
                key={t.id}
                type="button"
                title={t.title}
                aria-pressed={toolId === t.id}
                className={toolId === t.id ? 'tool active' : 'tool'}
                onClick={() => setToolId(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
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
              disabled={toolId === 'select'}
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

        <div className="editor-selection">
          <h3>Selected hex</h3>
          {selectedInfo ? (
            <>
              <strong>{selectedInfo.title}</strong>
              {selectedInfo.lines.map((line) => (
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
