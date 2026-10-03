import { useEffect, useState } from 'react';
import { sfx } from '../audio/sfx.js';

/** The sound board's mute and volume, kept current for the sound controls. */
export function useSoundSettings(): { muted: boolean; volume: number } {
  const read = () => ({ muted: sfx.muted, volume: sfx.volume });
  const [settings, setSettings] = useState(read);
  useEffect(() => sfx.subscribe(() => setSettings(read())), []);
  return settings;
}

/** Give every button in the app a soft press (the board itself has its own sounds). */
export function installButtonSounds(): void {
  document.addEventListener(
    'click',
    (e) => {
      const button = e.target instanceof Element ? e.target.closest('button') : null;
      if (button && !button.disabled) sfx.play('press');
    },
    true,
  );
}
