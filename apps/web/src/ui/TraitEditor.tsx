import type { WarbandUnit } from '@fansong/content';
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { EDITOR_TRAITS, TRAIT_GROUPS, TRAIT_INFO, hasTrait, traitCost, traitReplaced, traitsOf, traitTitle, type TraitKey } from './armyView.js';

/**
 * A unit's traits, Shooter included, as removable chips, plus a menu to add one it lacks.
 * There are too many traits for a tick box each; a unit usually has two or three.
 */
export function TraitEditor({
  unit,
  onToggle,
}: {
  unit: WarbandUnit;
  onToggle: (trait: TraitKey, on: boolean) => void;
}): JSX.Element {
  const has = traitsOf(unit);
  const missing = EDITOR_TRAITS.filter((t) => !hasTrait(unit, t));
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

/** The traits still on offer, under their group headings, narrowed to `needle`. */
function offeredGroups(traits: readonly TraitKey[], needle: string): { label: string; traits: TraitKey[] }[] {
  const offered = new Set(traits);
  // Names like "Woodwise" and "Opportunist" say little, so what a trait does
  // counts as its text too: "forest" finds Woodwise, "push" finds Trample.
  const matches = (t: TraitKey): boolean =>
    needle === '' || `${TRAIT_INFO[t].label} ${TRAIT_INFO[t].desc}`.toLowerCase().includes(needle);
  return TRAIT_GROUPS.map((g) => ({ label: g.label, traits: g.traits.filter((t) => offered.has(t) && matches(t)) })).filter(
    (g) => g.traits.length > 0,
  );
}

/**
 * The "+ Trait" button and its menu: each trait with what it would cost this
 * unit and what it does, under a heading for what the trait is for. There are
 * 27 of them, so typing narrows the list — the keys go to the button, which
 * keeps the focus, and no text box has to steal it. The menu floats over the
 * page (a portal) so a scrolling table cell can't clip it.
 */
function TraitPicker({
  unit,
  traits,
  onPick,
}: {
  unit: WarbandUnit;
  traits: readonly TraitKey[];
  onPick: (trait: TraitKey) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; maxHeight: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const groups = offeredGroups(traits, filter.trim().toLowerCase());
  const flat = groups.flatMap((g) => g.traits);
  // The list shrinks as the filter is typed, so the highlight follows it in.
  const at = Math.min(active, Math.max(0, flat.length - 1));

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
    if (open) menu.current?.querySelector(`[data-index="${at}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, at]);

  const show = (on: boolean): void => {
    setOpen(on);
    setFilter('');
    setActive(0);
  };

  const pick = (t: TraitKey) => {
    show(false);
    onPick(t);
    button.current?.focus();
  };

  const narrow = (next: string): void => {
    setFilter(next);
    setActive(0);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        show(true);
      }
      return;
    }
    if (e.key === 'Escape' || e.key === 'Tab') {
      if (e.key === 'Escape') e.preventDefault();
      // Escape backs out of the filter first, so a mistyped word costs one key.
      if (e.key === 'Escape' && filter !== '') narrow('');
      else show(false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(flat.length === 0 ? 0 : (at + 1) % flat.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(flat.length === 0 ? 0 : (at - 1 + flat.length) % flat.length);
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      setActive(e.key === 'Home' ? 0 : flat.length - 1);
    } else if (e.key === 'Enter' || (e.key === ' ' && filter === '')) {
      e.preventDefault();
      const t = flat[at];
      if (t) pick(t);
    } else if (e.key === 'Backspace') {
      e.preventDefault();
      narrow(filter.slice(0, -1));
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // A space picks the highlighted trait, so it never starts a filter.
      e.preventDefault();
      narrow(filter + e.key);
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
        aria-activedescendant={open ? `${menuId}-${at}` : undefined}
        onClick={() => show(!open)}
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
              <p className="trait-menu-filter" aria-live="polite">
                {filter === '' ? 'Type to narrow the list' : `Showing “${filter}” — ${flat.length} trait${flat.length === 1 ? '' : 's'}`}
              </p>
              {flat.length === 0 ? <p className="trait-menu-empty">No trait matches.</p> : null}
              {groups.map((g) => (
                <section key={g.label} role="group" aria-label={g.label}>
                  <h5>{g.label}</h5>
                  {g.traits.map((t) => {
                    const i = flat.indexOf(t);
                    const cost = traitCost(unit, t);
                    const replaces = traitReplaced(unit, t);
                    return (
                      <div
                        key={t}
                        id={`${menuId}-${i}`}
                        data-index={i}
                        role="option"
                        aria-selected={i === at}
                        className={`trait-option${i === at ? ' active' : ''}`}
                        onPointerEnter={() => setActive(i)}
                        onClick={() => pick(t)}
                      >
                        <span className="trait-option-name">
                          {TRAIT_INFO[t].label}
                          {replaces ? <span className="trait-option-note"> replaces {TRAIT_INFO[replaces].label}</span> : null}
                        </span>
                        <span className={`trait-option-cost${cost < 0 ? ' rebate' : cost === 0 ? ' free' : ''}`}>
                          {cost > 0 ? '+' : cost < 0 ? '−' : '±'}
                          {Math.abs(cost)} pts
                        </span>
                        <span className="trait-option-desc">{TRAIT_INFO[t].desc}</span>
                      </div>
                    );
                  })}
                </section>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
