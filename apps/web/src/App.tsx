import { useEffect, useRef, useState } from 'react';
import { GameScreen } from './ui/GameScreen.js';
import { SetupScreen } from './ui/SetupScreen.js';
import { DEFAULT_SETUP } from '@fansong/content';
import type { Launch } from './game/launch.js';
import { LocalMatchClient, type MatchClient } from './game/client.js';
import { connectOnline } from './net/server.js';

/** A launch is keyed by a monotonic id so starting a new match remounts cleanly. */
interface ActiveLaunch {
  id: number;
  launch: Launch;
}

export function App(): JSX.Element {
  const [active, setActive] = useState<ActiveLaunch | null>(null);

  if (!active) {
    return (
      <SetupScreen
        initial={DEFAULT_SETUP}
        onStart={(launch) => setActive({ id: Date.now(), launch })}
      />
    );
  }

  return <MatchHost key={active.id} launch={active.launch} onExit={() => setActive(null)} />;
}

/**
 * Builds the right {@link MatchClient} for a launch and mounts the game screen.
 * Local matches are ready synchronously; online matches matchmake and connect
 * first, showing a lobby state until the socket is up (the in-game HUD then
 * shows "waiting for opponent" until the second player arrives).
 */
function MatchHost({ launch, onExit }: { launch: Launch; onExit: () => void }): JSX.Element {
  const [client, setClient] = useState<MatchClient | null>(null);
  const [error, setError] = useState<string | null>(null);
  const clientRef = useRef<MatchClient | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (launch.kind === 'local') {
      const c = new LocalMatchClient(launch.setup);
      clientRef.current = c;
      setClient(c);
    } else {
      connectOnline({ mode: 'pvp', presets: launch.presets, seed: launch.seed })
        .then((c) => {
          if (cancelled) {
            c.dispose();
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
  return <GameScreen client={client} onExit={onExit} />;
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
