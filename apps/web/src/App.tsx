import { useEffect, useState } from 'react';
import type { GameState, Replay } from '@fansong/engine';
import { GameScreen } from './ui/GameScreen.js';
import { MenuScreen } from './ui/MenuScreen.js';
import { SetupScreen, type Mode } from './ui/SetupScreen.js';
import { ReplayScreen } from './ui/ReplayScreen.js';
import { EditorScreen } from './ui/EditorScreen.js';
import { ArmyBuilderScreen } from './ui/ArmyBuilderScreen.js';
import { LobbyScreen } from './ui/LobbyScreen.js';
import {
  createMatchFromPresets,
  DEFAULT_BOARD,
  DEFAULT_SETUP,
  newRun,
  runBattleConfig,
  runMapLookup,
  runMatchSetup,
  runStep,
  type MatchSetup,
  type RunAction,
  type RunState,
} from '@fansong/content';
import { RunScreen } from './ui/RunScreen.js';
import { freshRunSeed, RUN_LEAVE_DETAIL } from './ui/runView.js';
import { addRunRecord, clearRun, loadRunRecords, pastWarbands, runRecord, saveRun, type RunRecord } from './game/runStore.js';
import { SandboxScreen } from './ui/SandboxScreen.js';
import { PresetEditorScreen } from './ui/PresetEditorScreen.js';
import { RecordScreen } from './ui/RecordScreen.js';
import { loadAutosave } from './game/sandboxStore.js';
import { devTools } from './devTools.js';
import type { Launch } from './game/launch.js';
import { LocalMatchClient, type MatchClient } from './game/client.js';
import type { OnlineRoom, RoomView } from './game/OnlineRoom.js';
import { createRoom, joinRoom, takeRoomFromUrl } from './net/server.js';
import { browserStorage, customMapLookup } from './game/customMaps.js';

/** Which screen the app is showing. A match is keyed so a new one remounts cleanly. */
type View =
  | { kind: 'menu' }
  | { kind: 'setup'; mode: Mode }
  | { kind: 'editor' }
  | { kind: 'armies' }
  | { kind: 'presets' }
  | { kind: 'record' }
  | { kind: 'run'; id: number; run: RunState }
  | { kind: 'match'; id: number; launch: Launch }
  | { kind: 'replay'; id: number; replay: Replay }
  | { kind: 'sandbox'; id: number; initial: GameState; setup: MatchSetup };

