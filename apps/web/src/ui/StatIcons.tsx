import { BASE_MOVE } from '@fansong/engine';
import type { JSX } from 'react';
import type { HexScore, HexTrait } from './hexInfo.js';
import { modifierHelp, signed } from './rollView.js';

/** The unit numbers shown as icon badges wherever a unit is described. */
export type StatKind = 'quality' | 'combat' | 'move' | 'range';

export const STAT_INFO: Record<StatKind, { name: string; help: string }> = {
  quality: { name: 'Quality', help: 'activation dice succeed on this or higher (lower is better)' },
  combat: { name: 'Combat', help: 'added to the d6 in fights (higher is better)' },
  move: { name: 'Move', help: 'hexes per Move action' },
  range: { name: 'Range', help: 'hexes it can shoot' },
};

// Each stat's badge: a die for Quality (it is the number the dice must roll),
// a shield for Combat, an arrow for Move and a target for Range. The number
// sits in the middle, so the shapes keep their centres clear.
const SHAPES: Record<StatKind, JSX.Element> = {
  quality: <rect x="2" y="2" width="20" height="20" rx="5" />,
  combat: <path d="M12 1.5 21.5 4.5V11c0 6-4 9.8-9.5 11.8C6.5 20.8 2.5 17 2.5 11V4.5Z" />,
  move: <path d="M1.5 4.5H15L22.5 12 15 19.5H1.5L5 12Z" />,
  range: (
    <>
      <circle cx="12" cy="12" r="10.5" />
      <circle className="stat-icon-ring" cx="12" cy="12" r="7.5" />
    </>
  ),
};

/** One stat as an icon with its value inside; with no value, just the icon (e.g. a column header). */
export function StatIcon({ stat, value }: { stat: StatKind; value?: number }): JSX.Element {
  const { name, help } = STAT_INFO[stat];
  const title = value === undefined ? `${name} — ${help}` : `${name} ${value} — ${help}`;
  return (
    <span className={`stat-icon stat-${stat}`} title={title} role="img" aria-label={value === undefined ? name : `${name} ${value}`}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {SHAPES[stat]}
      </svg>
      {value === undefined ? null : (
        <span className="stat-icon-value">
          {value}
          {stat === 'quality' ? '+' : null}
        </span>
      )}
    </span>
  );
}

export interface UnitStats {
  quality: number;
  combat: number;
  move: number;
  /** Only for units that shoot. */
  range?: number;
}

/** A unit's core numbers as a row of icons. Move shows only when Slow or Fast shifts it from {@link BASE_MOVE}. */
export function StatIcons({ stats }: { stats: UnitStats }): JSX.Element {
  return (
    <span className="stat-icons">
      <StatIcon stat="quality" value={stats.quality} />
      <StatIcon stat="combat" value={stats.combat} />
      {stats.move === BASE_MOVE ? null : <StatIcon stat="move" value={stats.move} />}
      {stats.range === undefined ? null : <StatIcon stat="range" value={stats.range} />}
    </span>
  );
}

/** One side's score in a coming fight: its name, its modifiers as the roll card's chips, and the total. */
function ScoreLine({ score }: { score: HexScore }): JSX.Element {
  return (
    <div className="info-score">
      <span className="info-score-who">{score.name}</span>
      {score.mods.map((m) => (
        <span key={m.label} className={`info-mod${m.value === 0 ? ' zero' : ''}`} title={modifierHelp(m.label)}>
          <b>{signed(m.value)}</b> {m.label}
        </span>
      ))}
      <span className="info-score-total">= {score.total}</span>
    </div>
  );
}

/**
 * Tooltip lines as divs: text as it is, a unit's stats as icons, an ability
 * with what it does, a side's score in a fight as modifier chips.
 */
export function InfoLines({ lines }: { lines: readonly (string | UnitStats | HexTrait | HexScore)[] }): JSX.Element {
  return (
    <>
      {lines.map((line, i) =>
        typeof line === 'string' ? (
          <div key={line}>{line}</div>
        ) : 'mods' in line ? (
          <ScoreLine key={`score-${i}`} score={line} />
        ) : 'trait' in line ? (
          <div key={`trait-${line.trait}`} className="info-trait">
            <strong>{line.trait}</strong> — {line.help}
          </div>
        ) : (
          <StatIcons key={`stats-${i}`} stats={line} />
        ),
      )}
    </>
  );
}
