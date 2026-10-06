import { useEffect, useState } from 'react';

// iPadOS Safari before 16.4 only knows the webkit-prefixed Fullscreen API.
interface WebkitDocument {
  webkitFullscreenElement?: Element | null;
  webkitFullscreenEnabled?: boolean;
  webkitExitFullscreen?: () => Promise<void> | void;
}
interface WebkitElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
}

function fullscreenElement(): Element | null {
  return document.fullscreenElement ?? (document as WebkitDocument).webkitFullscreenElement ?? null;
}

/**
 * Whether to offer the fullscreen button: only on a touch-first device (a phone
 * or tablet, where the browser's bars eat the board) whose browser can do it
 * (an iPhone's Safari cannot take a page fullscreen, so it gets no button).
 * The installed app already fills the screen, so it gets none either.
 */
export function canOfferFullscreen(): boolean {
  if (typeof document === 'undefined' || typeof window === 'undefined') return false;
  if (window.matchMedia('(display-mode: fullscreen)').matches) return false;
  const supported = document.fullscreenEnabled || (document as WebkitDocument).webkitFullscreenEnabled === true;
  return supported && window.matchMedia('(pointer: coarse)').matches;
}

/** Takes the whole page fullscreen, or back out of it. */
export function toggleFullscreen(): void {
  const doc = document as Document & WebkitDocument;
  if (fullscreenElement()) {
    void (doc.exitFullscreen?.() ?? doc.webkitExitFullscreen?.())?.catch?.(() => {});
    return;
  }
  const root = document.documentElement as HTMLElement & WebkitElement;
  void (root.requestFullscreen?.({ navigationUI: 'hide' }) ?? root.webkitRequestFullscreen?.())?.catch?.(() => {});
}

/** Whether the page is fullscreen now, kept current as the player enters or leaves it. */
export function useFullscreen(): boolean {
  const [on, setOn] = useState(() => typeof document !== 'undefined' && fullscreenElement() !== null);
  useEffect(() => {
    const sync = (): void => setOn(fullscreenElement() !== null);
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      document.removeEventListener('webkitfullscreenchange', sync);
    };
  }, []);
  return on;
}
