import { useEffect, useRef, useState } from 'react';
import type { Owner } from '@fansong/engine';
import { anchoredCard, type UnitProjector } from './anchorView.js';
import { diceHint, groupHint, oddsParts, TURNOVER_COST } from './diceMenuView.js';
import type { TraitTag } from './hudView.js';
import { usePressGuard } from './pressGuard.js';

/** World height above a unit's base that the menu's bottom edge rides at. */
const MENU_HEIGHT = 1.35;

interface Props {
  unitId: string;
  unitName: string;
  owner: Owner;
  /** The unit's Quality: the number each die must beat. */
  quality: number;
  /** Inspired by a war cry: the first die rolled is a sure 6. */
  inspired: boolean;
  traits: readonly TraitTag[];
  choices: readonly number[];
  /** Offered when the unit has a group: how many would share the roll, and whether all of them are inspired. */
  group?: { size: number; inspired: boolean };
  project: UnitProjector;
  onPick: (dice: number, group: boolean) => void;
}

/**
 * The dice commitment, floating over the unit it is about to activate. The HUD
 * offers the same choice, but a player who has just clicked a unit on the board
 * should not have to cross the screen to answer the question that click asked.
 */
export function UnitDiceMenu({ unitId, unitName, owner, quality, inspired, traits, choices, group, project, onPick }: Props): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  // The tap that picked the unit must not also pick a dice count.
  const { onPointerDown, guard } = usePressGuard();
  // The choice under the pointer (or keyboard focus), whose odds the menu quotes.
  const [hovered, setHovered] = useState<{ dice: number; group: boolean } | null>(null);
  const odds = hovered
    ? oddsParts(hovered.dice, quality, hovered.group ? (group?.inspired ?? false) : inspired)
    : null;
  const hover = (dice: number, inGroup: boolean) => ({
    onPointerEnter: () => setHovered({ dice, group: inGroup }),
    onPointerLeave: () => setHovered(null),
    onFocus: () => setHovered({ dice, group: inGroup }),
    onBlur: () => setHovered(null),
  });

  // Ride the unit every frame: the camera is still panning to the pick, and the
  // player may orbit or zoom before deciding.
  useEffect(() => {
    let raf = 0;
    const follow = (): void => {
      raf = requestAnimationFrame(follow);
      const el = ref.current;
      const area = el?.parentElement;
      if (!el || !area) return;
      const p = project(unitId, MENU_HEIGHT);
      if (!p) {
        el.style.visibility = 'hidden';
        return;
      }
      const at = anchoredCard(
        p,
        { width: el.offsetWidth, height: el.offsetHeight },
        { width: area.clientWidth, height: area.clientHeight },
      );
      el.style.transform = `translate(${Math.round(at.x)}px, ${Math.round(at.y)}px)`;
      el.style.visibility = '';
    };
    follow();
    return () => cancelAnimationFrame(raf);
  }, [unitId, project]);

  return (
    <div
      ref={ref}
      // Hidden until the first frame has put it over the unit.
      style={{ visibility: 'hidden' }}
      className={`dice-menu p${owner}${inspired ? ' inspired' : ''}`}
      role="group"
      onPointerDown={onPointerDown}
      aria-label={`Commit dice to activate ${unitName}`}
    >
      <div className="dice-menu-title">
        <span>{unitName}</span>
        <span className="dice-menu-quality">
          {inspired ? '★ ' : ''}
          {quality}+
        </span>
      </div>
      {traits.length > 0 ? (
        <div className="dice-menu-traits">
          {traits.map((t) => (
            <span key={t.label} title={t.help}>
              {t.label}
            </span>
          ))}
        </div>
      ) : null}
      <div className="dice-menu-row">
        {choices.map((n, i) => (
          <button
            key={n}
            type="button"
            className="dice-pick"
            title={diceHint(n, inspired)}
            aria-label={`Roll ${n} ${n === 1 ? 'die' : 'dice'}`}
            onClick={guard(() => onPick(n, false))}
            {...hover(n, false)}
          >
            {/* An inspired unit's first die is the war cry's sure 6, gold as in the roll. */}
            <DieFace pips={n} sure={inspired && i === 0} />
          </button>
        ))}
      </div>
      {group ? (
        <>
          <div className="dice-menu-group" title="Every unit like this one within 2 hexes shares one roll, and all of them act before the turn passes.">
            Group of {group.size}
            <kbd>⇧</kbd>
          </div>
          <div className="dice-menu-row">
            {choices.map((n, i) => (
              <button
                key={n}
                type="button"
                className="dice-pick group"
                title={groupHint(n, group.size, group.inspired)}
                aria-label={`Roll ${n} ${n === 1 ? 'die' : 'dice'} for the group of ${group.size}`}
                onClick={guard(() => onPick(n, true))}
                {...hover(n, true)}
              >
                <DieFace pips={n} sure={group.inspired && i === 0} />
              </button>
            ))}
          </div>
        </>
      ) : null}
      {/* Always there, so the menu (which rides on its bottom edge) never jumps under the pointer. */}
      <div className={`dice-menu-odds${odds ? ' live' : ''}`} aria-live="polite">
        {odds ? (
          <>
            <strong>{hovered?.group ? `Group, ${odds.dice}` : odds.dice}</strong>
            <span>{odds.act}</span>
            <span className={odds.safe ? 'safe' : 'risk'}>{odds.risk}</span>
          </>
        ) : (
          TURNOVER_COST
        )}
      </div>
    </div>
  );
}

/** Where each pip sits on a 24-unit face, for the counts the menu offers. */
const PIP_SPOTS: Record<number, ReadonlyArray<readonly [number, number]>> = {
  1: [[12, 12]],
  2: [[7, 7], [17, 17]],
  3: [[6, 6], [12, 12], [18, 18]],
  4: [[7, 7], [17, 7], [7, 17], [17, 17]],
};

/** A die face showing how many dice the button commits. */
function DieFace({ pips, sure }: { pips: number; sure: boolean }): JSX.Element {
  return (
    <svg className={`die-face${sure ? ' sure' : ''}`} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="1" y="1" width="22" height="22" rx="5" />
      {(PIP_SPOTS[pips] ?? []).map(([x, y]) => (
        <circle key={`${x},${y}`} cx={x} cy={y} r="2.3" />
      ))}
    </svg>
  );
}
