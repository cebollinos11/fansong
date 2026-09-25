import { useEffect, useState } from 'react';
import type { GameState, Replay } from '@fansong/engine';
import { GameScreen } from './ui/GameScreen.js';
import { SetupScreen } from './ui/SetupScreen.js';
import { ReplayScreen } from './ui/ReplayScreen.js';
import { EditorScreen } from './ui/EditorScreen.js';
import { ArmyBuilderScreen } from './ui/ArmyBuilderScreen.js';
import { LobbyScreen } from './ui/LobbyScreen.js';
import { createMatchFromPresets, DEFAULT_BOARD, DEFAULT_SETUP, type MatchSetup } from '@fansong/content';
import { SandboxScreen } from './ui/SandboxScreen.js';
import { loadAutosave } from './game/sandboxStore.js';
import type { Launch } from './game/launch.js';
import { LocalMatchClient, type MatchClient } from './game/client.js';
import type { OnlineRoom, RoomView } from './game/OnlineRoom.js';
import { createRoom, joinRoom, takeRoomFromUrl } from './net/server.js';
import { browserStorage, customMapLookup } from './game/customMaps.js';

/** Which screen the app is showing. A match is keyed so a new one remounts cleanly. */
type View =
  | { kind: 'setup' }
  | { kind: 'editor' }
  | { kind: 'armies' }
  | { kind: 'match'; id: number; launch: Launch }
  | { kind: 'replay'; id: number; replay: Replay }
  | { kind: 'sandbox'; id: number; initial: GameState; setup: MatchSetup };

export function App(): JSX.Element {
  const [view, setView] = useState<View>(() => {
    const sandbox = sandboxFromUrl();
    if (sandbox) return sandbox;
    const launch = inviteLaunch();
    return launch ? { kind: 'match', id: Date.now(), launch } : { kind: 'setup' };
  });

  if (view.kind === 'setup') {
    return (
      <SetupScreen
        initial={DEFAULT_SETUP}
        onStart={(launch) => setView({ kind: 'match', id: Date.now(), launch })}
        onLoadReplay={(replay) => setView({ kind: 'replay', id: Date.now(), replay })}
        onOpenEditor={() => setView({ kind: 'editor' })}
        onOpenArmies={() => setView({ kind: 'armies' })}
        onOpenSandbox={
          devTools()
            ? (setup) => setView({ kind: 'sandbox', id: Date.now(), initial: sandboxStart(setup), setup })
            : undefined
        }
      />
    );
  }

  if (view.kind === 'armies') {
    return <ArmyBuilderScreen onExit={() => setView({ kind: 'setup' })} />;
  }

  if (view.kind === 'editor') {
    return <EditorScreen onExit={() => setView({ kind: 'setup' })} />;
  }

  if (view.kind === 'sandbox') {
    return <SandboxScreen key={view.id} initial={view.initial} setup={view.setup} onExit={() => setView({ kind: 'setup' })} />;
  }

  if (view.kind === 'replay') {
    return <ReplayScreen key={view.id} replay={view.replay} onExit={() => setView({ kind: 'setup' })} />;
  }

  const exit = () => setView({ kind: 'setup' });
  const watch = (replay: Replay) => setView({ kind: 'replay', id: Date.now(), replay });
  return view.launch.kind === 'local' ? (
    <MatchHost key={view.id} setup={view.launch.setup} onExit={exit} onWatchReplay={watch} />
  ) : (
    <RoomHost key={view.id} launch={view.launch} onExit={exit} onWatchReplay={watch} />
  );
}

/** Mounts a local match: built and played in-process, ready at once. */
function MatchHost({
  setup,
  onExit,
  onWatchReplay,
}: {
  setup: MatchSetup;
  onExit: () => void;
  onWatchReplay: (replay: Replay) => void;
}): JSX.Element {
  const [client, setClient] = useState<MatchClient | null>(null);

  useEffect(() => {
    const c = new LocalMatchClient(setup, customMapLookup(browserStorage()));
    setClient(c);
    return () => c.dispose();
  }, [setup]);

  if (!client) return <></>;
  return <GameScreen client={client} onExit={onExit} onWatchReplay={onWatchReplay} />;
}

