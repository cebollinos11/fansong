import { useEffect, useMemo, useRef, useState } from 'react';
import { runReplay, type GameEvent, type Replay } from '@fansong/engine';
import { BoardCanvas } from './BoardCanvas.js';
import { downloadReplay } from '../game/replay-io.js';
import { formatEvent } from './log.js';

interface Props {
  replay: Replay;
  onExit: () => void;
}

const PLAY_INTERVAL_MS = 900;

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

  const state = index === 0 ? run.initial : run.frames[index - 1]!;
  const stepEvents = index === 0 ? [] : run.events[index - 1]!;

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
    const id = setTimeout(() => stepForward.current(), PLAY_INTERVAL_MS);
    return () => clearTimeout(id);
  }, [playing, index, total]);

  const atEnd = index >= total;
  const winnerLine =
    state.phase === 'gameOver' && state.winner !== null ? `Player ${state.winner} wins` : null;

  return (
    <div className="game">
      <BoardCanvas
        state={state}
        moveTargets={[]}
        attackTargetIds={[]}
        selectableUnitIds={[]}
        selectedUnitId={null}
        interactive={false}
        events={fx}
        onUnitClick={() => {}}
        onCellClick={() => {}}
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

        <div className="log">
          <h3>This step</h3>
          <ul>
            {stepEvents.length === 0 ? (
              <li className="muted">{index === 0 ? 'Starting positions' : '—'}</li>
            ) : (
              stepEvents.map((e, i) => {
                const text = formatEvent(state, e);
                return text ? <li key={i}>{text}</li> : null;
              })
            )}
          </ul>
        </div>

        <button className="primary" onClick={() => downloadReplay(replay)}>
          Download replay
        </button>
      </div>
    </div>
  );
}
