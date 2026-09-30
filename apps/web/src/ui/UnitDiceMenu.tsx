import { useEffect, useRef } from 'react';
import type { Owner } from '@fansong/engine';
import { anchoredCard, type UnitProjector } from './anchorView.js';
import { diceHint, dicePips } from './diceMenuView.js';
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
  choices: readonly number[];
  project: UnitProjector;
  onPick: (dice: number) => void;
}

/**
 * The dice commitment, floating over the unit it is about to activate. The HUD
 * offers the same choice, but a player who has just clicked a unit on the board
 * should not have to cross the screen to answer the question that click asked.
 */
export function UnitDiceMenu({ unitId, unitName, owner, quality, inspired, choices, project, onPick }: Props): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  // The tap that picked the unit must not also pick a dice count.
  const { onPointerDown, guard } = usePressGuard();

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
        {unitName} <span className="dice-menu-quality">needs {quality}+</span>
      </div>
      {inspired ? <div className="dice-menu-inspired">★ Inspired: first die is a sure 6</div> : null}
      <div className="dice-menu-row">
        {choices.map((n) => (
          <button key={n} type="button" className="dice-pick" title={diceHint(n, inspired)} onClick={guard(() => onPick(n))}>
            <span className="dice-pick-count">{n}</span>
            <span className="dice-pick-label">{n === 1 ? 'die' : 'dice'}</span>
            {inspired ? (
              // Preview the roll: the war cry's 6 is already showing, the rest are
              // still to be thrown.
              <span className="dice-pick-pips" aria-hidden="true">
                {dicePips(n, true).map((pip, i) => (
                  <span key={i} className={`dice-pip ${pip}`}>
                    {pip === 'sure' ? '6' : '?'}
                  </span>
                ))}
              </span>
            ) : null}
            <kbd>{n}</kbd>
          </button>
        ))}
      </div>
    </div>
  );
}
