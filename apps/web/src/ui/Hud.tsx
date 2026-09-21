import { aliveUnits, unitById, type GameState, type Owner } from '@fansong/engine';
import type { Interaction } from '../game/interaction.js';
import { isAiSeat, type MatchSetup } from '@fansong/content';
import type { ClientStatus } from '../game/client.js';
import type { LogEntry } from './log.js';

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
  log: LogEntry[];
  onActivate: (diceCount: number) => void;
  onEndActivation: () => void;
  onExit: () => void;
}

function seatLabel(setup: MatchSetup, controlled: readonly Owner[], owner: Owner): string {
  if (isAiSeat(setup, owner)) return 'AI';
  if (controlled.includes(owner)) return 'You';
  return 'Opponent';
}

/** A one-line connection banner for online play; null when there's nothing to say. */
function statusBanner(status: ClientStatus): string | null {
  switch (status.phase) {
    case 'connecting':
      return 'Connecting…';
    case 'waiting':
      return 'Waiting for an opponent to join…';
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
        {([0, 1] as const).map((owner) => (
          <div key={owner} className={`score p${owner}${state.active === owner && !gameOver ? ' active' : ''}`}>
            <span className="score-name">
              P{owner} · {seatLabel(setup, controlledSeats, owner)}
            </span>
            <span className="score-count">{aliveUnits(state, owner).length} alive</span>
            {state.benched[owner] && !gameOver ? <span className="benched">benched</span> : null}
          </div>
        ))}
      </div>

      {gameOver ? (
        <div className="banner win">
          Player {state.winner} ({seatLabel(setup, controlledSeats, state.winner as Owner)}) wins!
        </div>
      ) : (
        <div className="turn-panel">
          {!humanTurn ? (
            <p className="thinking">
              {isAiSeat(setup, state.active) ? 'AI is thinking…' : "Opponent's turn…"}
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
                    More dice = more actions but higher turnover risk. One die can never turn over. Tip: press 1–3 to roll.
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
                Click a green tile to move, a highlighted enemy to attack.
              </p>
              <button className="secondary" disabled={!interaction.canEndActivation} onClick={props.onEndActivation}>
                End activation
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
            <div key={entry.id} className="log-line">
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
  return (
    <div className="inspector">
      <h3>{u.name}</h3>
      <div className="inspector-stats">
        <span>Quality {u.quality}</span>
        <span>Combat {u.combat}</span>
        <span>Move {u.move}</span>
      </div>
      <div className="inspector-flags">
        {u.knockedDown ? <span className="flag down">knocked down</span> : null}
        {u.activatedThisRound ? <span className="flag">activated</span> : null}
        {u.dead ? <span className="flag dead">dead</span> : null}
      </div>
    </div>
  );
}
