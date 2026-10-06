import { useSyncExternalStore } from 'react';

/**
 * The offline copy of the game and its updates. A built app registers the
 * service worker (`src/pwa/sw.js`), which keeps every file on the device and
 * serves the page from that copy. A newer build downloads in the background and
 * takes over the next time the app is opened; the menu's update check
 * (`ui/UpdateCheck.tsx`) looks for one now and restarts into it.
 */

/**
 * Where the update check stands: no offline copy to update (`off`), nothing
 * asked yet, asking the server, fetching a newer build, a newer build fetched
 * and waiting for a restart, already the newest, or the server out of reach.
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
      if (worker.state === 'installed' || worker.state === 'activated') resolve();
      else if (worker.state === 'redundant') reject(new Error('The update failed to download.'));
    };
    worker.addEventListener('statechange', look);
    look();
  });
}

/** Hands the page over to the waiting build; the reload follows from `controllerchange`. */
function restart(): void {
  const waiting = registration?.waiting;
  if (!waiting) return;
  restarting = true;
  waiting.postMessage('skipWaiting');
}

/** Registers the offline worker. Only a built app has one: the dev server always serves live files. */
export function startOffline(): void {
  if (!import.meta.env.PROD || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (restarting) window.location.reload();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { updateViaCache: 'none' })
      .then((reg) => {
        registration = reg;
        set(reg.waiting ? 'ready' : 'idle');
        // A newer build the browser found by itself: say so once it is fetched.
        reg.addEventListener('updatefound', () => {
          const worker = reg.installing;
          if (!worker || !navigator.serviceWorker.controller) return;
          void installed(worker).then(
            () => state !== 'downloading' && set('ready'),
            () => {},
          );
        });
      })
      .catch(() => {});
  });
}

/** Asks the server for a newer build and, if there is one, fetches it and restarts into it. */
export async function checkForUpdate(): Promise<void> {
  const reg = registration;
  if (!reg || state === 'checking' || state === 'downloading') return;
  if (reg.waiting) return restart();
  // Not every browser fails the check when there is no connection to check over.
  if (!navigator.onLine) return set('failed');
  set('checking');
  try {
    await reg.update();
    const worker = reg.installing;
    if (worker) {
      set('downloading');
      await installed(worker);
    }
    if (reg.waiting) restart();
    else set('latest');
  } catch {
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
