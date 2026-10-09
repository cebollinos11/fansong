import { useMemo, useRef, type ReactNode } from 'react';
import type { RunAction, RunState, WarbandUnit } from '@fansong/content';
import type { RunRecord } from '../game/runStore.js';
import { TRAIT_INFO, traitTitle, type TraitKey } from './armyView.js';
import { MapThumb, UnitSprite, unitLine } from './Picker.js';
import {
  aftermathView,
  briefingView,
  draftView,
  historyLines,
  levelLine,
  overView,
  recordLine,
  rewardView,
  runHeader,
  shopView,
  unitView,
  type AftermathView,
  type BriefingView,
  type Choice,
  type DraftView,
  type OfferView,
  repeatGuard,
  type RewardOptionView,
  type ShopView,
  type Target,
  type UnitView,
} from './runView.js';

interface Props {
  run: RunState;
  /** The best runs so far, for the screen that ends a run. */
  records: readonly RunRecord[];
  /** Why the last action didn't go through, if it didn't. */
  error: string | null;
  /** Take a step of the run. */
  onAction: (action: RunAction) => void;
  /** Back to the menu; the run stays saved. */
  onExit: () => void;
  /** A run that is over: start another. */
  onNewRun: () => void;
}

type Act = (action: RunAction) => void;

/**
 * Everything of a run that isn't the battle itself: the draft, the briefing
 * before each battle, and what follows a win — the aftermath, the reward pick
 * and the camp's shop — down to the screen that ends it. It only draws
 * {@link runView.ts}'s view of the run and hands the chosen action back.
 */
export function RunScreen({ run, records, error, onAction, onExit, onNewRun }: Props): JSX.Element {
  const header = runHeader(run);
  // A step redraws the screen, often with another button where the last one was:
  // the second click of a double click must not take that one too.
  const guard = useRef(repeatGuard()).current;
  const act: Act = (action) => {
    if (guard(performance.now())) onAction(action);
  };
  return (
    <div className="muster run">
      <header className="muster-top run-top">
        <button type="button" className="muster-back" onClick={onExit} title="Back to the menu. The run is saved">
          ⟵ Menu
        </button>
        <h1>{header.title}</h1>
        <dl className="run-status">
          <div>
            <dt>Round</dt>
            <dd>{header.round}</dd>
          </div>
          <div>
            <dt>Gold</dt>
            <dd className="run-gold">{header.gold}</dd>
          </div>
          <div>
            <dt>Warband</dt>
            <dd>{header.roster}</dd>
          </div>
          {header.victorious ? (
            <div className="run-won" title="This run has beaten its last boss. It goes on until a battle is lost">
              <dt>Run</dt>
              <dd>♛ Won</dd>
            </div>
          ) : null}
          <div title="Start a new run with this seed to meet the same offers, enemies and battlefields">
            <dt>Seed</dt>
            <dd className="run-seed">{header.seed}</dd>
          </div>
        </dl>
      </header>
      <main className="run-body">
        {error ? <p className="muster-error">{error}</p> : null}
        <Phase run={run} records={records} onAction={act} onExit={onExit} onNewRun={onNewRun} />
      </main>
    </div>
  );
}

function Phase({ run, records, onAction, onExit, onNewRun }: Omit<Props, 'error'>): JSX.Element | null {
  // One view per state: a view asks the rules about every button it shows.
  const view = useMemo(
    () => ({
      draft: draftView(run),
      briefing: briefingView(run),
      aftermath: aftermathView(run),
      reward: rewardView(run),
      shop: shopView(run),
    }),
    [run],
  );
  if (view.draft) return <Draft run={run} view={view.draft} act={onAction} />;
  if (view.briefing) return <Briefing view={view.briefing} act={onAction} />;
  if (view.aftermath) return <Aftermath run={run} view={view.aftermath} act={onAction} />;
  if (view.reward) return <Reward run={run} options={view.reward} act={onAction} />;
  if (view.shop) return <Shop view={view.shop} act={onAction} />;
  if (run.phase === 'over') return <Over run={run} records={records} onExit={onExit} onNewRun={onNewRun} />;
  return null;
}

/** A button that takes a step of the run, greyed out with the rules' own reason when it can't. */
function Go({
  choice,
  act,
  className,
  title,
  children,
}: {
  choice: Choice;
  act: Act;
  className?: string;
  title?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <button type="button" className={className} disabled={choice.error !== null} title={choice.error ?? title} onClick={() => act(choice.action)}>
      {children}
    </button>
  );
}

