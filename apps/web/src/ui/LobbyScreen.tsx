import { useState } from 'react';
import { DEFAULT_MAP_ID, defaultKing, getMap, PRESET_IDS } from '@fansong/content';
import type { Owner } from '@fansong/engine';
import type { Lobby } from '@fansong/protocol';
import type { OnlineRoom } from '../game/OnlineRoom.js';
import { browserStorage } from '../game/customMaps.js';
import { choiceWarband, playableArmies } from '../game/armies.js';
import { roomLink } from '../net/server.js';
import { MODE_LABELS } from './editorView.js';
import { GameModePicker, MapPicker, modeFor, Roster, sideLabel, WarbandPicker } from './SetupScreen.js';

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
 * An online room between games. Shows the join code to share; each player picks
 * their own army (and King), the host picks the map and mode, and the game
 * starts once both press Ready. Every change goes to the server, which
 * broadcasts the new lobby back to both players.
 */
export function LobbyScreen({ room, seat, lobby, choice, onChoice, onLeave }: Props): JSX.Element {
  const [armies] = useState(() => playableArmies(browserStorage()));
  const me = lobby.seats[seat];
  const them = lobby.seats[seat === 0 ? 1 : 0];
  const host = seat === 0;
  const map = getMap(lobby.mapId) ?? getMap(DEFAULT_MAP_ID)!;
  const kingMode = lobby.mode === 'kill-the-king';
  // Before this player picks anything here, show the preset the server gave them.
  const value = choice ?? (PRESET_IDS.includes(me.preset) ? me.preset : PRESET_IDS[0]!);

  const pickArmy = (next: string): void => {
    const warband = choiceWarband(next, armies);
    if (!warband) return;
    onChoice(next);
    room.setArmy(sideLabel(next), warband, defaultKing(warband.units));
  };

  const status = !them.present
    ? 'Waiting for your friend to join…'
    : them.ready
      ? 'Your opponent is ready.'
      : 'Your opponent is choosing…';

  return (
    <div className="setup">
      <div className="setup-card">
        <h1>FanSong</h1>
        <RoomCode code={room.code} />

        <div className="warband-cols">
          <WarbandPicker
            label={`You${host ? ' (host)' : ''}${me.ready ? ' ✓ Ready' : ''}`}
            value={value}
            armies={armies}
            onChange={pickArmy}
            king={kingMode ? me.king : undefined}
            onKing={(i) => room.setArmy(me.preset, me.warband, i)}
          />
          <div className="warband-picker">
            <h3>Opponent{them.present && them.ready ? ' ✓ Ready' : ''}</h3>
            {them.present ? (
              <>
                <p className="warband-meta">
                  {them.warband.name} · {them.warband.units.length} units
                </p>
                <Roster warband={them.warband} king={kingMode ? them.king : undefined} />
              </>
            ) : (
              <p className="hint">Nobody here yet.</p>
            )}
          </div>
        </div>

        {host ? (
          <>
            <MapPicker
              value={map.id}
              custom={[]}
              online
              onChange={(id) => room.setMap(id, modeFor(getMap(id) ?? map, lobby.mode))}
            />
            <GameModePicker map={map} value={lobby.mode} onChange={(mode) => room.setMap(map.id, mode)} />
          </>
        ) : (
          <div className="map-picker">
            <h3>Map</h3>
            <p>
              {map.name} · {MODE_LABELS[lobby.mode]}
            </p>
            <p className="warband-meta">
              {map.width}×{map.height} · the host picks the map and game mode
            </p>
            {kingMode ? <p className="hint">Pick your King in your roster above.</p> : null}
          </div>
        )}

        <p className="lobby-status">{status}</p>
        {lobby.problem ? <p className="error">Can't start: {lobby.problem}</p> : null}
        <button
          className="primary"
          disabled={lobby.problem !== null}
          onClick={() => room.setReady(!me.ready)}
        >
          {me.ready ? 'Not ready' : 'Ready'}
        </button>
        <button className="ghost" onClick={onLeave}>
          ⟵ Leave room
        </button>
      </div>
    </div>
  );
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
