import { useEffect, useMemo, useRef, useState } from 'react';
import type { GameEvent, GameState, Replay, Vec } from '@fansong/engine';
import type { ClientStatus, MatchClient } from '../game/client.js';
import type { Transition } from '../game/controller.js';
import { deriveInteraction } from '../game/interaction.js';
import { PresentationQueue } from '../game/presentation.js';
import { downloadReplay } from '../game/replay-io.js';
import { BoardCanvas } from './BoardCanvas.js';
import { Hud } from './Hud.js';
import { appendEvents, type LogEntry } from './log.js';

interface Props {
  client: MatchClient;
  onExit: () => void;
  onWatchReplay: (replay: Replay) => void;
  /** Online: go back to the room's lobby for another game (once this one is over). */
  onRematch?: () => void;
}

export function GameScreen({ client, onExit, onWatchReplay, onRematch }: Props): JSX.Element {
  // What the board is showing (it may still be rolling dice for it)...
  const [shown, setShown] = useState<{ state: GameState; events: GameEvent[] }>(() => ({
    state: client.getState(),
    events: [],
  }));
  // ...and the state whose animations have played out, which the HUD and log show.
  const [state, setState] = useState<GameState>(client.getState());
  const [idle, setIdle] = useState(true);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [status, setStatus] = useState<ClientStatus>(client.status());
  const queueRef = useRef<PresentationQueue<Transition> | null>(null);

  // Subscribe to transitions (local reduce or server delta — same seam) and to
  // connection status. The client owns the state; the screen only renders it,
  // one transition at a time, so each roll plays out before its result shows.
  useEffect(() => {
    const queue = new PresentationQueue<Transition>(
      (t) => {
        setIdle(false);
        setShown({ state: t.state, events: t.events });
        setSelectedUnitId(null);
      },
      (t, nowIdle) => {
        setState(t.state);
        setLog((prev) => appendEvents(prev, t.state, t.events));
        setIdle(nowIdle);
      },
    );
    queueRef.current = queue;
    const unsub = client.subscribe((t) => queue.push(t));
    const unsubStatus = client.onStatus(setStatus);
    setStatus(client.status());
    return () => {
      unsub();
      unsubStatus();
      queue.dispose();
      queueRef.current = null;
    };
  }, [client]);

  const ready = status.phase === 'ready';
  // Input waits for the board to catch up, so a human never acts on a result
  // the dice haven't shown yet (once idle, `state` is the client's state).
  const myTurn =
    ready && idle && state.phase !== 'gameOver' && client.controlledSeats.includes(state.active);
  const interaction = useMemo(() => deriveInteraction(client.legalCommands()), [state, client]);

  // A finished local match can be replayed or exported (online play records no replay).
  const over = idle && state.phase === 'gameOver';
  const replay = over ? client.getReplay() : null;

  const handleUnitClick = (id: string): void => {
    if (!myTurn) return;
    if (state.phase === 'awaitingActivation') {
      if (interaction.selectableUnitIds.includes(id)) setSelectedUnitId(id);
      return;
    }
    if (state.phase !== 'acting' || !state.activeUnitId) return;
    if (interaction.attackTargetIds.includes(id)) {
      client.send({ type: 'Attack', attackerId: state.activeUnitId, targetId: id });
    } else if (interaction.shootTargetIds.includes(id)) {
      client.send({ type: 'Shoot', attackerId: state.activeUnitId, targetId: id });
    }
  };

  const handleCellClick = (cell: Vec): void => {
    if (!myTurn) return;
    if (state.phase === 'acting' && state.activeUnitId) {
      const legalMove = interaction.moveTargets.some((t) => t.x === cell.x && t.y === cell.y);
      if (legalMove) client.send({ type: 'Move', unitId: state.activeUnitId, to: cell });
      return;
    }
    if (state.phase === 'awaitingActivation') setSelectedUnitId(null);
  };

  const handleActivate = (diceCount: number): void => {
    if (!myTurn || !selectedUnitId) return;
    client.send({ type: 'ChooseActivation', unitId: selectedUnitId, diceCount });
  };

  // Keyboard shortcut: with a unit selected, 1/2/3 commits that many dice.
  useEffect(() => {
    if (!myTurn || state.phase !== 'awaitingActivation' || !selectedUnitId) return;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      const diceCount = Number(e.key);
      if (!interaction.diceChoices.includes(diceCount)) return;
      e.preventDefault();
      client.send({ type: 'ChooseActivation', unitId: selectedUnitId, diceCount });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [myTurn, state.phase, selectedUnitId, interaction, client]);

  const handleEndActivation = (): void => {
    if (!myTurn) return;
    client.send({ type: 'EndActivation' });
  };

  return (
    <div className="game">
      <BoardCanvas
        state={shown.state}
        moveTargets={myTurn && state.phase === 'acting' ? interaction.moveTargets : []}
        attackTargetIds={
          myTurn && state.phase === 'acting' ? [...interaction.attackTargetIds, ...interaction.shootTargetIds] : []
        }
        selectableUnitIds={myTurn && state.phase === 'awaitingActivation' ? interaction.selectableUnitIds : []}
        selectedUnitId={selectedUnitId}
        interactive={myTurn}
        events={shown.events}
        onEventsPlayed={(ms) => queueRef.current?.played(ms)}
        onUnitClick={handleUnitClick}
        onCellClick={handleCellClick}
        playing
      />
      <Hud
        state={state}
        setup={client.setup}
        controlledSeats={client.controlledSeats}
        status={status}
        interaction={interaction}
        selectedUnitId={selectedUnitId}
        humanTurn={myTurn}
        resolving={!idle}
        log={log}
        onActivate={handleActivate}
        onEndActivation={handleEndActivation}
        onExit={onExit}
      />
      {over && (replay || onRematch) ? (
        <div className="gameover-actions">
          <span>Game over.</span>
          {onRematch ? (
            <button className="primary" onClick={onRematch}>
              Rematch
            </button>
          ) : null}
          {replay ? (
            <>
              <button className="primary" onClick={() => onWatchReplay(replay)}>
                Watch replay
              </button>
              <button className="ghost" onClick={() => downloadReplay(replay)}>
                Download replay
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
