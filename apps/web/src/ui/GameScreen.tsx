import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { unitById, type GameEvent, type GameState, type Replay, type Vec } from '@fansong/engine';
import type { ClientStatus, MatchClient } from '../game/client.js';
import type { Transition } from '../game/controller.js';
import { deriveInteraction } from '../game/interaction.js';
import { PresentationQueue } from '../game/presentation.js';
import { downloadReplay } from '../game/replay-io.js';
import { AttackMenu, type AttackChoice } from './AttackMenu.js';
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
  // Open when a target was clicked with two actions in hand: attack, or press it?
  const [attackChoice, setAttackChoice] = useState<AttackChoice | null>(null);
  const queueRef = useRef<PresentationQueue<Transition> | null>(null);
  // The board reports a unit click without the event, so remember where the
  // pointer last went down — that is where the attack menu opens.
  const pointer = useRef({ x: 0, y: 0 });

  // Subscribe to transitions (local reduce or server delta — same seam) and to
  // connection status. The client owns the state; the screen only renders it,
  // one transition at a time, so each roll plays out before its result shows.
  useEffect(() => {
    const queue = new PresentationQueue<Transition>(
      (t) => {
        setIdle(false);
        setShown({ state: t.state, events: t.events });
        setSelectedUnitId(null);
        setAttackChoice(null);
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

  // Remember the last pointer position for the attack menu's anchor.
  useEffect(() => {
    const onPointerDown = (e: PointerEvent): void => {
      pointer.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, []);

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
    const melee = interaction.attackTargetIds.includes(id);
    const ranged = !melee && interaction.shootTargetIds.includes(id);
    if (!melee && !ranged) return;
    // With a second action in hand the engine also offers the pressed version,
    // so ask which one before spending anything.
    const canPress = melee ? interaction.powerAttackTargetIds.includes(id) : interaction.aimedShotTargetIds.includes(id);
    if (canPress) {
      setAttackChoice({
        targetId: id,
        targetName: unitById(state, id)?.name ?? id,
        kind: melee ? 'melee' : 'ranged',
        at: { ...pointer.current },
      });
      return;
    }
    if (melee) client.send({ type: 'Attack', attackerId: state.activeUnitId, targetId: id });
    else client.send({ type: 'Shoot', attackerId: state.activeUnitId, targetId: id });
  };

  const resolveAttackChoice = (pressed: boolean): void => {
    const choice = attackChoice;
    setAttackChoice(null);
    if (!choice || !myTurn || state.phase !== 'acting' || !state.activeUnitId) return;
    client.send(
      choice.kind === 'melee'
        ? { type: 'Attack', attackerId: state.activeUnitId, targetId: choice.targetId, ...(pressed ? { power: true } as const : {}) }
        : { type: 'Shoot', attackerId: state.activeUnitId, targetId: choice.targetId, ...(pressed ? { aimed: true } as const : {}) },
    );
  };

  const cancelAttackChoice = useCallback(() => setAttackChoice(null), []);

  const handleCellClick = (cell: Vec): void => {
    setAttackChoice(null);
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

  // Keyboard: 1/2/3 commit that many dice to the selected unit and Escape drops
  // the selection; E ends the activation, which is otherwise the most-clicked
  // button on the screen. The attack menu owns Escape while it is open.
  useEffect(() => {
    if (!myTurn) return;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;

      if (state.phase === 'acting') {
        // The attack menu is a question waiting on an answer; let it have the keyboard.
        if (attackChoice) return;
        if (e.key.toLowerCase() === 'e' && interaction.canEndActivation) {
          e.preventDefault();
          client.send({ type: 'EndActivation' });
        }
        return;
      }
      if (state.phase !== 'awaitingActivation' || !selectedUnitId) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        setSelectedUnitId(null);
        return;
      }
      const diceCount = Number(e.key);
      if (!interaction.diceChoices.includes(diceCount)) return;
      e.preventDefault();
      client.send({ type: 'ChooseActivation', unitId: selectedUnitId, diceCount });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [myTurn, state.phase, selectedUnitId, interaction, attackChoice, client]);

  // A menu left open when the turn moves on has nothing left to answer.
  useEffect(() => {
    if (!myTurn || state.phase !== 'acting') setAttackChoice(null);
  }, [myTurn, state.phase]);

  const handleEndActivation = (): void => {
    setAttackChoice(null);
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
        diceChoices={myTurn && state.phase === 'awaitingActivation' ? interaction.diceChoices : []}
        onChooseDice={handleActivate}
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
      {attackChoice ? (
        <AttackMenu choice={attackChoice} onPick={resolveAttackChoice} onCancel={cancelAttackChoice} />
      ) : null}
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
