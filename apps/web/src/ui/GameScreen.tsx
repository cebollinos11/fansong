import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getActionPlans, groupFor, makeHexGrid, unitById, vecKey, type ActionPlan, type GameEvent, type GameState, type Owner, type Replay, type Vec } from '@fansong/engine';
import type { ClientStatus, MatchClient } from '../game/client.js';
import type { Transition } from '../game/controller.js';
import { deriveInteraction } from '../game/interaction.js';
import { buildPlanIndex, previewFor } from '../game/planView.js';
import { PlanRunner } from '../game/planRunner.js';
import { PresentationQueue } from '../game/presentation.js';
import { downloadReplay } from '../game/replay-io.js';
import { splitRoundScoring, type ZoneTally } from '../game/roundScoring.js';
import { splitRoundStart } from '../game/roundStart.js';
import { seamHoldMs } from '../game/seams.js';
import { AttackMenu, type AttackChoice } from './AttackMenu.js';
import { BoardCanvas } from './BoardCanvas.js';
import { oddsLine } from './hexInfo.js';
import { Hud } from './Hud.js';
import { SoundCuePanel } from './SoundCuePanel.js';
import { devTools } from '../devTools.js';
import { seatLabel, turnPhrase } from './hudView.js';
import { sideNames } from './sides.js';
import type { LogFocus } from './BattleLogView.js';
import { appendEvents, emptyLog, type BattleLog } from './log.js';
import { battleUnstarted, objective, zoneScore } from './modeView.js';

/** How long the round-start banner stays up over the board (ms; matches the CSS animation). */
const ROUND_ANNOUNCE_MS = 1800;
/** How long the battle's opening banner, which also states the objective, stays up (ms; matches the CSS). */
const OPENING_MS = 3600;
/** How long a scored zone stays on screen after its point counts, before the next one. */
const ZONE_SCORE_HOLD_MS = 800;

interface Props {
  client: MatchClient;
  onExit: () => void;
  onWatchReplay: (replay: Replay) => void;
  /** Online: go back to the room's lobby for another game (once this one is over). */
  onRematch?: () => void;
  /** The dev sandbox's hooks into the board (see {@link SandboxHooks}). */
  sandbox?: SandboxHooks;
  /** Drawn over the game (the dev sandbox's panel). */
  children?: React.ReactNode;
}

/**
 * How the dev sandbox borrows the board: its tools see every click first, at
 * any time — whoever's turn it is — and swallow the ones they handle.
 */
export interface SandboxHooks {
  /** Return true to swallow the click. */
  onUnitClick: (id: string) => boolean;
  /** Return true to swallow the click. */
  onCellClick: (cell: Vec) => boolean;
  /** The unit the sandbox has picked, ringed on the board. */
  selectedUnitId: string | null;
}

