import { useSyncExternalStore } from 'react';

/**
 * Installing the site as a home-screen app (`public/manifest.webmanifest`), which
 * then opens full screen. Chrome, Edge and Samsung's browser hand the page an
 * event whose `prompt()` opens their install dialog; an iPhone or iPad offers
 * nothing of the kind, so there the player is told where "Add to Home Screen" is.
 */

/** How the page can offer to install itself: through the browser's own dialog, by pointing an iOS player at the Share menu, or not at all. */
export type InstallOffer = 'prompt' | 'ios' | null;

interface InstallFacts {
  /** Already running as the installed app. */
  installed: boolean;
  /** The player has turned the offer down before. */
  dismissed: boolean;
  /** The browser has handed over its install dialog. */
  canPrompt: boolean;
  /** An iPhone or iPad, whose browsers install only from the Share menu. */
  ios: boolean;
}

export function installOffer({ installed, dismissed, canPrompt, ios }: InstallFacts): InstallOffer {
  if (installed || dismissed) return null;
  if (canPrompt) return 'prompt';
  return ios ? 'ios' : null;
}

/** Chrome's `beforeinstallprompt` event, which no standard type describes. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<unknown>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISSED_KEY = 'fansong.install.dismissed';

const inBrowser = typeof window !== 'undefined';
let deferred: BeforeInstallPromptEvent | null = null;
let installed = inBrowser && isInstalled();
let dismissed = inBrowser && wasDismissed();
let offer: InstallOffer = currentOffer();
const listeners = new Set<() => void>();

/** Whether the page is running as the installed app rather than in a browser tab. */
export function isInstalled(): boolean {
  if (typeof window === 'undefined') return false;
  const shown = (mode: string): boolean => window.matchMedia(`(display-mode: ${mode})`).matches;
  // iOS says so on `navigator.standalone` instead.
  return shown('fullscreen') || shown('standalone') || (navigator as { standalone?: boolean }).standalone === true;
}

function isIos(): boolean {
  // An iPad's Safari claims to be a Mac, but only an iPad is a Mac with a touch screen.
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) !== null;
  } catch {
    return false;
  }
}

function currentOffer(): InstallOffer {
  if (!inBrowser) return null;
  return installOffer({ installed, dismissed, canPrompt: deferred !== null, ios: isIos() });
}

function refresh(): void {
  offer = currentOffer();
  for (const listener of listeners) listener();
}

// The browser may offer its dialog before React mounts, so listen from the start.
if (inBrowser) {
  window.addEventListener('beforeinstallprompt', (event) => {
    // Keep the browser's own mini-bar away: the menu makes the offer instead.
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    refresh();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installed = true;
    refresh();
  });
}

/** Opens the browser's install dialog. An offer can be used once, so it is gone either way. */
export async function install(): Promise<void> {
  const event = deferred;
  if (!event) return;
  deferred = null;
  refresh();
  try {
    await event.prompt();
    if ((await event.userChoice).outcome === 'dismissed') dismissInstall();
  } catch {
    // The browser refused to show it; nothing more to offer.
  }
}

/** Turns the offer down for good on this device. */
export function dismissInstall(): void {
  dismissed = true;
  try {
    localStorage.setItem(DISMISSED_KEY, '1');
  } catch {
    // Storage is blocked: the offer stays away for this visit only.
  }
  refresh();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** What install offer to show now, kept current as the browser makes one or the player answers it. */
export function useInstallOffer(): InstallOffer {
  return useSyncExternalStore(subscribe, () => offer);
}