function Traits({ traits }: { traits: readonly TraitKey[] }): JSX.Element | null {
  if (traits.length === 0) return null;
  return (
    <>
      {traits.map((t) => (
        <span key={t} className="trait-chip plain" title={traitTitle(t)}>
          {TRAIT_INFO[t].label}
        </span>
      ))}
    </>
  );
}

/** A roster unit: its sprite, name, level, numbers, traits and wounds, with whatever it can do now beside it. */
function UnitCard({ view, dim = false, tags, children }: { view: UnitView; dim?: boolean; tags?: ReactNode; children?: ReactNode }): JSX.Element {
  return (
    <li className={`run-unit${dim ? ' dim' : ''}`}>
      <UnitSprite unit={view.unit} className="unit-sprite run-sprite" />
      <div className="run-unit-main">
        <div className="run-unit-name">
          <strong>{view.unit.name}</strong>
          <span className="run-level" title={`${view.kills} ${view.kills === 1 ? 'kill' : 'kills'} this run`}>
            {levelLine(view)}
          </span>
        </div>
        {unitLine(view.unit, view.cost)}
        <div className="run-tags">
          <Traits traits={view.traits} />
          {view.wounds.map((w, i) => (
            <span key={i} className="trait-chip plain run-wound" title={w.help}>
              Wound: {w.label}
            </span>
          ))}
          {tags}
        </div>
      </div>
      {children ? <div className="run-unit-actions">{children}</div> : null}
    </li>
  );
}

/** The whole roster as cards, read-only: what the warband looks like right now. */
function Roster({ run, title = 'Your warband' }: { run: RunState; title?: string }): JSX.Element | null {
  if (run.roster.length === 0) return null;
  return (
    <section className="run-panel">
      <h2 className="muster-label">{title}</h2>
      <ul className="run-units">
        {run.roster.map((u) => {
          const view = unitView(u);
          return <UnitCard key={u.id} view={view} tags={view.sitsOut ? <span className="run-flag">Sits out the next battle</span> : null} />;
        })}
      </ul>
    </section>
  );
}

/** A unit on offer: a big sprite over its name, numbers and traits, and the button that takes it. */
function OfferCard({ offer, children }: { offer: OfferView; children: ReactNode }): JSX.Element {
  return (
    <div className="run-offer">
      <UnitSprite unit={offer.unit} className="unit-sprite run-offer-sprite" />
      <strong className="run-offer-name">{offer.unit.name}</strong>
      {unitLine(offer.unit, offer.cost)}
      <div className="run-tags">
        <Traits traits={offer.traits} />
      </div>
      {children}
    </div>
  );
}

function Draft({ run, view, act }: { run: RunState; view: DraftView; act: Act }): JSX.Element {
  return (
    <>
      <section className="run-panel">
        <h2 className="muster-label">{view.prompt}</h2>
        <p className="muster-meta">
          {view.left} of {view.budget} points left to draft
        </p>
        <div className="run-offers">
          {view.offers.map((offer, i) => (
            <OfferCard key={i} offer={offer}>
              <Go choice={offer.pick} act={act} className="run-go">
                {view.stage === 'leader' ? 'Lead with' : 'Take'} {offer.unit.name}
              </Go>
            </OfferCard>
          ))}
        </div>
      </section>
      <Roster run={run} title="Drafted so far" />
    </>
  );
}

