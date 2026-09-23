import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ActionPlan } from '@fansong/engine';

/** Which weapon the menu is offering — melee blows or ranged shots. */
export type AttackKind = 'melee' | 'ranged';

export interface AttackChoice {
  targetId: string;
  targetName: string;
  kind: AttackKind;
  /** The one-blow plan, which may include walking into contact first. */
  plain: ActionPlan;
  /** The pressed twin of {@link plain}, from the same hex. */
  pressed: ActionPlan;
  /** Actions the unit holds, so the menu can say what each choice leaves over. */
  actionsRemaining: number;
  /** Where the click landed, in viewport coordinates; the menu opens above it. */
  at: { x: number; y: number };
}

interface Props {
  choice: AttackChoice;
  /** `pressed` = spend two actions for the power blow / aimed shot. */
  onPick: (pressed: boolean) => void;
  onCancel: () => void;
}

const WORDING: Record<AttackKind, { plain: string; approach: string; pressed: string; hint: string }> = {
  melee: {
    plain: 'Attack',
    approach: 'Charge',
    pressed: 'Power blow',
    hint: 'Two actions behind one swing — the defender fights it at −1.',
  },
  ranged: {
    plain: 'Shoot',
    approach: 'Move and shoot',
    pressed: 'Aimed shot',
    hint: 'Two actions steadying one shot — the target defends it at −1.',
  },
};

/** "2 actions (1 left)" — the whole price, and what it leaves for afterwards. */
export function cost(plan: ActionPlan, actionsRemaining: number): string {
  const left = actionsRemaining - plan.cost;
  const spent = `${plan.cost} action${plan.cost === 1 ? '' : 's'}`;
  return left > 0 ? `${spent} · ${left} left` : spent;
}

/**
 * The little menu that opens when a unit with two actions in hand picks a
 * target: swing (or shoot) twice, or spend both actions on one pressed blow.
 * It only ever offers what the caller says the engine allows.
 */
export function AttackMenu({ choice, onPick, onCancel }: Props): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const words = WORDING[choice.kind];
  // A blow that has to be walked to costs more than the blow itself, so the
  // price comes from the plan rather than from the weapon.
  const approach = choice.plain.waypoints.length > 0;

  // Escape cancels; so does a click anywhere outside the menu.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    const onPointerDown = (e: PointerEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    // Capture, so the board's own pointer handling doesn't swallow it first.
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [onCancel]);

  // The menu hangs upward from `top` (see the transform in the stylesheet), so
  // how much room it needs depends on how tall its labels wrapped — measure it
  // rather than guess, and drop it below the click when it won't fit above.
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => setHeight(ref.current?.offsetHeight ?? 0), [choice]);

  const MARGIN = 12;
  const left = Math.min(Math.max(choice.at.x, 120), window.innerWidth - 120);
  const above = choice.at.y - MARGIN;
  const top =
    height > 0 && above - height < MARGIN
      ? Math.min(choice.at.y + MARGIN + height, window.innerHeight - MARGIN)
      : Math.max(above, height + MARGIN);

  return (
    <div
      ref={ref}
      className="attack-menu"
      // Hidden for the one frame before it has been measured, so it never
      // flashes in the wrong place.
      style={{ left, top, visibility: height > 0 ? 'visible' : 'hidden' }}
      role="menu"
    >
      <div className="attack-menu-title">{choice.targetName}</div>
      <button type="button" className="primary" onClick={() => onPick(false)}>
        {approach ? words.approach : words.plain}{' '}
        <span className="ap">{cost(choice.plain, choice.actionsRemaining)}</span>
      </button>
      <button type="button" className="primary pressed" onClick={() => onPick(true)}>
        {approach ? `${words.approach}, ${words.pressed.toLowerCase()}` : words.pressed}{' '}
        <span className="ap">{cost(choice.pressed, choice.actionsRemaining)}</span>
      </button>
      <div className="attack-menu-hint">{words.hint}</div>
      <button type="button" className="ghost" onClick={onCancel}>
        Cancel <kbd>Esc</kbd>
      </button>
    </div>
  );
}
