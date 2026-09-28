import { TOGGLE_TRAITS, TRAIT_INFO, traitsOf, type ToggleTrait } from './armyView.js';

/**
 * A unit's on/off traits as removable chips, plus a menu to add one it lacks.
 * There are too many traits for a tick box each; a unit usually has two or three.
 */
export function TraitEditor({
  traits,
  onToggle,
}: {
  traits: Partial<Record<ToggleTrait, boolean>>;
  onToggle: (trait: ToggleTrait, on: boolean) => void;
}): JSX.Element {
  const has = traitsOf(traits);
  const missing = TOGGLE_TRAITS.filter((t) => !traits[t]);
  return (
    <div className="trait-editor">
      {has.map((t) => (
        <span key={t} className="trait-chip" title={TRAIT_INFO[t].title}>
          {TRAIT_INFO[t].label}
          <button type="button" aria-label={`Remove ${TRAIT_INFO[t].label}`} title={`Remove ${TRAIT_INFO[t].label}`} onClick={() => onToggle(t, false)}>
            ×
          </button>
        </span>
      ))}
      {missing.length > 0 ? (
        <select
          className="trait-add"
          value=""
          aria-label="Add a trait"
          onChange={(e) => {
            if (e.target.value) onToggle(e.target.value as ToggleTrait, true);
          }}
        >
          <option value="">+ Trait</option>
          {missing.map((t) => (
            <option key={t} value={t} title={TRAIT_INFO[t].title}>
              {TRAIT_INFO[t].label}
              {t === 'slow' && traits.fast ? ' (replaces Fast)' : ''}
              {t === 'fast' && traits.slow ? ' (replaces Slow)' : ''}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  );
}
