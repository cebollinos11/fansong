import { useCallback, useRef } from 'react';
import type { MouseEvent } from 'react';

/**
 * Guards a menu that opens under the finger that opened it. The board acts on
 * pointerup, the menu mounts at once, and on touch screens the browser then
 * fires that same tap's compatibility `click` — which lands on whatever button
 * now sits under it. So a click only counts once a press has begun inside the
 * menu itself (or it came from the keyboard, which reports `detail` 0).
 *
 * Spread `onPointerDown` onto the menu's root and wrap each button's handler in `guard`.
 */
export function usePressGuard(): {
  onPointerDown: () => void;
  guard: (act: () => void) => (e: MouseEvent) => void;
} {
  const pressed = useRef(false);
  const onPointerDown = useCallback(() => {
    pressed.current = true;
  }, []);
  const guard = useCallback(
    (act: () => void) => (e: MouseEvent) => {
      if (pressed.current || e.detail === 0) act();
    },
    [],
  );
  return { onPointerDown, guard };
}
