import type { JSX } from 'react';
import type { HexFight } from './hexInfo.js';
import { InfoLines } from './StatIcons.js';

// The tooltip over an enemy a click would fight. It leads with the odds; the
// modifiers behind them and the target's abilities wait underneath.

const pct = (p: number): number => Math.round(p * 100);

/**
 * The odds as whole percentages that share one hundred: a win that kills, a win
 * that doesn't, neither side hurt, and the attacker hurt.
 */
export function oddsShares(fight: Pick<HexFight, 'odds'>): { kill: number; win: number; clash: number; lose: number } {
  const win = pct(fight.odds.win);
  const kill = Math.min(win, pct(fight.odds.kill));
  const lose = Math.min(100 - win, pct(fight.odds.lose));
  return { kill, win: win - kill, clash: 100 - win - lose, lose };
}

/** "Attack Skeleton Infantry" on the left, its price on the right. */
function Order({ fight }: { fight: HexFight }): JSX.Element {
  return (
    <div className="ft-order">
      <span>
        {fight.verb} <strong>{fight.target}</strong>
      </span>
      <span className="ft-cost">{fight.cost}</span>
    </div>
  );
}

/** What the odds leave out or fold in: a guard's riposte, and a parting blow on the way. */
function Warnings({ fight }: { fight: HexFight }): JSX.Element | null {
  if (!fight.riposte && !fight.breaksAway) return null;
  return (
    <>
      {fight.riposte ? <div className="ft-warn">On guard — its riposte comes first (counted in the odds)</div> : null}
      {fight.breaksAway ? <div className="ft-warn">Breaking away — risks a parting blow</div> : null}
    </>
  );
}

/** Both sides' modifiers as the roll card's chips, a guard's riposte first. */
function ChipRows({ fight }: { fight: HexFight }): JSX.Element {
  return (
    <>
      {fight.riposte ? (
        <>
          <div className="ft-step">Riposte</div>
          <InfoLines lines={[fight.riposte.guard, fight.riposte.attacker]} />
          <div className="ft-step">Then the blow</div>
        </>
      ) : null}
      <InfoLines lines={[fight.attacker, fight.defender]} />
    </>
  );
}

/** The small print: what each modifier is, and the target's own stats and abilities. */
function Fine({ fight }: { fight: HexFight }): JSX.Element | null {
  const lines = [...(fight.detailed ? fight.help : []), ...fight.about];
  if (lines.length === 0) return null;
  return (
    <div className="ft-fine">
      <InfoLines lines={lines} />
    </div>
  );
}

/**
 * One bar split into kill, win, stand-off and lose, with the numbers under it
 * and the two scores it comes from. Resting on the hex opens the modifiers
 * behind the scores.
 */
export function FightTip({ fight }: { fight: HexFight }): JSX.Element {
  const s = oddsShares(fight);
  const won = s.kill + s.win;
  return (
    <div className="ft">
      <Order fight={fight} />
      <div className="ft-bar" role="img" aria-label={`Win ${won}%, kill ${s.kill}%, lose ${s.lose}%`}>
        <i className="kill" style={{ flexGrow: s.kill }} />
        <i className="win" style={{ flexGrow: s.win }} />
        <i className="clash" style={{ flexGrow: s.clash }} />
        <i className="lose" style={{ flexGrow: s.lose }} />
      </div>
      <div className="ft-legend">
        <span className="win">
          <b>{won}%</b> win
          {s.kill > 0 ? <em> · {s.kill}% kill</em> : null}
        </span>
        {fight.ranged ? <span className="clash">no risk</span> : <span className="lose"><b>{s.lose}%</b> lose</span>}
      </div>
      <Warnings fight={fight} />
      {fight.detailed ? (
        <ChipRows fight={fight} />
      ) : (
        <div className="ft-versus">
          {fight.attacker.name} <b>{fight.attacker.total}</b> <span>vs</span> <b>{fight.defender.total}</b>{' '}
          {fight.defender.name}
        </div>
      )}
      <Fine fight={fight} />
    </div>
  );
}
