import { useEffect, useRef } from 'react';
import type { GameEvent, GameState, Vec } from '@fansong/engine';
import { BoardView, type BoardViewModel } from '../three/BoardView.js';

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
}

/** React wrapper that mounts a {@link BoardView} and keeps it in sync with props. */
export function BoardCanvas(props: Props): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<BoardView | null>(null);
  // Keep click handlers in a ref so the (long-lived) BoardView always calls the latest.
  const handlers = useRef({ onUnitClick: props.onUnitClick, onCellClick: props.onCellClick });
  handlers.current = { onUnitClick: props.onUnitClick, onCellClick: props.onCellClick };

  // Mount once.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const view = new BoardView(container);
    view.onUnitClick = (id) => handlers.current.onUnitClick(id);
    view.onCellClick = (cell) => handlers.current.onCellClick(cell);
    view.buildBoard(props.state);
    viewRef.current = view;
    return () => {
      view.dispose();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  return (
    <div className="board-wrap">
      <div ref={containerRef} className="board-canvas" />
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
