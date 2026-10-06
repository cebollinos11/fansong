import { useState } from 'react';
import { airborne, spellRange, unitById, unitMove, type GameState, type Owner } from '@fansong/engine';
import type { Interaction } from '../game/interaction.js';
import type { MatchSetup } from '@fansong/content';
import type { ClientStatus } from '../game/client.js';
import { BROKEN_HELP, INSPIRED_HELP, TRANSFIXED_HELP, WAR_CRY_HELP, breaksAtHelp, seatLabel, traitTags, waitingLine, warbandStatus } from './hudView.js';
import { BattleLogView, type LogFocus } from './BattleLogView.js';
import { itemText, type BattleLog } from './log.js';
import { sideNames } from './sides.js';
import { modeHud, objective } from './modeView.js';
import { StatIcons } from './StatIcons.js';

interface Props {
  state: GameState;
  setup: MatchSetup;
  /** Seats the local player operates (for "You" vs "Opponent" labelling). */
  controlledSeats: readonly Owner[];
  status: ClientStatus;
  interaction: Interaction;
  selectedUnitId: string | null;
  /** True when the local human may act right now. */
  humanTurn: boolean;
  /** True while the board is still playing out the latest dice and blows. */
  resolving: boolean;
  /** The unit whose doings the board is playing out (or last played), named while the player waits. */
  playingUnitId: string | null;
  /** True while the round-start banner covers the board — nobody's turn text is accurate yet. */
  roundStarting: boolean;
  /** True while the board is showing the round's zones being scored. */
  scoring: boolean;
  log: BattleLog;
  /** The unit picked from the log for the inspector; it outranks the selection until closed. */
  inspectedUnitId: string | null;
  onInspect: (unitId: string | null) => void;
  onLogFocus: (focus: LogFocus | null) => void;
  onEndActivation: () => void;
  onGuard: () => void;
  onWarCry: () => void;
  onExit: () => void;
}

/** A one-line connection banner for online play; null when there's nothing to say. */
function statusBanner(status: ClientStatus): string | null {
  switch (status.phase) {
    case 'connecting':
      return 'Connecting…';
    case 'waiting':
      return 'Your opponent left. Waiting for them to rejoin with the room code…';
    case 'disconnected':
      return `Disconnected: ${status.reason}`;
    case 'ready':
      return null;
  }
}

const LOG_SHOWN_KEY = 'fansong.logShown';

/** The phone layout's breakpoint, as in the stylesheet. */
const PHONE_QUERY = '(max-width: 700px)';

/** Whether the log is showing: the player's last choice, else shown on a desktop and hidden on a phone. */
function loadLogOpen(): boolean {
  try {
    const saved = localStorage.getItem(LOG_SHOWN_KEY);
    if (saved !== null) return saved === '1';
  } catch {
    // Fall through to the default.
  }
  return !window.matchMedia(PHONE_QUERY).matches;
}

function saveLogOpen(open: boolean): void {
  try {
    localStorage.setItem(LOG_SHOWN_KEY, open ? '1' : '0');
  } catch {
    // Not remembered; the toggle still works for this session.
  }
}

/**
 * The match HUD, floating over the board rather than beside it: the score and
 * whose move it is across the top, the battle log (which can be hidden) in the top-right corner, and
 * the unit in hand with its orders along the bottom.
 */