export function GameScreen({ client, onExit, onWatchReplay, onRematch, sandbox, children }: Props): JSX.Element {
  // What the board is showing (it may still be rolling dice for it)...
  const [shown, setShown] = useState<{ state: GameState; events: GameEvent[]; scoring?: ZoneTally }>(() => ({
    state: client.getState(),
    events: [],
  }));
  // ...and the state whose animations have played out, which the HUD and log show.
  const [state, setState] = useState<GameState>(client.getState());
  const [idle, setIdle] = useState(true);
  const [log, setLog] = useState<BattleLog>(() => emptyLog(client.getState().round));
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  // A unit picked from the log for the inspector, and what the hovered log line points at.
  const [inspectedUnitId, setInspectedUnitId] = useState<string | null>(null);
  const [logFocus, setLogFocus] = useState<LogFocus | null>(null);
  const [status, setStatus] = useState<ClientStatus>(client.status());
  // Open when a target was clicked with two actions in hand: attack, or press it?
  const [attackChoice, setAttackChoice] = useState<AttackChoice | null>(null);
  // True from the click that commits a plan until its last command has played.
  const [planning, setPlanning] = useState(false);
  // Set from a `RoundEnded` event once it has finished animating, cleared on its
  // own timer. Also gates `myTurn` and holds the presentation queue (see the
  // subscribe effect), so nothing next round is clickable or shown until it clears.
  // A battle nobody has moved in yet opens the same way, round 1 with the objective under it.
  const [roundAnnounce, setRoundAnnounce] = useState<{ round: number; owner: Owner; opening?: boolean } | null>(() => {
    const first = client.getState();
    return !sandbox && battleUnstarted(first) ? { round: 1, owner: first.active, opening: true } : null;
  });
  const openingRef = useRef(roundAnnounce?.opening === true);
  const queueRef = useRef<PresentationQueue<Transition> | null>(null);
  // How long the transition now showing took to play: 0 when it was instant or skipped.
  const playedMs = useRef(0);
  // The unit the board last showed acting, which the HUD names while the player waits.
  const [playingUnitId, setPlayingUnitId] = useState<string | null>(null);
  const runnerRef = useRef<PlanRunner | null>(null);
  // The board reports a unit click without the event, so remember where the
  // pointer last went down — that is where the attack menu opens.
  const pointer = useRef({ x: 0, y: 0, touch: false });
  // Touch only: the hex under the last tap. With nothing to hover, the first tap
  // on a hex shows what it would commit and a second tap on it commits.
  const [pinnedCell, setPinnedCell] = useState<Vec | null>(null);
  // Each seat's last unit picked to activate, so its next pick starts from the one after it.
  const lastPicked = useRef<Partial<Record<Owner, string>>>({});

  // Subscribe to transitions (local reduce or server delta — same seam) and to
  // connection status. The client owns the state; the screen only renders it,
  // one transition at a time, so each roll plays out before its result shows.
  useEffect(() => {
    // Who was to act before the transition now playing: the side whose doings it shows.
    let actor = client.getState().active;
    const queue = new PresentationQueue<Transition>(
      (t) => {
        setIdle(false);
        setShown({ state: t.state, events: t.events, scoring: t.scoring });
        const chosen = t.events.find((e): e is Extract<GameEvent, { type: 'ActivationChosen' }> => e.type === 'ActivationChosen');
        setPlayingUnitId((prev) => chosen?.unitId ?? t.state.activeUnitId ?? prev);
        setSelectedUnitId(null);
        setAttackChoice(null);
        setPinnedCell(null);
      },
      (t, nowIdle) => {
        setState(t.state);
        setLog((prev) => appendEvents(prev, t.state, t.events));
        // A beat between one activation and the next, so a result is read before the board moves on.
        queue.hold(seamHoldMs(t.events, actor, t.state.active, client.controlledSeats, playedMs.current));
        actor = t.state.active;
        // A zone's point has just counted; leave its verdict up before the next zone.
        if (t.scoring) queue.hold(ZONE_SCORE_HOLD_MS);
        // Only once this transition's own animations (a round-ending blow, say)
        // have played out — never while they're still on screen. Held back from
        // the queue too, so whatever plays next stays hidden until it clears.
        const roundEnded = t.events.find((e): e is Extract<GameEvent, { type: 'RoundEnded' }> => e.type === 'RoundEnded');
        if (roundEnded) {
          setRoundAnnounce({ round: roundEnded.round, owner: roundEnded.nextLeader });
          queue.hold(ROUND_ANNOUNCE_MS);
        }
        // Input stays locked through a hold; it comes back once the hold is over.
        setIdle(queue.idle);
        if (nowIdle && !queue.idle) void queue.whenIdle().then(() => setIdle(queue.idle));
      },
    );
    queueRef.current = queue;
    // An AI that leads plays its first move once the opening banner has cleared.
    if (openingRef.current) queue.holdFor(OPENING_MS);
    // A round's zones are scored one at a time before it ends, and Reassembling
    // units stand up after the round's banner, not under it.
    const unsub = client.subscribe((t) =>
      splitRoundScoring(t).flatMap(splitRoundStart).forEach((part) => queue.push(part)),
    );
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
      pointer.current = { x: e.clientX, y: e.clientY, touch: e.pointerType !== 'mouse' };
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, []);

  // One runner per client; it reads the presentation queue through the ref the
  // subscribe effect sets up, so a chain waits for each leg to finish playing.
  useEffect(() => {
    const runner = new PlanRunner({
      client,
      whenIdle: () => queueRef.current?.whenIdle() ?? Promise.resolve(),
    });
    runnerRef.current = runner;
    return () => {
      runner.cancel();
      runnerRef.current = null;
    };
  }, [client]);

  const ready = status.phase === 'ready';
  // Input waits for the board to catch up, so a human never acts on a result
  // the dice haven't shown yet (once idle, `state` is the client's state). A
  // chain in flight locks input the same way — `planning` is set in the click
  // handler itself, so there is no window between committing and the board
  // going busy in which a second click could land.
  const myTurn =
    ready &&
    idle &&
    !planning &&
    !roundAnnounce &&
    state.phase !== 'gameOver' &&
    client.controlledSeats.includes(state.active);
  const interaction = useMemo(() => deriveInteraction(client.legalCommands()), [state, client]);
  // Everything the acting unit could do with *all* its actions, not just the
  // next one. The engine enumerates it; this only sorts it into what the board
  // tints, rings, and resolves a click to.
  const plans = useMemo(() => buildPlanIndex(getActionPlans(state), state), [state]);
  const acting = myTurn && state.phase === 'acting';
  // Who would share the roll if the selected unit activated as a group (itself first).
  const groupIds = useMemo(() => {
    if (!myTurn || state.phase !== 'awaitingActivation' || !selectedUnitId) return [];
    if (!interaction.groupUnitIds.includes(selectedUnitId)) return [];
    const unit = unitById(state, selectedUnitId);
    return unit ? groupFor(state, unit, makeHexGrid(state.board)).map((u) => u.id) : [];
  }, [myTurn, state, selectedUnitId, interaction]);
  const diceGroup = useMemo(
    () =>
      groupIds.length > 0
        ? { size: groupIds.length, inspired: groupIds.every((id) => unitById(state, id)?.inspired) }
        : undefined,
    [groupIds, state],
  );
  // While the human picks a unit or gives it orders, the enemies that can no
  // longer answer this round (acted already, or their side turned over) sit dimmed.
  const spentUnitIds = useMemo(
    () =>
      myTurn && (state.phase === 'awaitingActivation' || state.phase === 'acting')
        ? state.units
            .filter((u) => !u.dead && u.owner !== state.active && (u.activatedThisRound || state.benched[u.owner]))
            .map((u) => u.id)
        : [],
    [myTurn, state],
  );

  /** Commit a plan: send its first command, then the rest as the board catches up. */
  const runPlan = useCallback((plan: ActionPlan) => {
    const runner = runnerRef.current;
    if (!runner || runner.running) return;
    setAttackChoice(null);
    setPlanning(true);
    void runner.run(plan.steps).finally(() => setPlanning(false));
  }, []);

  // The banner clears itself; a new one (its object identity changes) restarts the clock.
  useEffect(() => {
    if (!roundAnnounce) return;
    const id = setTimeout(() => {
      openingRef.current = false;
      setRoundAnnounce(null);
    }, roundAnnounce.opening ? OPENING_MS : ROUND_ANNOUNCE_MS);
    return () => clearTimeout(id);
  }, [roundAnnounce]);

  // A dropped connection must not leave the board locked behind a dead chain.
  useEffect(() => {
    if (!ready) {
      runnerRef.current?.cancel();
      setPlanning(false);
    }
  }, [ready]);

  // A finished local match can be replayed or exported (online play records no replay).
  const over = idle && state.phase === 'gameOver';
  const replay = over ? client.getReplay() : null;

  /**
   * A tap on a touch screen: true when it is the first on `cell`, which only
   * pins the hex (its tooltip and preview stand in for hovering); false for a
   * mouse click, or the second tap that means "do it".
   */
  const pinFirst = (cell: Vec): boolean => {
    if (!pointer.current.touch) return false;
    if (pinnedCell && vecKey(pinnedCell) === vecKey(cell)) return false;
    setPinnedCell(cell);
    return true;
  };

  const handleUnitClick = (id: string): void => {
    if (sandbox?.onUnitClick(id)) return;
    if (!myTurn) return;
    if (state.phase === 'awaitingActivation') {
      if (interaction.selectableUnitIds.includes(id)) {
        setPinnedCell(null);
        setSelectedUnitId(id);
      }
      return;
    }
    if (state.phase !== 'acting' || !state.activeUnitId) return;
    // A waiting group member: let it act now instead of the one in hand.
    if (interaction.switchTargetIds.includes(id)) {
      setPinnedCell(null);
      client.send({ type: 'SwitchGroupMember', unitId: id });
      return;
    }
    // The plan may walk in first — an enemy a move away is clickable straight off.
    const plan = plans.byTarget.get(id);
    if (!plan) return;
    const target = unitById(state, id);
    if (target && pinFirst(target.pos)) return;
    setPinnedCell(null);
    // With actions to spare the engine also offers the pressed version, so ask
    // which one before spending anything.
    const pressed = plans.pressedByTarget.get(id);
    if (pressed) {
      setAttackChoice({
        targetId: id,
        targetName: unitById(state, id)?.name ?? id,
        kind: plan.kind === 'attack' ? 'melee' : 'ranged',
        plain: plan,
        pressed,
        plainOdds: oddsLine(state, plan),
        pressedOdds: oddsLine(state, pressed),
        actionsRemaining: state.actionsRemaining,
        at: { ...pointer.current },
      });
      return;
    }
    runPlan(plan);
  };

  const resolveAttackChoice = (pressed: boolean): void => {
    const choice = attackChoice;
    setAttackChoice(null);
    if (!choice || !myTurn || state.phase !== 'acting') return;
    runPlan(pressed ? choice.pressed : choice.plain);
  };

  const cancelAttackChoice = useCallback(() => setAttackChoice(null), []);

  // What hovering a hex would commit. Recreated only when the plans or the turn
  // change, so the board keeps the same callback while the pointer moves.
  const hoverPreview = useCallback(
    (cell: Vec) => (acting ? previewFor(plans, cell) : null),
    [acting, plans],
  );

  const handleCellClick = (cell: Vec): void => {
    setAttackChoice(null);
    if (sandbox?.onCellClick(cell)) return;
    // Any hex can be looked at, whoever's turn it is; tapping it again lets go.
    if (pinFirst(cell)) return;
    setPinnedCell(null);
    if (!myTurn) return;
    if (state.phase === 'acting' && state.activeUnitId) {
      // One click commits the whole chain, however many actions it spends.
      const plan = plans.byCell.get(vecKey(cell));
      if (plan) runPlan(plan);
      return;
    }
    if (state.phase === 'awaitingActivation') setSelectedUnitId(null);
  };

  /**
   * The selectable unit `step` places from `from` in army order, wrapping; with
   * nothing to start from, the first (or, stepping back, the last) of them.
   */
  const cycleUnit = useCallback(
    (from: string | null, step: 1 | -1): string | null => {
      const ids = interaction.selectableUnitIds;
      if (ids.length === 0) return null;
      const order = state.units.map((u) => u.id);
      const at = from === null ? -1 : order.indexOf(from);
      if (at < 0) return step === 1 ? ids[0]! : ids[ids.length - 1]!;
      // `ids` is in army order too, so the next one past `at` is the first with a later place.
      const rank = (id: string): number => order.indexOf(id);
      if (step === 1) return ids.find((id) => rank(id) > at) ?? ids[0]!;
      return [...ids].reverse().find((id) => rank(id) < at) ?? ids[ids.length - 1]!;
    },
    [interaction, state.units],
  );

  // From a seat's second turn on, its turn to pick opens on the next unit in
  // line after the last one it activated, dice menu and all; the first pick of
  // the game is left to the player. They can still click another. Only on the
  // way in, so Escape or clicking away leaves them with no pick.
  const picking = myTurn && state.phase === 'awaitingActivation';
  const wasPicking = useRef(false);
  useEffect(() => {
    const last = lastPicked.current[state.active];
    if (picking && !wasPicking.current && last !== undefined) {
      const id = cycleUnit(last, 1);
      if (id) setSelectedUnitId(id);
    }
    wasPicking.current = picking;
  }, [picking, cycleUnit, state.active]);

  const handleActivate = (diceCount: number, group: boolean): void => {
    if (!myTurn || !selectedUnitId) return;
    lastPicked.current[state.active] = selectedUnitId;
    client.send({ type: 'ChooseActivation', unitId: selectedUnitId, diceCount, ...(group ? { group: true as const } : {}) });
  };

  // Keyboard: Q/E step the selection back/forward through the units that can
  // activate, 1/2/3 commit that many dice to the selected unit (with Shift, to
  // its whole group) and Escape drops
  // the selection; once acting, E ends the activation, which is otherwise the most-clicked
  // button on the screen, G declares Guard and C war cries (each only offered
  // when legal). The
  // attack menu owns Escape while it is open.
  useEffect(() => {
    // Also bound mid-chain, where `myTurn` is false, so Escape can stop it.
    if (!myTurn && !planning) return;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;

      // A chain in flight can be called off; the unit keeps the actions the
      // remaining legs would have spent.
      if (e.key === 'Escape' && runnerRef.current?.running) {
        e.preventDefault();
        runnerRef.current.cancel();
        return;
      }
      if (!myTurn) return;

      if (state.phase === 'acting') {
        // The attack menu is a question waiting on an answer; let it have the keyboard.
        if (attackChoice) return;
        if (e.key.toLowerCase() === 'e' && interaction.canEndActivation) {
          e.preventDefault();
          client.send({ type: 'EndActivation' });
        } else if (e.key.toLowerCase() === 'g' && interaction.canGuard && state.activeUnitId) {
          e.preventDefault();
          client.send({ type: 'Guard', unitId: state.activeUnitId });
        } else if (e.key.toLowerCase() === 'c' && interaction.canWarCry && state.activeUnitId) {
          e.preventDefault();
          client.send({ type: 'WarCry', unitId: state.activeUnitId });
        }
        return;
      }
      if (state.phase !== 'awaitingActivation') return;
      const key = e.key.toLowerCase();
      if (key === 'q' || key === 'e') {
        const id = cycleUnit(selectedUnitId, key === 'e' ? 1 : -1);
        if (!id) return;
        e.preventDefault();
        setSelectedUnitId(id);
        return;
      }
      if (!selectedUnitId) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        setSelectedUnitId(null);
        return;
      }
      // With Shift the key no longer reads as a digit (and which symbol it is
      // depends on the keyboard layout), so go by the physical key.
      const group = e.shiftKey;
      const diceCount = Number(group ? /^Digit(\d)$/.exec(e.code)?.[1] : e.key);
      if (!interaction.diceChoices.includes(diceCount)) return;
      if (group && groupIds.length === 0) return;
      e.preventDefault();
      lastPicked.current[state.active] = selectedUnitId;
      client.send({ type: 'ChooseActivation', unitId: selectedUnitId, diceCount, ...(group ? { group: true as const } : {}) });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [myTurn, planning, state.phase, selectedUnitId, interaction, attackChoice, client, cycleUnit, groupIds]);

  // Picking a unit to activate brings the inspector back to it.
  useEffect(() => {
    if (selectedUnitId) setInspectedUnitId(null);
  }, [selectedUnitId]);

  // A menu left open when the turn moves on has nothing left to answer.
  useEffect(() => {
    if (!myTurn || state.phase !== 'acting') setAttackChoice(null);
  }, [myTurn, state.phase]);

  const handleEndActivation = (): void => {
    setAttackChoice(null);
    if (!myTurn) return;
    client.send({ type: 'EndActivation' });
  };

  const handleGuard = (): void => {
    setAttackChoice(null);
    if (!myTurn || !state.activeUnitId) return;
    client.send({ type: 'Guard', unitId: state.activeUnitId });
  };

  const handleWarCry = (): void => {
    setAttackChoice(null);
    if (!myTurn || !state.activeUnitId) return;
    client.send({ type: 'WarCry', unitId: state.activeUnitId });
  };

  const announcement = roundAnnounce
    ? {
        round: roundAnnounce.round,
        owner: roundAnnounce.owner,
        turnLabel: turnPhrase(seatLabel(client.setup, client.controlledSeats, roundAnnounce.owner)),
        ...(roundAnnounce.opening ? { objective: objective(state) } : {}),
      }
    : null;
  const scoring = useMemo(
    () =>
      shown.scoring
        ? zoneScore(shown.state, shown.scoring, [
            seatLabel(client.setup, client.controlledSeats, 0),
            seatLabel(client.setup, client.controlledSeats, 1),
          ])
        : null,
    [shown, client],
  );

  return (
    <div className="game play">
      <BoardCanvas
        state={shown.state}
        reach={acting ? plans.reach : []}
        attackTargetIds={acting ? plans.strikeNowIds : []}
        approachTargetIds={acting ? plans.approachIds : []}
        shootTargetIds={acting ? plans.shootIds : []}
        previewFor={hoverPreview}
        selectableUnitIds={
          myTurn && state.phase === 'awaitingActivation' ? interaction.selectableUnitIds : acting ? interaction.switchTargetIds : []
        }
        selectedUnitId={selectedUnitId ?? sandbox?.selectedUnitId ?? null}
        spentUnitIds={spentUnitIds}
        interactive={myTurn || sandbox !== undefined}
        pickThrough={sandbox === undefined}
        localSeats={client.controlledSeats}
        sideNames={sideNames(client.setup, client.controlledSeats)}
        liveTerrain={sandbox !== undefined}
        events={shown.events}
        onEventsPlayed={(ms) => {
          playedMs.current = ms;
          queueRef.current?.played(ms);
        }}
        announcement={announcement}
        scoring={scoring}
        onUnitClick={handleUnitClick}
        onCellClick={handleCellClick}
        // With nothing else pointed at, ring the friends that would join the selected unit's group.
        focusUnitIds={logFocus?.unitIds ?? (inspectedUnitId ? [inspectedUnitId] : groupIds.slice(1))}
        focusPath={logFocus?.path}
        pinnedCell={pinnedCell}
        diceChoices={myTurn && selectedUnitId && state.phase === 'awaitingActivation' ? interaction.diceChoices : []}
        diceGroup={diceGroup}
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
        playingUnitId={playingUnitId}
        roundStarting={roundAnnounce !== null}
        scoring={scoring !== null}
        log={log}
        inspectedUnitId={inspectedUnitId}
        onInspect={setInspectedUnitId}
        onLogFocus={setLogFocus}
        onEndActivation={handleEndActivation}
        onGuard={handleGuard}
        onWarCry={handleWarCry}
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
      {devTools() ? <SoundCuePanel /> : null}
      {children}
    </div>
  );
}
