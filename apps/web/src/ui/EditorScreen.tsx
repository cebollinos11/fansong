import { useMemo, useState } from 'react';
import { createHistory, MAP_LIMITS, newEditorMap, type EditorHistory } from '@fansong/content';
import type { Vec } from '@fansong/engine';
import { BoardCanvas } from './BoardCanvas.js';
import { clampMapSize, mapPreviewState } from './editorView.js';
import { describeHex } from './hexInfo.js';

interface Props {
  onExit: () => void;
}

const DEFAULT_WIDTH = 14;
const DEFAULT_HEIGHT = 12;

/**
 * The terrain editor. The map lives in an {@link EditorHistory} (pure ops from
 * `@fansong/content`); the board is rendered through the same {@link BoardCanvas}
 * as play, rebuilt after each edit. Clicking a hex selects it.
 */
export function EditorScreen({ onExit }: Props): JSX.Element {
  const [history, setHistory] = useState<EditorHistory>(() =>
    createHistory(newEditorMap(DEFAULT_WIDTH, DEFAULT_HEIGHT)),
  );
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const [selected, setSelected] = useState<Vec | null>(null);

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
        onCellClick={setSelected}
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