function Briefing({ view, act }: { view: BriefingView; act: Act }): JSX.Element {
  return (
    <div className="run-briefing">
      <section className="run-panel run-field">
        <h2 className="muster-label">{view.mode}</h2>
        <p className="run-goal">{view.goal}</p>
        <MapThumb map={view.map} className="map-thumb run-map" />
        <p className="muster-meta">
          {view.map.width}×{view.map.height} hexes · blue is your edge
          {view.lava ? ' · red-orange is lava' : ''}
        </p>
      </section>

      <section className="run-panel">
        <h2 className="muster-label side-label-1">The enemy: {view.enemy.name}</h2>
        <p className="muster-meta">
          {view.enemy.count} units · {view.enemy.points} pts
          {view.enemy.rival ? ' · the warband a past run of yours ended with' : ''}
        </p>
        <ul className="run-enemy">
          {view.enemy.kinds.map((k, i) => (
            <li key={i}>
              <UnitSprite unit={k.unit} />
              <div>
                <strong>
                  {k.unit.name.replace(/ \d+$/, '')}
                  {k.count > 1 ? ` ×${k.count}` : ''}
                </strong>
                {view.enemy.king === k.unit ? <span className="run-flag king">♛ King</span> : null}
                {unitLine(k.unit)}
                <div className="run-tags">
                  <Traits traits={k.traits} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="run-panel run-yours">
        <h2 className="muster-label side-label-0">Your warband</h2>
        <p className="muster-meta">{view.fielded}</p>
        <ul className="run-units">
          {view.units.map((u) => (
            <UnitCard
              key={u.view.id}
              view={u.view}
              dim={!u.fielded}
              tags={
                <>
                  {u.king ? <span className="run-flag king">♛ King</span> : null}
                  {u.view.sitsOut ? <span className="run-flag">Hurt: sits this one out</span> : null}
                  {u.view.benched && !u.view.sitsOut ? <span className="run-flag">Benched</span> : null}
                </>
              }
            >
              {u.crown ? (
                <Go choice={u.crown} act={act} title="Make this unit your King: lose it and the battle is lost">
                  ♛ Crown
                </Go>
              ) : null}
              {u.bench ? (
                <Go choice={u.bench} act={act} title={u.view.benched ? 'Put it back in the battle' : 'Leave it out of this battle'}>
                  {u.view.benched ? 'Field' : 'Bench'}
                </Go>
              ) : null}
            </UnitCard>
          ))}
        </ul>
        <Go choice={view.start} act={act} className="run-go run-go-big">
          To battle
        </Go>
      </section>
    </div>
  );
}

function Aftermath({ run, view, act }: { run: RunState; view: AftermathView; act: Act }): JSX.Element {
  return (
    <>
      {view.triumph ? (
        <section className="run-panel run-triumph">
          <h2 className="run-headline">♛ {view.triumph.headline}</h2>
          <p className="muster-meta">{view.triumph.detail}</p>
        </section>
      ) : null}
      <section className="run-panel">
        <h2 className="muster-label">After the battle</h2>
        <p className="muster-meta">
          The win pays <span className="run-gold">{view.gold} gold</span>.
        </p>
        <table className="run-table">
          <thead>
            <tr>
              <th>Unit</th>
              <th>Kills</th>
              <th>XP</th>
              <th>Fate</th>
            </tr>
          </thead>
          <tbody>
            {view.lines.map((line) => (
              <tr key={line.unitId} className={`fate-${line.tone}`}>
                <td>{line.name}</td>
                <td>{line.kills}</td>
                <td>{line.xp > 0 ? `+${line.xp}` : '—'}</td>
                <td>{line.text}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {view.levelUps.length > 0 ? (
        <section className="run-panel">
          <h2 className="muster-label">Level up</h2>
          <ul className="run-units">
            {view.levelUps.map((up) => (
              <UnitCard key={up.view.id} view={up.view}>
                {up.options.map((option, i) => (
                  <Go key={i} choice={option.take} act={act} className="run-pick" title={option.info.help}>
                    <strong>{option.info.label}</strong>
                    <span>{option.change}</span>
                  </Go>
                ))}
              </UnitCard>
            ))}
          </ul>
        </section>
      ) : null}

      <Go choice={view.next} act={act} className="run-go run-go-big">
        {view.levelUps.length > 0 ? 'Spend the levels first' : 'Claim a reward'}
      </Go>
      <Roster run={run} />
    </>
  );
}

/** The units something can be given to, each a button saying what it would do to that unit. */
function Targets({ targets, act, none }: { targets: readonly Target[]; act: Act; none: string }): JSX.Element {
  if (targets.length === 0) return <p className="muster-note">{none}</p>;
  return (
    <div className="run-targets">
      {targets.map((t) => (
        <Go key={t.unitId} choice={t.give} act={act} className="run-target" title={t.change}>
          <UnitSprite unit={t.unit} />
          <span>
            <strong>{t.unit.name}</strong>
            <small>
              {t.change}
              {t.price === undefined ? '' : ` · ${t.price} gold`}
            </small>
          </span>
        </Go>
      ))}
    </div>
  );
}

function Reward({ run, options, act }: { run: RunState; options: RewardOptionView[]; act: Act }): JSX.Element {
  return (
    <>
      <section className="run-panel">
        <h2 className="muster-label">Choose one</h2>
        <div className="run-offers">
          {options.map((option, i) =>
            option.recruit ? (
              <OfferCard key={i} offer={option.recruit}>
                <p className="muster-note">{option.detail}</p>
                <Go choice={option.take!} act={act} className="run-go">
                  Recruit
                </Go>
              </OfferCard>
            ) : (
              <div key={i} className="run-offer">
                <strong className="run-offer-name">{option.title}</strong>
                <p className="muster-note">{option.detail}</p>
                {option.take ? (
                  <Go choice={option.take} act={act} className="run-go">
                    Take
                  </Go>
                ) : (
                  <Targets targets={option.targets ?? []} act={act} none="No unit can use it." />
                )}
              </div>
            ),
          )}
        </div>
      </section>
      <Roster run={run} />
    </>
  );
}

function Shop({ view, act }: { view: ShopView; act: Act }): JSX.Element {
  const sell = (unit: WarbandUnit, price: number, action: RunAction): void => {
    if (window.confirm(`Sell ${unit.name} for ${price} gold? It leaves the warband for good.`)) act(action);
  };
  return (
    <>
      <section className="run-panel">
        <h2 className="muster-label">Recruits</h2>
        {view.full ? <p className="muster-note">The warband is full: sell a unit to make room.</p> : null}
        <div className="run-offers">
          {view.recruits.map((r, i) =>
            r ? (
              <OfferCard key={i} offer={r}>
                <Go choice={r.buy} act={act} className="run-go">
                  Hire · {r.price} gold
                </Go>
              </OfferCard>
            ) : (
              <div key={i} className="run-offer sold">
                Hired
              </div>
            ),
          )}
        </div>
      </section>

      <section className="run-panel">
        <h2 className="muster-label">Training</h2>
        <div className="run-offers">
          {view.upgrades.map((u, i) =>
            u ? (
              <div key={i} className="run-offer">
                <strong className="run-offer-name">{u.info.label}</strong>
                <p className="muster-note">{u.info.help}</p>
                <Targets targets={u.targets} act={act} none="No unit can learn it." />
              </div>
            ) : (
              <div key={i} className="run-offer sold">
                Taught
              </div>
            ),
          )}
          {view.upgrades.length === 0 ? <p className="muster-note">Nothing left to teach this warband.</p> : null}
        </div>
        <Go choice={view.reroll.buy} act={act} title="Swap the recruits and the training for new ones">
          New stock · {view.reroll.price} gold
        </Go>
      </section>

      <section className="run-panel">
        <h2 className="muster-label">Your warband</h2>
        <ul className="run-units">
          {view.units.map((u) => (
            <UnitCard key={u.view.id} view={u.view} tags={u.view.sitsOut ? <span className="run-flag">Sits out the next battle</span> : null}>
              {u.heal ? (
                <Go choice={u.heal} act={act} title="Mend its oldest lasting wound">
                  Heal · {view.healPrice} gold
                </Go>
              ) : null}
              <button
                type="button"
                disabled={u.sell.sell.error !== null}
                title={u.sell.sell.error ?? 'Sell this unit'}
                onClick={() => sell(u.view.unit, u.sell.price, u.sell.sell.action)}
              >
                Sell · +{u.sell.price}
              </button>
            </UnitCard>
          ))}
        </ul>
        <Go choice={view.leave} act={act} className="run-go run-go-big">
          Break camp
        </Go>
      </section>
    </>
  );
}

function Over({ run, records, onExit, onNewRun }: { run: RunState; records: readonly RunRecord[]; onExit: () => void; onNewRun: () => void }): JSX.Element {
  const view = overView(run);
  const history = historyLines(run);
  return (
    <>
      <section className="run-panel run-over">
        <h2 className="run-headline">{view.headline}</h2>
        <p className="muster-meta">{view.summary}</p>
        <ol className="run-history">
          {history.map((line) => (
            <li key={line.round} className={line.won ? 'won' : 'lost'}>
              <span>Round {line.round}</span> {line.text}
            </li>
          ))}
        </ol>
        <div className="run-over-actions">
          <button type="button" className="run-go" onClick={onNewRun}>
            New run
          </button>
          <button type="button" onClick={onExit}>
            Menu
          </button>
        </div>
      </section>
      <RunRecords records={records} />
      <Roster run={run} title="The warband at the end" />
    </>
  );
}

/** The best runs so far, best first. */
export function RunRecords({ records }: { records: readonly RunRecord[] }): JSX.Element {
  return (
    <section className="run-panel">
      <h2 className="muster-label">Best runs</h2>
      {records.length === 0 ? <p className="muster-note">No run has ended yet.</p> : null}
      <ol className="run-records">
        {records.map((r) => (
          <li key={`${r.at}:${r.seed}`} className={r.victorious ? 'victorious' : undefined}>
            {r.victorious ? '♛ ' : ''}
            {recordLine(r)}
          </li>
        ))}
      </ol>
    </section>
  );
}