export function Hud(props: Props): JSX.Element {
  const { state, setup, controlledSeats, status, interaction, selectedUnitId, humanTurn } = props;
  const [logOpen, setLogOpen] = useState(loadLogOpen);
  const gameOver = state.phase === 'gameOver';
  const selected = selectedUnitId ? unitById(state, selectedUnitId) : null;
  const activeUnit = state.activeUnitId ? unitById(state, state.activeUnitId) : null;
  const banner = statusBanner(status);
  const names = sideNames(setup, controlledSeats);
  const mode = modeHud(state, names);
  // Always on show, annihilation included: nobody should have to guess how to win.
  const goal = objective(state);
  const callout = props.log.callout;
  const acting = humanTurn && state.phase === 'acting';

  // What is being waited on, in one line; `hint` is the longer how-to behind it.
  let turn: { text: React.ReactNode; hint?: string; tone: 'yours' | 'waiting' | 'win' };
  if (gameOver) {
    const winner = seatLabel(setup, controlledSeats, state.winner as Owner);
    turn = { text: winner === 'You' ? 'You win!' : `${winner} wins!`, tone: 'win' };
  } else if (props.scoring) {
    turn = { text: 'Scoring the round…', tone: 'waiting' };
  } else if (props.roundStarting) {
    turn = { text: 'Starting the round…', tone: 'waiting' };
  } else if (!humanTurn) {
    turn = {
      text: waitingLine(setup, controlledSeats, state, props.resolving ? (props.playingUnitId ?? '') : null),
      tone: 'waiting',
    };
  } else if (state.phase === 'awaitingActivation') {
    turn = selected
      ? {
          text: (
            <>
              Commit dice to {selected.name}{' '}
              <span className="keys">
                <kbd>{Math.min(...(interaction.diceByUnit[selected.id] ?? [1]))}</kbd>–<kbd>{Math.max(...(interaction.diceByUnit[selected.id] ?? [1]))}</kbd>
              </span>
              {interaction.groupUnitIds.includes(selected.id) ? (
                <span className="keys">
                  {' '}
                  · group <kbd>⇧</kbd>
                </span>
              ) : null}
            </>
          ),
          hint: selected.transfixedBy !== undefined
            ? 'It is transfixed: this roll is its struggle to break free. Two successes free it and a third is an action to spend; fewer and it stays held. Two failures still bench you.'
            : interaction.spellDiceByUnit[selected.id]
            ? 'More dice = more actions but higher turnover risk. Or take a spell turn (the Spell row): the successes become the power of one Transfix spell instead of actions.'
            : interaction.groupUnitIds.includes(selected.id)
            ? 'More dice = more actions but higher turnover risk. One die can never turn over. Hold Shift (or use the group row) to activate every unit like it within 2 hexes on one shared roll. Q/E switch unit, Esc deselects.'
            : 'More dice = more actions but higher turnover risk. One die can never turn over. Q/E switch unit, Esc deselects.',
          tone: 'yours',
        }
      : {
          text: (
            <>
              Pick a unit to activate{' '}
              <span className="keys">
                <kbd>Q</kbd>
                <kbd>E</kbd>
              </span>
            </>
          ),
          tone: 'yours',
        };
  } else {
    const waiting = state.group?.pending.length ?? 0;
    turn = {
      text: state.spell
        ? `${activeUnit?.name ?? 'Unit'} · Transfix, power ${state.spell.power} · reach ${spellRange(state.spell.power)} hexes`
        : `${activeUnit?.name ?? 'Unit'} · ${state.actionsRemaining} action${state.actionsRemaining === 1 ? '' : 's'} left${waiting > 0 ? ` · ${waiting} waiting` : ''}`,
      hint: state.spell
        ? `Click a highlighted enemy to cast the spell on it. It must pass ${state.spell.power} Quality ${state.spell.power === 1 ? 'die' : 'dice'} or be transfixed.`
        : interaction.switchTargetIds.length > 0
        ? 'A group is activating: each member acts in turn. Click a pulsing member to let it go first — once this one acts, it has to finish.'
        : state.actionsRemaining >= 2
          ? 'The green field covers everything it can reach with all its actions — the rings mark where each one ends. Hover to see the route and the price; one click spends the lot.'
          : 'Click a green tile to move, a highlighted enemy to attack.',
      tone: 'yours',
    };
  }

  const side = (owner: Owner): JSX.Element => {
    const warband = warbandStatus(state, owner);
    const fielded = state.units.filter((u) => u.owner === owner).length;
    return (
      <div className={`play-side p${owner}${state.active === owner && !gameOver ? ' active' : ''}`}>
        <span className="play-side-name">{seatLabel(setup, controlledSeats, owner)}</span>
        {mode?.scores ? (
          <span key={mode.scores[owner]} className={`score-points${mode.scores[owner] > 0 ? ' pulse' : ''}`}>
            {mode.scores[owner]}
          </span>
        ) : null}
        <span className="play-side-count" title={`${warband.alive} of ${fielded} units alive`}>
          {warband.alive}/{fielded}
        </span>
        {/* A rout is a sudden collapse; say it is coming, not just that it came. */}
        {warband.breaksAt !== null && !gameOver ? (
          <span className="warn" title={breaksAtHelp(warband.breaksAt)}>
            breaks at {warband.breaksAt}
          </span>
        ) : null}
        {warband.broken ? (
          <span className="broken" title={BROKEN_HELP}>
            broken
          </span>
        ) : null}
        {warband.benched && !gameOver ? <span className="benched">benched</span> : null}
      </div>
    );
  };

  const shownUnitId = props.inspectedUnitId ?? selectedUnitId ?? state.activeUnitId;

  return (
    <aside className="play-hud">
      <div className="play-top">
        <div className="play-strip">
          {side(0)}
          <div className="play-mid">
            <div className="play-round" title={`${mode ? `${mode.label} · ` : ''}${goal.goal}. ${goal.detail}.`}>
              Round {state.round}
              <span className="play-goal"> · {goal.goal}</span>
            </div>
            <div className={`play-turn ${turn.tone}`} title={turn.hint}>
              {turn.text}
            </div>
          </div>
          {side(1)}
        </div>
        {mode && mode.lines.length > 0 ? <div className="play-lines">{mode.lines.join(' · ')}</div> : null}
        {banner ? <div className="banner net">{banner}</div> : null}
        {callout?.tone === 'objective' ? (
          // Keyed by entry id so each new scoring/flag event replays the fade-in/out animation.
          <div key={callout.id} className="callout">
            {itemText(callout, names)}
          </div>
        ) : null}
      </div>

      <div className={`play-log${logOpen ? ' open' : ''}`}>
        <div className="play-log-bar">
          <button
            type="button"
            className="ghost"
            aria-expanded={logOpen}
            title={logOpen ? 'Hide the battle log' : 'Show the battle log'}
            onClick={() => {
              setLogOpen(!logOpen);
              saveLogOpen(!logOpen);
            }}
          >
            {logOpen ? '▾' : '▸'} Battle log
          </button>
          <button type="button" className="ghost" onClick={props.onExit}>
            ⟵ New match
          </button>
        </div>
        {logOpen ? <BattleLogView log={props.log} names={names} onFocus={props.onLogFocus} onInspect={props.onInspect} /> : null}
      </div>

      {shownUnitId || acting ? (
        <div className="play-bar">
          <UnitInspector
            state={state}
            unitId={shownUnitId}
            onClose={props.inspectedUnitId ? () => props.onInspect(null) : undefined}
          />
          {acting ? (
            <div className="play-actions">
              {interaction.canWarCry ? (
                <button
                  title={WAR_CRY_HELP}
                  onClick={props.onWarCry}
                >
                  War cry <kbd>C</kbd>
                </button>
              ) : null}
              {interaction.canGuard ? (
                <button
                  title="Press G — stand ready to riposte the next melee attacker, until this unit next activates"
                  onClick={props.onGuard}
                >
                  Guard <kbd>G</kbd>
                </button>
              ) : null}
              <button disabled={!interaction.canEndActivation} title="Press E" onClick={props.onEndActivation}>
                End activation <kbd>E</kbd>
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}

function UnitInspector({
  state,
  unitId,
  onClose,
}: {
  state: GameState;
  unitId: string | null;
  /** Set when the unit was picked from the log: back to the selected or acting unit. */
  onClose?: () => void;
}): JSX.Element | null {
  const u = unitId ? unitById(state, unitId) : null;
  if (!u) return null;
  const traits = traitTags(u, u.traits.flying && !airborne(state, u));
  return (
    <div className="play-unit">
      <strong className={`play-unit-name p${u.owner}`}>{u.name}</strong>
      <StatIcons
        stats={{
          quality: u.quality,
          combat: u.combat,
          move: unitMove(u),
          ...(u.traits.ranged > 0 ? { range: u.traits.ranged } : {}),
        }}
      />
      {/* Ranged, Tough and Guard change how a unit must be fought far more than
          its stats do, so they are shown wherever a unit is described. */}
      {traits.map((t) => (
        <span key={t.label} className="trait" title={t.help}>
          {t.label}
        </span>
      ))}
      {u.knockedDown ? <span className="flag down">knocked down</span> : null}
      {u.transfixedBy !== undefined && !u.dead ? (
        <span className="flag down" title={TRANSFIXED_HELP}>
          transfixed
        </span>
      ) : null}
      {u.guarding && !u.dead ? <span className="flag guarding">on guard</span> : null}
      {u.inspired && !u.dead ? (
        <span className="flag inspired" title={INSPIRED_HELP}>
          inspired
        </span>
      ) : null}
      {u.warCried && !u.dead ? <span className="flag">war cried</span> : null}
      {u.activatedThisRound ? <span className="flag">activated</span> : null}
      {u.dead ? <span className="flag dead">dead</span> : null}
      {onClose ? (
        <button type="button" className="inspector-close ghost" title="Stop inspecting" onClick={onClose}>
          ×
        </button>
      ) : null}
    </div>
  );
}
