import { useState } from 'react';
import { DEFAULT_MAP_ID, defaultKing, defaultPigRounds, getMap, PRESET_IDS, type MapDef, type Warband } from '@fansong/content';
import type { GameLimits, Owner } from '@fansong/engine';
import type { Lobby, LobbySeat } from '@fansong/protocol';
import type { OnlineRoom } from '../game/OnlineRoom.js';
import { browserStorage, playableCustomMaps } from '../game/customMaps.js';
import { choiceWarband, playableArmies, type SavedArmy } from '../game/armies.js';
import { roomLink } from '../net/server.js';
import { ArmyBuilderOverlay } from './ArmyBuilderScreen.js';
import { builderStart, choiceAfterBuilder } from './armyView.js';
import { FaceOffSetup, type SetupModel } from './FaceOffSetup.js';
import { modeFor, sideLabel } from './SetupScreen.js';
import { limitsForMode, type LimitsByMode } from '../game/limits.js';

interface Props {
  room: OnlineRoom;
  seat: Owner;
  lobby: Lobby;
  /** This player's army pick (a preset id or saved-army choice), kept by the
   *  parent across games; null until they change it here. */
  choice: string | null;
  onChoice: (choice: string) => void;
  onLeave: () => void;
}

/**
 * An online room between games, on the same muster screen a local game is set
 * up on: the two warbands square up, with the join code to share beside the
 * title. You work your own side of it only — your army, your King — the host
 * sets the battlefield and the rules, and the game starts once both press
 * Ready. Every change goes to the server, which broadcasts the new lobby back.
 */