export function App(): JSX.Element {
  const [view, setView] = useState<View>(() => {
    if (devTools() && new URLSearchParams(window.location.search).has('record')) return { kind: 'record' };
    const sandbox = sandboxFromUrl();
    if (sandbox) return sandbox;
    const launch = inviteLaunch();
    return launch ? { kind: 'match', id: Date.now(), launch } : { kind: 'menu' };
  });

  const toMenu = () => setView({ kind: 'menu' });

  if (view.kind === 'menu') {
    return (
      <MenuScreen
        onPlay={(mode) => setView({ kind: 'setup', mode })}
        onOpenEditor={() => setView({ kind: 'editor' })}
        onOpenArmies={() => setView({ kind: 'armies' })}
        onRun={(run) => setView({ kind: 'run', id: Date.now(), run })}
        onOpenPresets={devTools() ? () => setView({ kind: 'presets' }) : undefined}
      />
    );
  }

  if (view.kind === 'setup') {
    return (
      <SetupScreen
        initial={DEFAULT_SETUP}
        mode={view.mode}
        onStart={(launch) => setView({ kind: 'match', id: Date.now(), launch })}
        onBack={toMenu}
        onOpenSandbox={
          devTools()
            ? (setup) => setView({ kind: 'sandbox', id: Date.now(), initial: sandboxStart(setup), setup })
            : undefined
        }
      />
    );
  }

  if (view.kind === 'armies') {
    return <ArmyBuilderScreen onExit={toMenu} />;
  }

  if (view.kind === 'presets') {
    return <PresetEditorScreen onExit={toMenu} />;
  }

  if (view.kind === 'record') {
    return <RecordScreen onExit={toMenu} />;
  }

  if (view.kind === 'run') {
    return <RunHost key={view.id} initial={view.run} onExit={toMenu} />;
  }

  if (view.kind === 'editor') {
    return <EditorScreen onExit={toMenu} />;
  }

  if (view.kind === 'sandbox') {
    return <SandboxScreen key={view.id} initial={view.initial} setup={view.setup} onExit={toMenu} />;
  }

  if (view.kind === 'replay') {
    return <ReplayScreen key={view.id} replay={view.replay} onExit={toMenu} />;
  }

  const watch = (replay: Replay) => setView({ kind: 'replay', id: Date.now(), replay });
  return view.launch.kind === 'local' ? (
    <MatchHost key={view.id} setup={view.launch.setup} onExit={toMenu} onWatchReplay={watch} />
  ) : (
    <RoomHost key={view.id} launch={view.launch} onExit={toMenu} onWatchReplay={watch} />
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
 * A run: its screens between battles and, in the battle phase, the battle
 * itself as an ordinary local match against the AI. Every step goes through
 * `runStep` and is saved as it is taken, so the run picks up where it was left;
 * a battle left midway is not saved, and starts over from the same setup.
 */
function RunHost({ initial, onExit }: { initial: RunState; onExit: () => void }): JSX.Element {
  const storage = browserStorage();
  const [run, setRun] = useState(initial);
  const [records, setRecords] = useState<RunRecord[]>(() => loadRunRecords(storage));
  const [error, setError] = useState<string | null>(null);

  // A run handed in is the run in progress from here on (a new one is not saved until now).
  useEffect(() => {
    saveRun(storage, initial);
  }, []);

  const adopt = (next: RunState): void => {
    if (next.phase === 'over') {
      // A finished run leaves a record, and nothing to continue.
      setRecords(addRunRecord(storage, runRecord(next, 'lost')));
      clearRun(storage);
    } else {
      saveRun(storage, next);
    }
    setError(null);
    setRun(next);
  };

  const step = (action: RunAction): void => {
    try {
      adopt(runStep(run, action));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // Devtools access outside the battle too: `fansongRun.state()`, `fansongRun.step(action)`.
  useEffect(() => {
    if (!devTools() || run.phase === 'battle') return;
    const w = window as unknown as { fansongRun?: unknown };
    w.fansongRun = { state: () => run, step };
    return () => {
      delete w.fansongRun;
    };
  });

  if (run.phase === 'battle') return <RunBattle key={`${run.round}:${run.retreats ?? 0}`} run={run} onStep={step} onExit={onExit} />;
  return (
    <RunScreen
      run={run}
      records={records}
      error={error}
      onAction={step}
      onExit={onExit}
      onNewRun={() => adopt(newRun(freshRunSeed(), pastWarbands(records)))}
    />
  );
}

/** The battle of a run's battle phase. Its replay, handed back, is what moves the run on. */
function RunBattle({ run, onStep, onExit }: { run: RunState; onStep: (action: RunAction) => void; onExit: () => void }): JSX.Element {
  const [client, setClient] = useState<LocalMatchClient | null>(null);

  // Built once per battle: the run doesn't change while it is being fought.
  useEffect(() => {
    const c = new LocalMatchClient(runMatchSetup(run), runMapLookup(run), runBattleConfig(run));
    setClient(c);
    return () => c.dispose();
  }, []);

  // Devtools access, as the sandbox gives it: `fansongRun.client`, `fansongRun.state()`, `fansongRun.step(action)`.
  useEffect(() => {
    if (!devTools() || !client) return;
    const w = window as unknown as { fansongRun?: unknown };
    w.fansongRun = { client, state: () => run, step: onStep };
    return () => {
      delete w.fansongRun;
    };
  }, [client, run, onStep]);

  if (!client) return <></>;
  const finish = (): void => onStep({ type: 'battleResult', replay: client.getReplay() });
  return (
    <GameScreen
      client={client}
      // A battle that is over has a result, whichever way the player leaves it.
      onExit={() => (client.getState().phase === 'gameOver' ? finish() : onExit())}
      onWatchReplay={() => {}}
      onFinished={finish}
      exit={{ label: 'Leave', title: 'Back to the menu. The run is saved; this battle starts over', detail: RUN_LEAVE_DETAIL }}
    />
  );
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
    <div className="muster muster-plain">
      <header className="muster-top">
        <button type="button" className="muster-back" onClick={onExit}>
          ⟵ Back
        </button>
        <h1>FanSong</h1>
      </header>
      <div className="muster-plain-body">{children}</div>
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

/** `?dev=1&sandbox` opens the dev sandbox straight away, resuming its autosave. */
function sandboxFromUrl(): View | null {
  if (!devTools() || !new URLSearchParams(window.location.search).has('sandbox')) return null;
  const initial = loadAutosave(browserStorage()) ?? sandboxStart(DEFAULT_SETUP);
  return { kind: 'sandbox', id: Date.now(), initial, setup: DEFAULT_SETUP };
}
