import { useEffect, useRef } from 'react';
import type { Owner } from '@fansong/engine';
import { anchoredCard, type UnitProjector } from './anchorView.js';

/** World height above a unit's base that the menu's bottom edge rides at. */
const MENU_HEIGHT = 1.35;

interface Props {
  unitId: string;
  unitName: string;
  owner: Owner;
  /** The unit's Quality: the number each die must beat. */
  quality: number;
  choices: readonly number[];
  project: UnitProjector;
  onPick: (dice: number) => void;
}

/** What committing this many dice buys, and what it risks. */
function diceHint(n: number): string {
  return n === 1
    ? 'One die — at most one action, but a single die can never turn over.'
    : `${n} dice — up to ${n} actions, but two failures bench you for the rest of the round.`;
}

/**
 * The dice commitment, floating over the unit it is about to activate. The HUD
 * offers the same choice, but a player who has just clicked a unit on the board
 * should not have to cross the screen to answer the question that click asked.
 */
export function UnitDiceMenu({ unitId, unitName, owner, quality, choices, project, onPick }: Props): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);

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
      className={`dice-menu p${owner}`}
      role="group"
      aria-label={`Commit dice to activate ${unitName}`}
    >
      <div className="dice-menu-title">
        {unitName} <span className="dice-menu-quality">needs {quality}+</span>
      </div>
      <div className="dice-menu-row">
        {choices.map((n) => (
          <button key={n} type="button" className="dice-pick" title={diceHint(n)} onClick={() => onPick(n)}>
            <span className="dice-pick-count">{n}</span>
            <span className="dice-pick-label">{n === 1 ? 'die' : 'dice'}</span>
            <kbd>{n}</kbd>
          </button>
        ))}
      </div>
    </div>
  );
}
