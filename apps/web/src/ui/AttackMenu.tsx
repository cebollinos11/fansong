import { useEffect, useRef } from 'react';

/** Which weapon the menu is offering — melee blows or ranged shots. */
export type AttackKind = 'melee' | 'ranged';

export interface AttackChoice {
  targetId: string;
  targetName: string;
  kind: AttackKind;
  /** Where the click landed, in viewport coordinates; the menu opens above it. */
  at: { x: number; y: number };
}

interface Props {
  choice: AttackChoice;
  /** `pressed` = spend two actions for the power blow / aimed shot. */
  onPick: (pressed: boolean) => void;
  onCancel: () => void;
}

const WORDING: Record<AttackKind, { plain: string; pressed: string; hint: string }> = {
  melee: {
    plain: 'Attack',
    pressed: 'Power blow',
    hint: 'Both actions behind one swing — the defender fights it at −1.',
  },
  ranged: {
    plain: 'Shoot',
    pressed: 'Aimed shot',
    hint: 'Both actions steadying one shot — the target defends it at −1.',
  },
};

/**
 * The little menu that opens when a unit with two actions in hand picks a
 * target: swing (or shoot) twice, or spend both actions on one pressed blow.
 * It only ever offers what the caller says the engine allows.
 */
export function AttackMenu({ choice, onPick, onCancel }: Props): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const words = WORDING[choice.kind];

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

  // Keep the menu on screen when the click lands near an edge.
  const left = Math.min(Math.max(choice.at.x, 120), window.innerWidth - 120);
  const top = Math.max(choice.at.y - 12, 140);

  return (
    <div ref={ref} className="attack-menu" style={{ left, top }} role="menu">
      <div className="attack-menu-title">{choice.targetName}</div>
      <button type="button" className="primary" onClick={() => onPick(false)}>
        {words.plain} <span className="ap">1 AP</span>
      </button>
      <button type="button" className="primary pressed" onClick={() => onPick(true)}>
        {words.pressed} <span className="ap">2 AP</span>
      </button>
      <div className="attack-menu-hint">{words.hint}</div>
      <button type="button" className="ghost" onClick={onCancel}>
        Cancel <kbd>Esc</kbd>
      </button>
    </div>
  );
}
