import { useEffect, useRef, useState } from 'react';
import type { GameEvent, GameState, Vec } from '@fansong/engine';
import { BoardView, type BoardViewModel } from '../three/BoardView.js';
import { describeHex } from './hexInfo.js';

interface Props {
  state: GameState;
  moveTargets: Vec[];
  attackTargetIds: string[];
  selectableUnitIds: string[];
  selectedUnitId: string | null;
  interactive: boolean;
  /** The most recent batch of engine events, for transient FX. */
  events: GameEvent[];
  onUnitClick: (id: string) => void;
  onCellClick: (cell: Vec) => void;
  /**
   * Rebuild the terrain whenever `state.board` changes (the editor). Off in
   * play, where the board never changes but is cloned with every command.
   */
  liveTerrain?: boolean;
  /**
   * Editor drag painting: when set, left-drag reports the press cell and the
   * current cell (then once more with `done`) instead of orbiting the camera.
   */
  onCellDrag?: (from: Vec, to: Vec, done: boolean) => void;
}

/** React wrapper that mounts a {@link BoardView} and keeps it in sync with props. */
export function BoardCanvas(props: Props): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<BoardView | null>(null);
  const [hover, setHover] = useState<Vec | null>(null);
  // Keep click handlers in a ref so the (long-lived) BoardView always calls the latest.
  const handlers = useRef({ onUnitClick: props.onUnitClick, onCellClick: props.onCellClick, onCellDrag: props.onCellDrag });
  handlers.current = { onUnitClick: props.onUnitClick, onCellClick: props.onCellClick, onCellDrag: props.onCellDrag };

  // Mount once.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const view = new BoardView(container);
    view.onUnitClick = (id) => handlers.current.onUnitClick(id);
    view.onCellClick = (cell) => handlers.current.onCellClick(cell);
    view.onCellHover = setHover;
    view.buildBoard(props.state);
    viewRef.current = view;
    return () => {
      view.dispose();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Editor: re-draw the terrain after an edit (the mount effect drew the first board).
  const builtBoard = useRef(props.state.board);
  useEffect(() => {
    if (!props.liveTerrain || builtBoard.current === props.state.board) return;
    builtBoard.current = props.state.board;
    viewRef.current?.buildBoard(props.state);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.liveTerrain, props.state.board]);

  // Editor: switch left-drag between orbiting and drag painting.
  const dragging = props.onCellDrag !== undefined;
  useEffect(() => {
    viewRef.current?.setCellDrag(dragging ? (from, to, done) => handlers.current.onCellDrag?.(from, to, done) : null);
  }, [dragging]);

  // Reconcile visuals on every relevant change.
  useEffect(() => {
    const vm: BoardViewModel = {
      state: props.state,
      moveTargets: props.moveTargets,
      attackTargetIds: props.attackTargetIds,
      selectableUnitIds: props.selectableUnitIds,
      selectedUnitId: props.selectedUnitId,
      interactive: props.interactive,
    };
    viewRef.current?.update(vm);
  }, [
    props.state,
    props.moveTargets,
    props.attackTargetIds,
    props.selectableUnitIds,
    props.selectedUnitId,
    props.interactive,
  ]);

  // Fire transient FX when a new event batch arrives.
  useEffect(() => {
    if (props.events.length > 0) viewRef.current?.animateEvents(props.events);
  }, [props.events]);

  const hexInfo = hover ? describeHex(props.state, hover) : null;

  return (
    <div className="board-wrap">
      <div ref={containerRef} className="board-canvas" />
      {hexInfo ? (
        <div className="hex-tooltip">
          <strong>{hexInfo.title}</strong>
          {hexInfo.lines.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>
      ) : null}
      <button
        type="button"
        className="board-reset-view"
        title="Reset camera (drag to orbit, right-drag to pan, wheel to zoom)"
        onClick={() => viewRef.current?.resetCamera()}
      >
        Reset view
      </button>
    </div>
  );
}
