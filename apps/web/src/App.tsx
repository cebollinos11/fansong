import { useEffect, useRef, useState } from 'react';
import type { Replay } from '@fansong/engine';
import { GameScreen } from './ui/GameScreen.js';
import { SetupScreen } from './ui/SetupScreen.js';
import { ReplayScreen } from './ui/ReplayScreen.js';
import { EditorScreen } from './ui/EditorScreen.js';
import { ArmyBuilderScreen } from './ui/ArmyBuilderScreen.js';
import { DEFAULT_SETUP } from '@fansong/content';
import type { Launch } from './game/launch.js';
import { LocalMatchClient, type MatchClient } from './game/client.js';
import { connectOnline } from './net/server.js';
import { browserStorage, customMapLookup } from './game/customMaps.js';

/** Which screen the app is showing. A match is keyed so a new one remounts cleanly. */
type View =
  | { kind: 'setup' }
  | { kind: 'editor' }
  | { kind: 'armies' }
  | { kind: 'match'; id: number; launch: Launch }
  | { kind: 'replay'; id: number; replay: Replay };

export function App(): JSX.Element {
  const [view, setView] = useState<View>({ kind: 'setup' });

  if (view.kind === 'setup') {
    return (
      <SetupScreen
        initial={DEFAULT_SETUP}
        onStart={(launch) => setView({ kind: 'match', id: Date.now(), launch })}
        onLoadReplay={(replay) => setView({ kind: 'replay', id: Date.now(), replay })}
        onOpenEditor={() => setView({ kind: 'editor' })}
        onOpenArmies={() => setView({ kind: 'armies' })}
      />
    );
  }

  if (view.kind === 'armies') {
    return <ArmyBuilderScreen onExit={() => setView({ kind: 'setup' })} />;
  }

  if (view.kind === 'editor') {
    return <EditorScreen onExit={() => setView({ kind: 'setup' })} />;
  }

  if (view.kind === 'replay') {
    return <ReplayScreen key={view.id} replay={view.replay} onExit={() => setView({ kind: 'setup' })} />;
  }

  return (
    <MatchHost
      key={view.id}
      launch={view.launch}
      onExit={() => setView({ kind: 'setup' })}
      onWatchReplay={(replay) => setView({ kind: 'replay', id: Date.now(), replay })}
    />
  );
}

/**
 * Builds the right {@link MatchClient} for a launch and mounts the game screen.
 * Local matches are ready synchronously; online matches matchmake and connect
 * first, showing a lobby state until the socket is up (the in-game HUD then
 * shows "waiting for opponent" until the second player arrives).
 */
function MatchHost({
  launch,
  onExit,
  onWatchReplay,
}: {
  launch: Launch;
  onExit: () => void;
  onWatchReplay: (replay: Replay) => void;
}): JSX.Element {
  const [client, setClient] = useState<MatchClient | null>(null);
  const [error, setError] = useState<string | null>(null);
  const clientRef = useRef<MatchClient | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (launch.kind === 'local') {
      const c = new LocalMatchClient(launch.setup, customMapLookup(browserStorage()));
      clientRef.current = c;
      setClient(c);
    } else {
      const request = onlineRequest(launch);
      request.users++;
      request.promise
        .then((c) => {
          if (cancelled) {
            if (request.users === 0) c.dispose();
            return;
          }
          clientRef.current = c;
          setClient(c);
        })
        .catch((e: unknown) => {
          if (!cancelled) setError(e instanceof Error ? e.message : String(e));
        });
    }

    return () => {
      cancelled = true;
      if (launch.kind === 'online') onlineRequest(launch).users--;
      clientRef.current?.dispose();
      clientRef.current = null;
    };
  }, [launch]);

  if (error) {
    return (
      <Lobby onExit={onExit}>
        <p className="error">Couldn't reach the game server.</p>
        <p className="hint">{error}</p>
      </Lobby>
    );
  }
  if (!client) {
    return (
      <Lobby onExit={onExit}>
        <p>Finding a match…</p>
      </Lobby>
    );
  }
  return <GameScreen client={client} onExit={onExit} onWatchReplay={onWatchReplay} />;
}

/** One matchmaking request per online launch, and how many mounted hosts await it. */
interface OnlineRequest {
  promise: Promise<MatchClient>;
  users: number;
}
const onlineRequests = new WeakMap<Launch, OnlineRequest>();

/**
 * The (shared) matchmaking request for a launch. React's StrictMode runs the
 * connect effect twice in development; a second request would queue this
 * player again and pair them with their own first one, so both runs share it.
 */
function onlineRequest(launch: Extract<Launch, { kind: 'online' }>): OnlineRequest {
  let request = onlineRequests.get(launch);
  if (!request) {
    const { presets, warbands, seed, mapId, gameMode, kings } = launch;
    request = { promise: connectOnline({ mode: 'pvp', presets, warbands, seed, mapId, gameMode, kings }), users: 0 };
    onlineRequests.set(launch, request);
  }
  return request;
}

function Lobby({ children, onExit }: { children: React.ReactNode; onExit: () => void }): JSX.Element {
  return (
    <div className="setup">
      <div className="setup-card">
        <h1>FanSong</h1>
        {children}
        <button className="ghost" onClick={onExit}>
          ⟵ Back
        </button>
      </div>
    </div>
  );
}
