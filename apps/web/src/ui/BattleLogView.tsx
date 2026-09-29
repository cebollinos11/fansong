import { useState } from 'react';
import type { Vec } from '@fansong/engine';
import { DIE_PIPS } from '../three/rollOverlay.js';
import { type BattleLog, type DiceRoll, type LogCategory, type LogGroup, type LogItem, type LogPart } from './log.js';

/** What a hovered log line points at on the board. */
export interface LogFocus {
  unitIds: string[];
  path?: Vec[];
}

interface Props {
  log: BattleLog;
  title?: string;
  /** Hovering a line (null when the pointer leaves it). */
  onFocus?: (focus: LogFocus | null) => void;
  /** Clicking a unit's name; names are plain text without it. */
  onInspect?: (unitId: string) => void;
}

type Filter = 'all' | 'combat' | 'objective';

const FILTERS: [Filter, string][] = [
  ['all', 'All'],
  ['combat', 'Combat'],
  ['objective', 'Objectives'],
];

const FILTER_KEY = 'fansong.logFilter';

function loadFilter(): Filter {
  try {
    const saved = localStorage.getItem(FILTER_KEY);
    return FILTERS.find(([f]) => f === saved)?.[0] ?? 'all';
  } catch {
    return 'all';
  }
}

function saveFilter(filter: Filter): void {
  try {
    localStorage.setItem(FILTER_KEY, filter);
  } catch {
    // Not remembered; the filter still works for this session.
  }
}

/** Whether a line shows under `filter`; the game-over line always does. */
function shows(item: LogItem, filter: Filter): boolean {
  if (filter === 'all' || item.tone === 'end') return true;
  const wanted: LogCategory = filter;
  return item.category === wanted;
}

/**
 * The battle log: rounds newest first, each listing its activations newest
 * first, and each activation's lines in the order they happened. Only the
 * newest activation is open; the rest fold to a one-line summary.
 */
