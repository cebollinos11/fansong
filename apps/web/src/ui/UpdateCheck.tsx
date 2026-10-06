import { checkForUpdate, updateStatus, useUpdateState } from './appUpdate.js';
import { isInstalled } from './install.js';

/** When this copy of the app was built, as "6 Oct, 05:30" in the player's own time. */
function buildLabel(): string | null {
  if (typeof __BUILD_TIME__ === 'undefined') return null;
  return new Date(__BUILD_TIME__).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/**
 * The main menu's version line: which build this is, and a button to look for a
 * newer one. The installed app always has it; a browser tab shows it only when
 * a newer build is already fetched and a reload away.
 */
export function UpdateCheck(): JSX.Element | null {
  const state = useUpdateState();
  if (state === 'off' || (state !== 'ready' && !isInstalled())) return null;
  const { text, action } = updateStatus(state);
  const built = buildLabel();
  return (
    <p className="menu-version">
      {built ? <span>Version of {built}</span> : null}
      <button disabled={!action} onClick={() => void checkForUpdate()}>
        {text}
      </button>
    </p>
  );
}
