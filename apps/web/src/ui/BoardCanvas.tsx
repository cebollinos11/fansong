import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { unitById, type GameEvent, type GameState, type Owner, type Vec } from '@fansong/engine';
import { BoardView, type BoardViewModel, type CameraMode, type HexOverlay } from '../three/BoardView.js';
import type { PlanPreview, ReachTile } from '../game/planView.js';
import { describeHex } from './hexInfo.js';
import { modeMarkers, modeMarkingsKey, modeOverlays, unitBadges } from './modeView.js';
import { UnitDiceMenu } from './UnitDiceMenu.js';

interface Props {
  state: GameState;
  /** Hexes the active unit can reach this activation, each with its action cost. */
  reach: ReachTile[];
  /** Enemies it can strike where it stands. */
  attackTargetIds: string[];
  /** Enemies it could strike after walking in. */
  approachTargetIds?: string[];
  /** Of those targets, the ones it would shoot rather than strike in melee. */
  shootTargetIds?: string[];
  /**
   * What hovering a hex would commit, for the route preview. Kept as a callback
   * so the board can ask on each new hex without re-rendering per frame.
   */
  previewFor?: (cell: Vec) => PlanPreview | null;
  selectableUnitIds: string[];
  selectedUnitId: string | null;
  interactive: boolean;
  /** Seats this screen commands; other sides' moves trace their route first (unset: every move). */
  localSeats?: readonly Owner[];
  /** The most recent batch of engine events, for transient FX. A new empty batch cuts pending FX short. */
  events: GameEvent[];
  /** Called once per new `events` batch with how long (ms) its animations take to play out. */
  onEventsPlayed?: (ms: number) => void;
  onUnitClick: (id: string) => void;
  onCellClick: (cell: Vec) => void;
  /**
   * Rebuild the terrain whenever `state.board` changes (the editor). Off in
   * play, where the board never changes but is cloned with every command.
   */
  liveTerrain?: boolean;
  /** Tinted hex sets (editor deploy zones and objectives); defaults to the game mode's objective zones. */
  overlays?: HexOverlay[];
  /**
   * Editor drag painting: when set, left-drag reports the press cell and the
   * current cell (then once more with `done`) instead of orbiting the camera.
   */
  onCellDrag?: (from: Vec, to: Vec, done: boolean) => void;
  /**
   * This board is playing out a match (not the editor): it shows the camera
   * controls and whose turn it is, and the spacebar skips an animation.
   */
  playing?: boolean;
  /** Watching a recording: there is no "your turn", so the turn edge stays quiet. */
  spectating?: boolean;
  /**
   * Dice counts the selected unit may commit. When there are any, the choice
   * floats over that unit so it can be answered where the click was made.
   */
  diceChoices?: readonly number[];
  onChooseDice?: (dice: number) => void;
  /** Shown briefly over the board when a new round begins; null the rest of the time. */
  announcement?: { round: number; owner: Owner; turnLabel: string } | null;
}

const CAMERA_KEY = 'fansong.cameraMode';
/** Cycled by the camera button, in this order. */
const CAMERA_MODES: CameraMode[] = ['cinematic', 'follow', 'off'];
const CAMERA_LABEL: Record<CameraMode, string> = {
  cinematic: 'Camera: cinematic',
  follow: 'Camera: follow',
  off: 'Camera: manual',
};
const CAMERA_HINT: Record<CameraMode, string> = {
  cinematic: 'Frames every blow up close; click to follow off-screen action only',
  follow: 'Pans to action happening off-screen; click to leave the camera alone',
  off: 'The camera stays where you put it; click for the full cinematic camera',
};

/** The remembered camera choice (cinematic unless changed; storage may be unavailable). */
function loadCameraMode(): CameraMode {
  try {
    const saved = localStorage.getItem(CAMERA_KEY);
    return CAMERA_MODES.find((m) => m === saved) ?? 'cinematic';
  } catch {
    return 'cinematic';
  }
}

function saveCameraMode(mode: CameraMode): void {
  try {
    localStorage.setItem(CAMERA_KEY, mode);
  } catch {
    // Not remembered; the button still works for this session.
  }
}