export function BattleLogView({ log, title = 'Battle log', onFocus, onInspect }: Props): JSX.Element {
  const [filter, setFilter] = useState<Filter>(loadFilter);
  // Activations whose open/closed state the reader flipped from the default.
  const [flipped, setFlipped] = useState<ReadonlySet<number>>(new Set());
  // Lines whose detail (a fight's score breakdown) is open.
  const [details, setDetails] = useState<ReadonlySet<number>>(new Set());

  const toggle = (set: ReadonlySet<number>, id: number): Set<number> => {
    const next = new Set(set);
    if (!next.delete(id)) next.add(id);
    return next;
  };

  const newest = log.rounds.flatMap((r) => r.groups.filter((g) => g.unit)).at(-1)?.id;
  const lastRound = log.rounds.at(-1);

  const name = (p: Extract<LogPart, { unit: unknown }>, key: number): JSX.Element =>
    onInspect ? (
      <span
        key={key}
        role="button"
        tabIndex={0}
        className={`log-unit p${p.unit.owner} link`}
        title={`Inspect ${p.unit.name}`}
        onClick={(e) => {
          e.stopPropagation();
          onInspect(p.unit.id);
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          e.stopPropagation();
          onInspect(p.unit.id);
        }}
      >
        {p.unit.name}
      </span>
    ) : (
      <span key={key} className={`log-unit p${p.unit.owner}`}>
        {p.unit.name}
      </span>
    );

  const parts = (list: readonly LogPart[]): JSX.Element[] =>
    list.map((p, i) =>
      typeof p === 'string' ? (
        <span key={i}>{p}</span>
      ) : 'unit' in p ? (
        name(p, i)
      ) : 'player' in p ? (
        <span key={i} className={`log-player p${p.player}`}>
          P{p.player}
        </span>
      ) : (
        <span key={i} className={`log-em${p.cls ? ` ${p.cls}` : ''}`}>
          {p.em}
        </span>
      ),
    );

  const focus = (f: LogFocus | null) => onFocus?.(f);

  const line = (item: LogItem): JSX.Element => {
    const open = details.has(item.id);
    return (
      <div
        key={item.id}
        className={`log-item${item.tone ? ` ${item.tone}` : ''}${item.detail ? ' has-detail' : ''}`}
        title={item.detail?.join('\n')}
        onMouseEnter={() => focus({ unitIds: item.unitIds, ...(item.path ? { path: item.path } : {}) })}
        onMouseLeave={() => focus(null)}
        onClick={item.detail ? () => setDetails((d) => toggle(d, item.id)) : undefined}
      >
        <span className="log-icon" aria-hidden="true">
          {item.icon}
        </span>
        <span className="log-text">
          {parts(item.parts)}
          {item.detail ? <span className="log-more">{open ? '▾' : '▸'}</span> : null}
          {open && item.detail ? (
            <span className="log-detail">
              {item.detail.map((d) => (
                <span key={d}>{d}</span>
              ))}
            </span>
          ) : null}
        </span>
      </div>
    );
  };

  const group = (g: LogGroup): JSX.Element | null => {
    const items = g.items.filter((i) => shows(i, filter));
    if (!g.unit) return items.length ? <div key={g.id} className="log-group loose">{items.map(line)}</div> : null;
    // Filtered views drop activations with nothing of that kind, and skip the dice.
    if (filter !== 'all' && items.length === 0) return null;
    const expanded = (g.id === newest) !== flipped.has(g.id);
    const brief = items.filter((i) => i.brief);
    return (
      <div key={g.id} className={`log-group p${g.unit.owner}${expanded ? ' open' : ''}${g.turnover ? ' turnover' : ''}`}>
        <div
          className="log-group-head"
          role="button"
          tabIndex={0}
          aria-expanded={expanded}
          onClick={() => setFlipped((f) => toggle(f, g.id))}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            setFlipped((f) => toggle(f, g.id));
          }}
          onMouseEnter={() => focus({ unitIds: [g.unit!.id] })}
          onMouseLeave={() => focus(null)}
        >
          <span className="log-caret" aria-hidden="true">
            ▸
          </span>
          {name({ unit: g.unit }, -1)}
          {g.roll ? <Dice roll={g.roll} /> : g.diceCount ? <span className="log-dim">{g.diceCount}d</span> : null}
          {!expanded && brief.length ? (
            <span className="log-brief">
              {brief.map((i) => (
                <span key={i.id} className={`log-brief-bit${i.tone ? ` ${i.tone}` : ''}`}>
                  {parts(i.brief!)}
                </span>
              ))}
            </span>
          ) : null}
        </div>
        {expanded && items.length ? <div className="log-items">{items.map(line)}</div> : null}
      </div>
    );
  };

  const rounds = [...log.rounds].reverse();
  return (
    <div className="log">
      <div className="log-head">
        <h3>{title}</h3>
        <div className="log-filter" role="group" aria-label="Show">
          {FILTERS.map(([f, label]) => (
            <button
              key={f}
              type="button"
              className={f === filter ? 'on' : undefined}
              aria-pressed={f === filter}
              onClick={() => {
                setFilter(f);
                saveFilter(f);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="log-body" onMouseLeave={() => focus(null)}>
        {rounds.map((r) => {
          const groups = [...r.groups].reverse().map(group).filter((g) => g !== null);
          if (groups.length === 0 && r !== lastRound) return null;
          return (
            <section key={r.round} className="log-round">
              <div className="log-round-head">
                Round {r.round}
                {r.leader !== undefined ? (
                  <>
                    {' · '}
                    <span className={`log-player p${r.leader}`}>P{r.leader}</span> leads
                  </>
                ) : null}
              </div>
              {groups.length ? groups : <div className="log-empty">Nothing yet.</div>}
            </section>
          );
        })}
      </div>
    </div>
  );
}

/** An activation's dice: pips on small dice, green for a success, dim for a failure. */
function Dice({ roll }: { roll: DiceRoll }): JSX.Element {
  const label = `Quality ${roll.quality}+: ${roll.successes} ${roll.successes === 1 ? 'success' : 'successes'}, ${roll.failures} ${roll.failures === 1 ? 'failure' : 'failures'}${roll.inspired ? ' (inspired: the first die is a sure 6)' : ''}`;
  return (
    <span className="log-dice" title={label} aria-label={label}>
      {roll.dice.map((d, i) => {
        const on = DIE_PIPS[d] ?? [];
        return (
          <span
            key={i}
            className={`mini-die ${d >= roll.quality ? 'hit' : 'miss'}${roll.inspired && i === 0 ? ' sure' : ''}`}
          >
            {Array.from({ length: 9 }, (_, p) => (
              <span key={p} className={on.includes(p) ? 'pip on' : 'pip'} />
            ))}
          </span>
        );
      })}
    </span>
  );
}
