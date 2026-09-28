import type { WarbandUnit } from '@fansong/content';
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { TOGGLE_TRAITS, TRAIT_INFO, traitCost, traitsOf, traitTitle, type ToggleTrait } from './armyView.js';

/**
 * A unit's on/off traits as removable chips, plus a menu to add one it lacks.
 * There are too many traits for a tick box each; a unit usually has two or three.
 */
export function TraitEditor({
  unit,
  onToggle,
}: {
  unit: WarbandUnit;
  onToggle: (trait: ToggleTrait, on: boolean) => void;
}): JSX.Element {
  const has = traitsOf(unit);
  const missing = TOGGLE_TRAITS.filter((t) => !unit[t]);
  return (
    <div className="trait-editor">
      {has.map((t) => (
        <span key={t} className="trait-chip" title={traitTitle(t)}>
          {TRAIT_INFO[t].label}
          <button type="button" aria-label={`Remove ${TRAIT_INFO[t].label}`} title={`Remove ${TRAIT_INFO[t].label}`} onClick={() => onToggle(t, false)}>
            ×
          </button>
        </span>
      ))}
      {missing.length > 0 ? <TraitPicker unit={unit} traits={missing} onPick={(t) => onToggle(t, true)} /> : null}
    </div>
  );
}

/** Room the menu wants below its button before it opens upward instead. */
const MENU_MAX_HEIGHT = 360;

/**
 * The "+ Trait" button and its menu: each trait with what it would cost this
 * unit and what it does. The menu floats over the page (a portal) so a
 * scrolling table cell can't clip it.
 */
function TraitPicker({
  unit,
  traits,
  onPick,
}: {
  unit: WarbandUnit;
  traits: readonly ToggleTrait[];
  onPick: (trait: ToggleTrait) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; maxHeight: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();

  // Place the menu under the button, or over it when there's more room above.
  useLayoutEffect(() => {
    if (!open || !button.current) return;
    const r = button.current.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 8;
    const above = r.top - 8;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - 328));
    setPos(
      below >= Math.min(MENU_MAX_HEIGHT, above)
        ? { left, top: r.bottom + 4, maxHeight: Math.min(MENU_MAX_HEIGHT, below) }
        : { left, bottom: window.innerHeight - r.top + 4, maxHeight: Math.min(MENU_MAX_HEIGHT, above) },
    );
  }, [open]);

  // Close on a click elsewhere, or when the page scrolls or resizes under it.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!menu.current?.contains(target) && !button.current?.contains(target)) setOpen(false);
    };
    const onMove = (e: Event) => {
      if (!menu.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open]);

  // Keep the highlighted option in view while arrowing through the list.
  useEffect(() => {
    if (open) menu.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const pick = (t: ToggleTrait) => {
    setOpen(false);
    onPick(t);
    button.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setActive(0);
        setOpen(true);
      }
      return;
    }
    if (e.key === 'Escape' || e.key === 'Tab') {
      if (e.key === 'Escape') e.preventDefault();
      setOpen(false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % traits.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i - 1 + traits.length) % traits.length);
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      setActive(e.key === 'Home' ? 0 : traits.length - 1);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const t = traits[active];
      if (t) pick(t);
    }
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        className="trait-add"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-activedescendant={open ? `${menuId}-${active}` : undefined}
        onClick={() => {
          setActive(0);
          setOpen((o) => !o);
        }}
        onKeyDown={onKeyDown}
      >
        + Trait
      </button>
      {open && pos
        ? createPortal(
            <div
              ref={menu}
              id={menuId}
              className="trait-menu"
              role="listbox"
              aria-label="Add a trait"
              style={{ left: pos.left, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxHeight }}
            >
              {traits.map((t, i) => {
                const cost = traitCost(unit, t);
                const replaces = t === 'slow' && unit.fast ? 'Fast' : t === 'fast' && unit.slow ? 'Slow' : null;
                return (
                  <div
                    key={t}
                    id={`${menuId}-${i}`}
                    data-index={i}
                    role="option"
                    aria-selected={i === active}
                    className={`trait-option${i === active ? ' active' : ''}`}
                    onPointerEnter={() => setActive(i)}
                    onClick={() => pick(t)}
                  >
                    <span className="trait-option-name">
                      {TRAIT_INFO[t].label}
                      {replaces ? <span className="trait-option-note"> replaces {replaces}</span> : null}
                    </span>
                    <span className={`trait-option-cost${cost < 0 ? ' rebate' : ''}`}>
                      {cost > 0 ? '+' : cost < 0 ? '−' : '±'}
                      {Math.abs(cost)} pts
                    </span>
                    <span className="trait-option-desc">{TRAIT_INFO[t].desc}</span>
                  </div>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