export function LobbyScreen({ room, seat, lobby, choice, onChoice, onLeave }: Props): JSX.Element {
  const [armies, setArmies] = useState(() => playableArmies(browserStorage()));
  const [customMaps] = useState(() => playableCustomMaps(browserStorage()));
  // Whether the army builder is open in front of the room, which stays connected.
  const [builder, setBuilder] = useState(false);
  const seats = lobby.seats;
  const me = seats[seat];
  const them = seats[seat === 0 ? 1 : 0];
  const host = seat === 0;
  const map = lobby.map ?? getMap(lobby.mapId) ?? getMap(DEFAULT_MAP_ID)!;
  const escort: Owner = lobby.escort ?? 0;
  // Before this player picks anything here, show the preset the server gave them.
  const value = choice ?? (PRESET_IDS.includes(me.preset) ? me.preset : PRESET_IDS[0]!);

  // The host's custom limits, remembered per mode so switching modes and back keeps them.
  const [limitsByMode, setLimitsByMode] = useState<LimitsByMode>(() => ({ [lobby.mode]: lobby.limits }));
  const limitsFor = (mode: Lobby['mode']): GameLimits | undefined => limitsForMode(mode, limitsByMode[mode]);

  const pickArmy = (next: string, list: readonly SavedArmy[] = armies): void => {
    const warband = choiceWarband(next, list);
    if (!warband) return;
    onChoice(next);
    room.setArmy(sideLabel(next), warband, defaultKing(warband.units));
  };

  /**
   * The army builder hands control back: take in whatever it saved and tell the
   * room what this player is fielding now. The same army is sent again as a
   * matter of course, since its roster is the likeliest thing to have changed.
   */
  const closeBuilder = (used: string | null): void => {
    setBuilder(false);
    const next = playableArmies(browserStorage());
    setArmies(next);
    pickArmy(choiceAfterBuilder(value, used, next, PRESET_IDS[0]!), next);
  };

  /** Only the host can send the room a map, so only the host is offered custom ones. */
  const offeredMaps = (): readonly MapDef[] => {
    if (!host) return lobby.map ? [lobby.map] : [];
    return lobby.map && !customMaps.some((m) => m.id === lobby.map!.id) ? [...customMaps, lobby.map] : customMaps;
  };

  // Seat 0 stands on the left, as it does in the game; the names say which is yours.
  const sideOf = (owner: Owner): string => (owner === seat ? value : seats[owner].preset);
  const warbandOf = (owner: Owner): Warband =>
    // Your own side follows your pick at once, rather than a round trip later.
    (owner === seat ? choiceWarband(value, armies) : undefined) ?? seats[owner].warband;

  const model: SetupModel = {
    title: 'Online with a friend',
    banner: <RoomCode code={room.code} />,
    names: [host ? 'You (host)' : 'Opponent (host)', host ? 'Opponent' : 'You'],
    notes: [seatNote(seats[0], seat === 0), seatNote(seats[1], seat === 1)],
    sides: [sideOf(0), sideOf(1)],
    warbands: [warbandOf(0), warbandOf(1)],
    armies,
    mine: [seat === 0, seat === 1],
    pickSide: (owner, next) => {
      if (owner === seat) pickArmy(next);
    },
    kings: [seats[0].king, seats[1].king],
    pickKing: (owner, i) => {
      if (owner === seat) room.setArmy(me.preset, me.warband, i);
    },
    openBuilder: (owner) => {
      if (owner === seat) setBuilder(true);
    },
    map,
    customMaps: offeredMaps(),
    pickMap: (id) => {
      // A custom map is sent whole, so the room (and the guest) can play it.
      const custom = getMap(id) ? undefined : customMaps.find((m) => m.id === id);
      const next = getMap(id) ?? custom ?? map;
      const mode = modeFor(next, lobby.mode);
      room.setMap(next.id, mode, limitsFor(mode), custom, escort);
    },
    gameMode: lobby.mode,
    pickMode: (mode) => room.setMap(map.id, mode, limitsFor(mode), undefined, escort),
    escort,
    setEscort: (next) => room.setMap(map.id, lobby.mode, lobby.limits, undefined, next),
    limits: lobby.limits,
    setLimits: (next) => {
      setLimitsByMode((all) => ({ ...all, [lobby.mode]: next }));
      room.setMap(map.id, lobby.mode, next, undefined, escort);
    },
    defaultRounds: lobby.mode === 'golden-pig' ? defaultPigRounds(map, escort) : undefined,
    rulesLocked: host ? undefined : 'The host picks the battlefield, the game mode and how long the game runs.',
    problem: lobby.problem,
    go: {
      label: me.ready ? 'Not ready' : 'Ready',
      onClick: () => room.setReady(!me.ready),
      status: !them.present
        ? 'Waiting for your friend to join…'
        : them.ready
          ? 'Your opponent is ready.'
          : 'Your opponent is choosing…',
    },
    onBack: onLeave,
    backLabel: '⟵ Leave room',
  };

  return (
    <>
      <FaceOffSetup model={model} />
      {builder ? (
        <ArmyBuilderOverlay
          start={builderStart(value)}
          backLabel="⟵ Back to the room"
          onUse={closeBuilder}
          onExit={() => closeBuilder(null)}
        />
      ) : null}
    </>
  );
}

/** How a seat is doing, shown under its warband: empty, still choosing, or ready. */
function seatNote(seat: LobbySeat, yours: boolean): string | null {
  if (!seat.present) return 'Not here yet';
  if (seat.ready) return '✓ Ready';
  return yours ? null : 'Choosing…';
}

/** The room's join code, big, with buttons to copy it or a link straight in. */
function RoomCode({ code }: { code: string }): JSX.Element {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (what: string, text: string): void => {
    navigator.clipboard?.writeText(text).then(
      () => setCopied(what),
      () => setCopied(null),
    );
  };
  return (
    <div className="room-code">
      <span className="room-code-label">Room code</span>
      <span className="room-code-value">{code}</span>
      <div className="room-code-actions">
        <button className="ghost" onClick={() => copy('code', code)}>
          {copied === 'code' ? 'Copied!' : 'Copy code'}
        </button>
        <button className="ghost" onClick={() => copy('link', roomLink(code))}>
          {copied === 'link' ? 'Copied!' : 'Copy invite link'}
        </button>
      </div>
    </div>
  );
}
