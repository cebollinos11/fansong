import { useEffect, useMemo, useRef, useState } from 'react';
import { runReplay, type GameEvent, type Replay } from '@fansong/engine';
import { BoardCanvas } from './BoardCanvas.js';
import { downloadReplay } from '../game/replay-io.js';
import { BattleLogView, type LogFocus } from './BattleLogView.js';
import { buildLog } from './log.js';

interface Props {
  replay: Replay;
  onExit: () => void;
}

/** Auto-play: the least time per step, and the pause after a step's animations. */
const PLAY_INTERVAL_MS = 900;
const PLAY_GAP_MS = 300;

/**
 * A step-through viewer over a {@link Replay}. It re-derives every frame purely
 * with `runReplay` (no AI, no network) and drives the same {@link BoardCanvas}
 * the live game uses, so movement, combat, and the new trait/morale FX animate
 * exactly as they did in play. Index 0 is the initial deployment; index k is the
 * state after the k-th command.
 */
export function ReplayScreen({ replay, onExit }: Props): JSX.Element {
  const run = useMemo(() => runReplay(replay), [replay]);
  const total = replay.commands.length;

  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  // Events handed to the board for FX — only when stepping forward by one.
  const [fx, setFx] = useState<GameEvent[]>([]);
  // How long the latest step's animations (dice, blows) take, so auto-play waits for them.
  const stepMs = useRef(0);

  const state = index === 0 ? run.initial : run.frames[index - 1]!;
  // The log as it stood after this step; ids are stable, so scrubbing keeps what the reader opened.
  const log = useMemo(
    () =>
      buildLog(
        run.initial.round,
        run.frames.slice(0, index).map((frame, i) => ({ state: frame, events: run.events[i]! })),
      ),
    [run, index],
  );
  const [logFocus, setLogFocus] = useState<LogFocus | null>(null);

  // Step exactly one command forward, animating that command's events.
  const stepForward = useRef<() => void>(() => {});
  stepForward.current = () => {
    setIndex((i) => {
      if (i >= total) return i;
      setFx(run.events[i] ?? []); // events of command (i+1), i.e. the one we're applying
      return i + 1;
    });
  };

  const jumpTo = (i: number): void => {
    setPlaying(false);
    setFx([]);
    setIndex(Math.max(0, Math.min(total, i)));
  };

  // Auto-advance while playing; stop at the end.
  useEffect(() => {
    if (!playing) return;
    if (index >= total) {
      setPlaying(false);
      return;
    }
    // The board reports the step's duration from its own (child) effect, which runs before this one.
    const id = setTimeout(() => stepForward.current(), Math.max(PLAY_INTERVAL_MS, stepMs.current + PLAY_GAP_MS));
    return () => clearTimeout(id);
  }, [playing, index, total]);

  const atEnd = index >= total;
  const winnerLine =
    state.phase === 'gameOver' && state.winner !== null ? `Player ${state.winner} wins` : null;

  return (
    <div className="game">
      <BoardCanvas
        state={state}
        reach={[]}
        attackTargetIds={[]}
        selectableUnitIds={[]}
        selectedUnitId={null}
        focusUnitIds={logFocus?.unitIds ?? []}
        focusPath={logFocus?.path}
        interactive={false}
        events={fx}
        onEventsPlayed={(ms) => (stepMs.current = ms)}
        onUnitClick={() => {}}
        onCellClick={() => {}}
        playing
        spectating
      />
      <div className="hud">
        <div className="hud-top">
          <h2>Replay</h2>
          <button className="ghost" onClick={onExit}>
            ⟵ Back
          </button>
        </div>

        <p className="hint">
          Round {state.round} · step {index} / {total}
          {winnerLine ? ` · ${winnerLine}` : ''}
        </p>

        <div className="replay-controls">
          <button onClick={() => jumpTo(0)} disabled={index === 0} title="First">
            ⏮
          </button>
          <button onClick={() => jumpTo(index - 1)} disabled={index === 0} title="Previous">
            ◀
          </button>
          <button onClick={() => setPlaying((p) => !p)} disabled={atEnd} title={playing ? 'Pause' : 'Play'}>
            {playing ? '⏸' : '▶'}
          </button>
          <button onClick={() => stepForward.current()} disabled={atEnd} title="Next">
            ▶▶
          </button>
          <button onClick={() => jumpTo(total)} disabled={atEnd} title="Last">
            ⏭
          </button>
        </div>

        <input
          className="replay-scrub"
          type="range"
          min={0}
          max={total}
          value={index}
          onChange={(e) => jumpTo(parseInt(e.target.value, 10))}
        />

        <BattleLogView log={log} onFocus={setLogFocus} />

        <button className="primary" onClick={() => downloadReplay(replay)}>
          Download replay
        </button>
      </div>
    </div>
  );
}