/**
 * An online room: creates one (or takes the code to join), opens its socket, and
 * shows whatever the room is doing — the lobby between games, or the game.
 */
function RoomHost({
  launch,
  onExit,
  onWatchReplay,
}: {
  launch: Extract<Launch, { kind: 'online' }>;
  onExit: () => void;
  onWatchReplay: (replay: Replay) => void;
}): JSX.Element {
  const [room, setRoom] = useState<OnlineRoom | null>(null);
  const [view, setView] = useState<RoomView>({ phase: 'connecting' });
  const [error, setError] = useState<string | null>(null);
  // This player's army pick, kept across the room's games.
  const [choice, setChoice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let opened: OnlineRoom | null = null;
    roomCode(launch)
      .then((code) => {
        if (cancelled) return;
        opened = joinRoom(code);
        opened.onView(setView);
        setView(opened.view());
        setRoom(opened);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
      opened?.dispose();
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
  if (!room || view.phase === 'connecting') {
    return (
      <Lobby onExit={onExit}>
        <p>{launch.code ? `Joining room ${launch.code}…` : 'Creating a room…'}</p>
      </Lobby>
    );
  }
  if (view.phase === 'closed') {
    return (
      <Lobby onExit={onExit}>
        <p className="error">{view.reason}</p>
      </Lobby>
    );
  }
  if (view.phase === 'lobby') {
    return (
      <LobbyScreen
        room={room}
        seat={view.seat}
        lobby={view.lobby}
        choice={choice}
        onChoice={setChoice}
        onLeave={onExit}
      />
    );
  }
  return (
    <GameScreen
      key={view.game}
      client={view.client}
      onExit={onExit}
      onWatchReplay={onWatchReplay}
      onRematch={() => room.rematch()}
    />
  );
}

/**
 * The code of the room to join: the launch's own, or a freshly created one.
 * React's StrictMode runs the connect effect twice in development; both runs
 * share one creation request so it doesn't open two rooms.
 */
const createdRooms = new WeakMap<Launch, Promise<string>>();
function roomCode(launch: Extract<Launch, { kind: 'online' }>): Promise<string> {
  if (launch.code) return Promise.resolve(launch.code);
  let request = createdRooms.get(launch);
  if (!request) {
    request = createRoom();
    createdRooms.set(launch, request);
  }
  return request;
}

/** A `?room=CODE` invite link opens the app straight into that room (read once). */
let invite: { code: string | null } | null = null;
function inviteLaunch(): Launch | null {
  invite ??= { code: takeRoomFromUrl() };
  return invite.code ? { kind: 'online', code: invite.code } : null;
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

/** A sandbox starts from a setup's deployment (or the default one if that won't build). */
function sandboxStart(setup: MatchSetup): GameState {
  const lookup = customMapLookup(browserStorage());
  try {
    return createMatchFromPresets(setup, DEFAULT_BOARD, lookup);
  } catch {
    return createMatchFromPresets(DEFAULT_SETUP, DEFAULT_BOARD, lookup);
  }
}

/** Dev tools (the sandbox) are on in any build whose URL carries `?dev=1`. */
function devTools(): boolean {
  return new URLSearchParams(window.location.search).get('dev') === '1';
}

/** `?dev=1&sandbox` opens the dev sandbox straight away, resuming its autosave. */
function sandboxFromUrl(): View | null {
  if (!devTools() || !new URLSearchParams(window.location.search).has('sandbox')) return null;
  const initial = loadAutosave(browserStorage()) ?? sandboxStart(DEFAULT_SETUP);
  return { kind: 'sandbox', id: Date.now(), initial, setup: DEFAULT_SETUP };
}
