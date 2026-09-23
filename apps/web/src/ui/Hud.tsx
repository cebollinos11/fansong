import { unitById, type GameState, type Owner } from '@fansong/engine';
import type { Interaction } from '../game/interaction.js';
import { isAiSeat, type MatchSetup } from '@fansong/content';
import type { ClientStatus } from '../game/client.js';
import { seatLabel, traitTags, warbandStatus } from './hudView.js';
import { latestCallout, type LogEntry } from './log.js';
import { modeHud } from './modeView.js';

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
  log: LogEntry[];
  onActivate: (diceCount: number) => void;
  onEndActivation: () => void;
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

export function Hud(props: Props): JSX.Element {
  const { state, setup, controlledSeats, status, interaction, selectedUnitId, humanTurn } = props;
  const gameOver = state.phase === 'gameOver';
  const selected = selectedUnitId ? unitById(state, selectedUnitId) : null;
  const activeUnit = state.activeUnitId ? unitById(state, state.activeUnitId) : null;
  const banner = statusBanner(status);
  const mode = modeHud(state);
  const callout = latestCallout(props.log);

  return (
    <aside className="hud">
      <div className="hud-top">
        <h2>Round {state.round}</h2>
        <button className="ghost" onClick={props.onExit}>
          ⟵ New match
        </button>
      </div>

      {banner ? <div className="banner net">{banner}</div> : null}

      <div className="scoreline">
        {([0, 1] as const).map((owner) => {
          const warband = warbandStatus(state, owner);
          return (
            <div key={owner} className={`score p${owner}${state.active === owner && !gameOver ? ' active' : ''}`}>
              <span className="score-name">
                P{owner} · {seatLabel(setup, controlledSeats, owner)}
              </span>
              {mode?.scores ? (
                <span key={mode.scores[owner]} className={`score-points${mode.scores[owner] > 0 ? ' pulse' : ''}`}>
                  {mode.scores[owner]} pts
                </span>
              ) : null}
              <span className="score-count">{warband.alive} alive</span>
              {/* A rout is a sudden collapse; say it is coming, not just that it came. */}
              {warband.breaksAt !== null && !gameOver ? (
                <span className="warn" title={`This warband breaks when ${warband.breaksAt} or fewer are left`}>
                  breaks at {warband.breaksAt}
                </span>
              ) : null}
              {warband.broken ? <span className="broken">broken</span> : null}
              {warband.benched && !gameOver ? <span className="benched">benched</span> : null}
            </div>
          );
        })}
      </div>

      {callout?.tone === 'objective' ? (
        // Keyed by entry id so each new scoring/flag event replays the fade-in/out animation.
        <div key={callout.id} className="callout">
          {callout.text.trim()}
        </div>
      ) : null}

      {mode ? (
        <div className="mode-panel">
          <div className="mode-title">
            <strong>{mode.label}</strong>
            {mode.scores ? (
              <span className="mode-score">
                <span className="p0">{mode.scores[0]}</span> – <span className="p1">{mode.scores[1]}</span>
              </span>
            ) : null}
          </div>
          <div className="mode-goal">{mode.goal}</div>
          {mode.lines.map((line) => (
            <div key={line} className="mode-line">
              {line}
            </div>
          ))}
        </div>
      ) : null}

      {gameOver ? (
        <div className="banner win">
          Player {state.winner} ({seatLabel(setup, controlledSeats, state.winner as Owner)}) wins!
        </div>
      ) : (
        <div className="turn-panel">
          {!humanTurn ? (
            <p className="thinking">
              {props.resolving && controlledSeats.includes(state.active)
                ? 'Resolving…'
                : isAiSeat(setup, state.active)
                  ? 'AI is thinking…'
                  : "Opponent's turn…"}
            </p>
          ) : state.phase === 'awaitingActivation' ? (
            <div>
              {selected ? (
                <>
                  <p className="prompt">
                    Activate <strong>{selected.name}</strong> — commit dice:
                  </p>
                  <div className="dice-row">
                    {interaction.diceChoices.map((n) => (
                      <button key={n} className="dice" title={`Press ${n}`} onClick={() => props.onActivate(n)}>
                        {n} {n === 1 ? 'die' : 'dice'} <kbd>{n}</kbd>
                      </button>
                    ))}
                  </div>
                  <p className="hint">
                    More dice = more actions but higher turnover risk. One die can never turn over. Tip: press 1–3 to
                    roll, <kbd>Esc</kbd> to pick a different unit.
                  </p>
                </>
              ) : (
                <p className="prompt">Select one of your units (highlighted) to activate.</p>
              )}
            </div>
          ) : (
            <div>
              <p className="prompt">
                Acting: <strong>{activeUnit?.name}</strong> · {state.actionsRemaining} action
                {state.actionsRemaining === 1 ? '' : 's'} left
              </p>
              <p className="hint">
                {state.actionsRemaining >= 2
                  ? 'The green field covers everything it can reach with all its actions — the rings mark where each one ends. Hover to see the route and the price; one click spends the lot.'
                  : 'Click a green tile to move, a highlighted enemy to attack.'}
              </p>
              <button
                className="secondary"
                disabled={!interaction.canEndActivation}
                title="Press E"
                onClick={props.onEndActivation}
              >
                End activation <kbd>E</kbd>
              </button>
            </div>
          )}
        </div>
      )}

      <UnitInspector state={state} unitId={selectedUnitId ?? state.activeUnitId} />

      <div className="log">
        <h3>Battle log</h3>
        <div className="log-lines">
          {[...props.log].reverse().map((entry) => (
            <div key={entry.id} className={`log-line${entry.tone ? ` ${entry.tone}` : ''}`}>
              {entry.text}
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}

function UnitInspector({ state, unitId }: { state: GameState; unitId: string | null }): JSX.Element | null {
  const u = unitId ? unitById(state, unitId) : null;
  if (!u) return null;
  const traits = traitTags(u);
  return (
    <div className="inspector">
      <h3>
        {u.name} <span className={`inspector-owner p${u.owner}`}>P{u.owner}</span>
      </h3>
      <div className="inspector-stats">
        <span title="Activation dice succeed on this or higher — lower is better">Quality {u.quality}</span>
        <span title="Added to the d6 in fights — higher is better">Combat {u.combat}</span>
        <span title="Hexes per Move action">Move {u.move}</span>
      </div>
      {/* Ranged, Tough and Guard change how a unit must be fought far more than
          its stats do, so they are shown wherever a unit is described. */}
      {traits.length > 0 ? (
        <div className="inspector-traits">
          {traits.map((t) => (
            <span key={t.label} className="trait" title={t.help}>
              {t.label}
            </span>
          ))}
        </div>
      ) : null}
      <div className="inspector-flags">
        {u.knockedDown ? <span className="flag down">knocked down</span> : null}
        {u.guarding && !u.dead ? <span className="flag guarding">on guard</span> : null}
        {u.activatedThisRound ? <span className="flag">activated</span> : null}
        {u.dead ? <span className="flag dead">dead</span> : null}
      </div>
    </div>
  );
}
