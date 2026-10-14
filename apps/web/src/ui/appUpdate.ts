import { useSyncExternalStore } from 'react';
import { PRESETS } from '@fansong/content';
import { loadArmies } from '../game/armies.js';
import { browserStorage } from '../game/customMaps.js';
import { spritesToKeep } from './offlineSprites.js';

/**
 * The offline copy of the game and its updates. A built app registers the
 * service worker (`src/pwa/sw.js`), which keeps every file on the device (the
 * unit art as it is shown, see `offlineSprites.ts`) and serves the page from that copy. A newer build downloads in the background and
 * then serves every later load, so an open page is one reload behind it; the
 * menu's update check (`ui/UpdateCheck.tsx`) looks for one now and reloads into it.
 */

/**
 * Where the update check stands: no offline copy to update (`off`), nothing
 * asked yet, asking the server, fetching a newer build, a newer build fetched
 * and a reload away, already the newest, or the server out of reach.
 */
export type UpdateState = 'off' | 'idle' | 'checking' | 'downloading' | 'ready' | 'latest' | 'failed';

/** What the menu says about an update state, and what its button does (nothing while it works). */
export function updateStatus(state: UpdateState): { text: string; action: 'check' | 'restart' | null } {
  switch (state) {
    case 'off':
    case 'idle':
      return { text: 'Check for updates', action: 'check' };
    case 'checking':
      return { text: 'Checking…', action: null };
    case 'downloading':
      return { text: 'Downloading the update…', action: null };
    case 'ready':
      return { text: 'Update ready: restart', action: 'restart' };
    case 'latest':
      return { text: 'Up to date. Check again', action: 'check' };
    case 'failed':
      return { text: "Couldn't check. Try again", action: 'check' };
  }
}

let state: UpdateState = 'off';
let registration: ServiceWorkerRegistration | null = null;
/** The player asked for the new build, so the page reloads when it takes over. */
let restarting = false;
const listeners = new Set<() => void>();

function set(next: UpdateState): void {
  state = next;
  for (const listener of listeners) listener();
}

/** Resolves once a new worker has every file, or rejects if its download failed. */
function installed(worker: ServiceWorker): Promise<void> {
  return new Promise((resolve, reject) => {
    const look = (): void => {
      if (worker.state === 'installed' || worker.state === 'activating' || worker.state === 'activated') resolve();
      else if (worker.state === 'redundant') reject(new Error('The update failed to download.'));
    };
    worker.addEventListener('statechange', look);
    look();
  });
}

/** Registers the offline worker. Only a built app has one: the dev server always serves live files. */
export function startOffline(): void {
  if (!import.meta.env.PROD || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  // The first worker of all taking charge of this page is no update.
  let controlled = navigator.serviceWorker.controller !== null;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!controlled) controlled = true;
    else if (restarting) window.location.reload();
    else set('ready');
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { updateViaCache: 'none' })
      .then((reg) => {
        registration = reg;
        if (state === 'off') set('idle');
      })
      .catch(() => {});
    // The worker keeps unit art only as it is shown; have it fetch ahead what the player can field.
    void navigator.serviceWorker.ready.then((reg) => {
      const warbands = [...Object.values(PRESETS), ...loadArmies(browserStorage()).map((army) => army.warband)];
      reg.active?.postMessage({ type: 'keep', paths: spritesToKeep(warbands) });
    });
  });
}

/** Asks the server for a newer build and, if there is one, fetches it and reloads into it. */
export async function checkForUpdate(): Promise<void> {
  const reg = registration;
  if (!reg || state === 'checking' || state === 'downloading') return;
  if (state === 'ready') return window.location.reload();
  // Not every browser fails the check when there is no connection to check over.
  if (!navigator.onLine) return set('failed');
  set('checking');
  try {
    await reg.update();
    const worker = reg.installing;
    if (!worker) return set('latest');
    set('downloading');
    restarting = true;
    await installed(worker);
  } catch {
    restarting = false;
    set('failed');
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useUpdateState(): UpdateState {
  return useSyncExternalStore(subscribe, () => state);
}
