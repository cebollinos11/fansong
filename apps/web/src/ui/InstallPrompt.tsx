import { dismissInstall, install, useInstallOffer } from './install.js';

/** The main menu's offer to install the game as a home-screen app, until the player answers it. */
export function InstallPrompt(): JSX.Element | null {
  const offer = useInstallOffer();
  if (!offer) return null;
  return (
    <aside className="install" role="dialog" aria-label="Install FanSong">
      <img src={`${import.meta.env.BASE_URL}icons/icon-192.png`} alt="" />
      <div className="install-text">
        <strong>Install FanSong?</strong>
        {offer === 'ios' ? (
          <span>
            Tap <b>Share</b>, then <b>Add to Home Screen</b>.
          </span>
        ) : (
          <span>Play it full screen, like an app.</span>
        )}
      </div>
      {offer === 'prompt' ? (
        <button className="install-yes" onClick={() => void install()}>
          Install
        </button>
      ) : null}
      <button className="install-no" onClick={dismissInstall}>
        {offer === 'ios' ? 'Got it' : 'Not now'}
      </button>
    </aside>
  );
}