/** React wrapper that mounts a {@link BoardView} and keeps it in sync with props. */
export function BoardCanvas(props: Props): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<BoardView | null>(null);
  const [hover, setHover] = useState<Vec | null>(null);
  const [cameraMode, setCameraMode] = useState(loadCameraMode);
  // Keep click handlers in a ref so the (long-lived) BoardView always calls the latest.
  const handlers = useRef({
    onUnitClick: props.onUnitClick,
    onCellClick: props.onCellClick,
    onCellDrag: props.onCellDrag,
    onEventsPlayed: props.onEventsPlayed,
  });
  handlers.current = {
    onUnitClick: props.onUnitClick,
    onCellClick: props.onCellClick,
    onCellDrag: props.onCellDrag,
    onEventsPlayed: props.onEventsPlayed,
  };

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

  // Editor and sandbox: re-draw the terrain after an edit (the mount effect drew
  // the first board). Compared by content, since play clones the board per command.
  const boardKey = useMemo(
    () => (props.liveTerrain ? JSON.stringify(props.state.board) : ''),
    [props.liveTerrain, props.state.board],
  );
  const builtBoard = useRef(boardKey);
  useEffect(() => {
    if (!props.liveTerrain || builtBoard.current === boardKey) return;
    builtBoard.current = boardKey;
    viewRef.current?.buildBoard(props.state);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.liveTerrain, boardKey]);

  // Editor: switch left-drag between orbiting and drag painting.
  const dragging = props.onCellDrag !== undefined;
  useEffect(() => {
    viewRef.current?.setCellDrag(dragging ? (from, to, done) => handlers.current.onCellDrag?.(from, to, done) : null);
  }, [dragging]);

  // Only a board that plays out a game moves its camera (the editor has nothing to follow).
  const mode: CameraMode = props.playing ? cameraMode : 'off';
  useEffect(() => {
    if (viewRef.current) viewRef.current.cameraMode = mode;
  }, [mode]);

  // Space skips to the end of whatever is playing out.
  useEffect(() => {
    if (!props.playing) return;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.code !== 'Space' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName))) return;
      e.preventDefault();
      // Tell the queue the batch is done, so the next one starts at once.
      if (viewRef.current?.skipAnimations()) handlers.current.onEventsPlayed?.(0);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [props.playing]);

  // Game-mode markings, recomputed only when they change (the state is cloned per command).
  const markingsKey = modeMarkingsKey(props.state);
  const markings = useMemo(
    () => ({ overlays: modeOverlays(props.state), markers: modeMarkers(props.state), badges: unitBadges(props.state) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [markingsKey],
  );
  const overlays = props.overlays ?? markings.overlays;
  // A client may hand over a fresh array each render; only a change of seats matters.
  const seatsKey = props.localSeats?.join(',');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const localSeats = useMemo(() => props.localSeats, [seatsKey]);

  // Reconcile visuals on every relevant change.
  useEffect(() => {
    const vm: BoardViewModel = {
      state: props.state,
      reach: props.reach,
      attackTargetIds: props.attackTargetIds,
      approachTargetIds: props.approachTargetIds ?? [],
      shootTargetIds: props.shootTargetIds ?? [],
      selectableUnitIds: props.selectableUnitIds,
      selectedUnitId: props.selectedUnitId,
      interactive: props.interactive,
      localSeats,
      overlays,
      markers: markings.markers,
      badges: markings.badges,
      markingsKey,
    };
    viewRef.current?.update(vm);
  }, [
    props.state,
    props.reach,
    props.attackTargetIds,
    props.approachTargetIds,
    props.shootTargetIds,
    props.selectableUnitIds,
    props.selectedUnitId,
    props.interactive,
    localSeats,
    overlays,
    markings,
    markingsKey,
  ]);

  // Fire transient FX when a new event batch arrives; an empty batch (a replay
  // jump, a resync) drops whatever was still playing.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    let ms = 0;
    if (props.events.length > 0) ms = view.animateEvents(props.events);
    else view.clearAnimations();
    handlers.current.onEventsPlayed?.(ms);
  }, [props.events]);

  // Trace the hovered plan. `hover` changes only when the pointer crosses into a
  // new hex (BoardView dedupes it), so this costs nothing while the pointer drifts.
  const previewFor = props.previewFor;
  useEffect(() => {
    viewRef.current?.setPlanPreview(hover && previewFor ? previewFor(hover) : null);
  }, [hover, previewFor]);

  const hexInfo = hover ? describeHex(props.state, hover, previewFor?.(hover) ?? null) : null;

  // Stable across renders so the menu's follow loop isn't torn down each frame.
  const project = useCallback(
    (id: string, height: number) => viewRef.current?.projectUnit(id, height) ?? null,
    [],
  );
  const diceMenuUnit =
    props.selectedUnitId && props.diceChoices && props.diceChoices.length > 0 && props.onChooseDice
      ? unitById(props.state, props.selectedUnitId)
      : null;

  return (
    <div className="board-wrap">
      <div ref={containerRef} className="board-canvas" />
      {props.announcement ? (
        <div key={props.announcement.round} className={`round-announce p${props.announcement.owner}`}>
          <div className="round-announce-round">Round {props.announcement.round}</div>
          <div className="round-announce-turn">{props.announcement.turnLabel}</div>
        </div>
      ) : null}
      {props.playing && props.state.phase !== 'gameOver' ? (
        // Whose turn it is, around the board itself: a camera move that arrives
        // with the other side's colour reads as "they are doing something".
        <div
          className={`board-edge p${props.state.active}${props.interactive || props.spectating ? '' : ' waiting'}`}
        />
      ) : null}
      {diceMenuUnit ? (
        <UnitDiceMenu
          unitId={diceMenuUnit.id}
          unitName={diceMenuUnit.name}
          owner={diceMenuUnit.owner}
          quality={diceMenuUnit.quality}
          choices={props.diceChoices ?? []}
          project={project}
          onPick={(n) => props.onChooseDice?.(n)}
        />
      ) : null}
      {hexInfo ? (
        <div className="hex-tooltip">
          <strong>{hexInfo.title}</strong>
          {hexInfo.lines.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>
      ) : null}
      <div className="board-tools">
        <button
          type="button"
          className="board-reset-view"
          title="Reset camera (drag to orbit, right-drag to pan, wheel to zoom)"
          onClick={() => viewRef.current?.resetCamera()}
        >
          Reset view
        </button>
        {props.playing ? (
          <button
            type="button"
            className={`board-follow${cameraMode === 'off' ? '' : ' on'}`}
            title={CAMERA_HINT[cameraMode]}
            onClick={() => {
              const next = CAMERA_MODES[(CAMERA_MODES.indexOf(cameraMode) + 1) % CAMERA_MODES.length]!;
              setCameraMode(next);
              saveCameraMode(next);
            }}
          >
            {CAMERA_LABEL[cameraMode]}
          </button>
        ) : null}
      </div>
    </div>
  );
}
