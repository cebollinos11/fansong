import { useEffect, useMemo, useRef, useState } from 'react';
import type { GameEvent, GameState, Vec } from '@fansong/engine';
import { AiDriver } from '../game/ai-driver.js';
import { MatchController } from '../game/controller.js';
import { deriveInteraction } from '../game/interaction.js';
import { createMatch } from '../game/setup.js';
import { isAiSeat, type MatchSetup } from '../game/types.js';
import { BoardCanvas } from './BoardCanvas.js';
import { Hud } from './Hud.js';
import { appendEvents, type LogEntry } from './log.js';

interface Props {
  setup: MatchSetup;
  onExit: () => void;
}

export function GameScreen({ setup, onExit }: Props): JSX.Element {
  // The controller owns the authoritative GameState for this match; created once.
  const controllerRef = useRef<MatchController | null>(null);
  if (!controllerRef.current) controllerRef.current = new MatchController(createMatch(setup));
  const controller = controllerRef.current;

  const [state, setState] = useState<GameState>(controller.getState());
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);

  // Subscribe to transitions and drive AI seats. Runs once for the match.
  useEffect(() => {
    const unsub = controller.subscribe(({ state: next, events: evs }) => {
      setState(next);
      setEvents(evs);
      setLog((prev) => appendEvents(prev, next, evs));
      setSelectedUnitId(null);
    });
    const driver = new AiDriver(controller, setup);
    driver.start();
    return () => {
      driver.stop();
      unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const humanTurn = state.phase !== 'gameOver' && !isAiSeat(setup, state.active);
  const interaction = useMemo(() => deriveInteraction(controller.legalCommands()), [state, controller]);

  const handleUnitClick = (id: string): void => {
    if (!humanTurn) return;
    if (state.phase === 'awaitingActivation') {
      if (interaction.selectableUnitIds.includes(id)) setSelectedUnitId(id);
      return;
    }
    if (state.phase === 'acting' && interaction.attackTargetIds.includes(id) && state.activeUnitId) {
      controller.apply({ type: 'Attack', attackerId: state.activeUnitId, targetId: id });
    }
  };

  const handleCellClick = (cell: Vec): void => {
    if (!humanTurn) return;
    if (state.phase === 'acting' && state.activeUnitId) {
      const legalMove = interaction.moveTargets.some((t) => t.x === cell.x && t.y === cell.y);
      if (legalMove) controller.apply({ type: 'Move', unitId: state.activeUnitId, to: cell });
      return;
    }
    // Clicking empty ground during activation clears the current selection.
    if (state.phase === 'awaitingActivation') setSelectedUnitId(null);
  };

  const handleActivate = (diceCount: number): void => {
    if (!humanTurn || !selectedUnitId) return;
    controller.apply({ type: 'ChooseActivation', unitId: selectedUnitId, diceCount });
  };

  const handleEndActivation = (): void => {
    if (!humanTurn) return;
    controller.apply({ type: 'EndActivation' });
  };

  return (
    <div className="game">
      <BoardCanvas
        state={state}
        moveTargets={humanTurn && state.phase === 'acting' ? interaction.moveTargets : []}
        attackTargetIds={humanTurn && state.phase === 'acting' ? interaction.attackTargetIds : []}
        selectableUnitIds={humanTurn && state.phase === 'awaitingActivation' ? interaction.selectableUnitIds : []}
        selectedUnitId={selectedUnitId}
        interactive={humanTurn}
        events={events}
        onUnitClick={handleUnitClick}
        onCellClick={handleCellClick}
      />
      <Hud
        state={state}
        setup={setup}
        interaction={interaction}
        selectedUnitId={selectedUnitId}
        humanTurn={humanTurn}
        log={log}
        onActivate={handleActivate}
        onEndActivation={handleEndActivation}
        onExit={onExit}
      />
    </div>
  );
}
