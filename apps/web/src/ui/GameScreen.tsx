import { useEffect, useMemo, useState } from 'react';
import type { GameEvent, GameState, Vec } from '@fansong/engine';
import type { ClientStatus, MatchClient } from '../game/client.js';
import { deriveInteraction } from '../game/interaction.js';
import { BoardCanvas } from './BoardCanvas.js';
import { Hud } from './Hud.js';
import { appendEvents, type LogEntry } from './log.js';

interface Props {
  client: MatchClient;
  onExit: () => void;
}

export function GameScreen({ client, onExit }: Props): JSX.Element {
  const [state, setState] = useState<GameState>(client.getState());
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [status, setStatus] = useState<ClientStatus>(client.status());

  // Subscribe to transitions (local reduce or server delta — same seam) and to
  // connection status. The client owns the state; the screen only renders it.
  useEffect(() => {
    const unsub = client.subscribe(({ state: next, events: evs }) => {
      setState(next);
      setEvents(evs);
      setLog((prev) => appendEvents(prev, next, evs));
      setSelectedUnitId(null);
    });
    const unsubStatus = client.onStatus(setStatus);
    setStatus(client.status());
    return () => {
      unsub();
      unsubStatus();
    };
  }, [client]);

  const ready = status.phase === 'ready';
  const myTurn =
    ready && state.phase !== 'gameOver' && client.controlledSeats.includes(state.active);
  const interaction = useMemo(() => deriveInteraction(client.legalCommands()), [state, client]);

  const handleUnitClick = (id: string): void => {
    if (!myTurn) return;
    if (state.phase === 'awaitingActivation') {
      if (interaction.selectableUnitIds.includes(id)) setSelectedUnitId(id);
      return;
    }
    if (state.phase === 'acting' && interaction.attackTargetIds.includes(id) && state.activeUnitId) {
      client.send({ type: 'Attack', attackerId: state.activeUnitId, targetId: id });
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

  const handleEndActivation = (): void => {
    if (!myTurn) return;
    client.send({ type: 'EndActivation' });
  };

  return (
    <div className="game">
      <BoardCanvas
        state={state}
        moveTargets={myTurn && state.phase === 'acting' ? interaction.moveTargets : []}
        attackTargetIds={myTurn && state.phase === 'acting' ? interaction.attackTargetIds : []}
        selectableUnitIds={myTurn && state.phase === 'awaitingActivation' ? interaction.selectableUnitIds : []}
        selectedUnitId={selectedUnitId}
        interactive={myTurn}
        events={events}
        onUnitClick={handleUnitClick}
        onCellClick={handleCellClick}
      />
      <Hud
        state={state}
        setup={client.setup}
        controlledSeats={client.controlledSeats}
        status={status}
        interaction={interaction}
        selectedUnitId={selectedUnitId}
        humanTurn={myTurn}
        log={log}
        onActivate={handleActivate}
        onEndActivation={handleEndActivation}
        onExit={onExit}
      />
    </div>
  );
}
