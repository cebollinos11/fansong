import { describe, expect, it } from 'vitest';
import { chooseCommand } from '@fansong/ai';
import { parseServerMessage, type Lobby, type ServerMessage } from '@fansong/protocol';
import { defaultKing, getMap, getPreset, type MapDef, type Warband } from '@fansong/content';
import { lobbySetup, newRoomSnapshot, RoomEngine, setupError, type RoomConnection } from '../src/room.js';

/** A fake socket that records the (parsed) server frames it was sent. */
class FakeConn implements RoomConnection {
  readonly received: ServerMessage[] = [];
  constructor(readonly id: string) {}
  send(frame: string): void {
    this.received.push(parseServerMessage(frame));
  }
  last(): ServerMessage {
    return this.received[this.received.length - 1]!;
  }
  clear(): void {
    this.received.length = 0;
  }
  /** The latest lobby this connection was shown. */
  lobby(): Lobby {
    for (let i = this.received.length - 1; i >= 0; i--) {
      const m = this.received[i]!;
      if (m.t === 'lobby') return m.lobby;
    }
    throw new Error('no lobby received');
  }
}

function msg(room: RoomEngine, conn: FakeConn, body: object): void {
  room.onMessage(conn, JSON.stringify(body));
}

function join(room: RoomEngine, conn: FakeConn): void {
  room.onConnect(conn);
  msg(room, conn, { t: 'join' });
}

function send(room: RoomEngine, conn: FakeConn, command: unknown): void {
  msg(room, conn, { t: 'command', command });
}

function expectError(conn: FakeConn, code: string): void {
  const m = conn.last();
  expect(m.t === 'error' && m.code).toBe(code);
}

/** A room with host and guest seated and a started game (seed 7). */
function startedRoom(): { room: RoomEngine; host: FakeConn; guest: FakeConn } {
  const room = new RoomEngine(undefined, () => 7);
  const host = new FakeConn('host');
  const guest = new FakeConn('guest');
  join(room, host);
  join(room, guest);
  msg(room, host, { t: 'ready', ready: true });
  msg(room, guest, { t: 'ready', ready: true });
  return { room, host, guest };
}

/** Drive both seats with the heuristic AI until the game ends. */
function playOut(room: RoomEngine, conns: [FakeConn, FakeConn]): void {
  let guard = 0;
  while (room.getState()!.phase !== 'gameOver') {
    const state = room.getState()!;
    send(room, conns[state.active], chooseCommand(state));
    if (++guard > 5000) throw new Error('game did not terminate');
  }
}

describe('RoomEngine — seats', () => {
  it('seats the first joiner as host (0) and the second as guest (1), then refuses a third', () => {
    const room = new RoomEngine();
    const a = new FakeConn('a');
    const b = new FakeConn('b');
    const c = new FakeConn('c');
    join(room, a);
    expect(a.last()).toMatchObject({ t: 'lobby', seat: 0 });
    expect(a.lobby().seats.map((s) => s.present)).toEqual([true, false]);
    join(room, b);
    expect(b.last()).toMatchObject({ t: 'lobby', seat: 1 });
    // The host hears about the guest arriving.
    expect(a.lobby().seats.map((s) => s.present)).toEqual([true, true]);
    join(room, c);
    expectError(c, 'room_full');
  });

  it('frees a seat on disconnect, so the player can come back with the code', () => {
    const room = new RoomEngine();
    const a = new FakeConn('a');
    const b = new FakeConn('b');
    join(room, a);
    join(room, b);
    room.onDisconnect(b);
    expect(a.lobby().seats[1].present).toBe(false);
    const b2 = new FakeConn('b2');
    join(room, b2);
    expect(b2.last()).toMatchObject({ t: 'lobby', seat: 1 });
  });

  it('asks an unseated connection to join first, and rejects malformed frames', () => {
    const room = new RoomEngine();
    const c = new FakeConn('c');
    room.onConnect(c);
    msg(room, c, { t: 'ready', ready: true });
    expectError(c, 'not_joined');
    room.onMessage(c, 'not json at all');
    expectError(c, 'bad_frame');
  });
});

describe('RoomEngine — lobby', () => {
  const HORDE: Warband = {
    name: 'Horde',
    units: Array.from({ length: 9 }, (_, i) => ({ name: `Grunt ${i}`, quality: 2, combat: 6, fast: true, look: 'Marauder' })),
  };

  it('starts with default armies, the default map and annihilation, with no problem', () => {
    const room = new RoomEngine();
    const a = new FakeConn('a');
    join(room, a);
    const lobby = a.lobby();
    expect(lobby).toMatchObject({ mapId: 'open-field', mode: 'annihilation', problem: null });
    expect(lobby.seats[0]).toMatchObject({ preset: 'border-watch-small', ready: false });
    expect(lobby.seats[1]).toMatchObject({ preset: 'restless-dead-small', ready: false });
  });

  it('lets each player bring their own army, broadcast to both', () => {
    const room = new RoomEngine();
    const a = new FakeConn('a');
    const b = new FakeConn('b');
    join(room, a);
    join(room, b);
    msg(room, b, { t: 'setArmy', preset: 'custom', warband: HORDE, king: 3 });
    expect(a.lobby().seats[1]).toMatchObject({ preset: 'custom', warband: HORDE, king: 3 });
    expect(a.lobby().seats[0].preset).toBe('border-watch-small'); // the host's own pick is untouched
  });

  it('only lets the host pick the map and mode, and needs a custom map sent whole', () => {
    const room = new RoomEngine();
    const a = new FakeConn('a');
    const b = new FakeConn('b');
    join(room, a);
    join(room, b);
    msg(room, b, { t: 'setMap', mapId: 'old-forest', mode: 'capture-the-flag' });
    expectError(b, 'not_host');
    msg(room, a, { t: 'setMap', mapId: 'custom-mine', mode: 'annihilation' });
    expectError(a, 'unknown_map');
    msg(room, a, { t: 'setMap', mapId: 'old-forest', mode: 'capture-the-flag' });
    expect(b.lobby()).toMatchObject({ mapId: 'old-forest', mode: 'capture-the-flag', problem: null });
  });

  it("plays the host's custom map, terrain and objectives included", () => {
    const base = getMap('old-forest')!;
    const mine: MapDef = { ...base, id: 'my-forest', name: 'My Forest', hexes: base.hexes.map((h, i) => (i === 0 ? { elevation: 2 } : h)) };
    const room = new RoomEngine(undefined, () => 7);
    const a = new FakeConn('a');
    const b = new FakeConn('b');
    join(room, a);
    join(room, b);
    msg(room, a, { t: 'setMap', mapId: mine.id, map: mine, mode: 'capture-the-flag' });
    expect(b.lobby()).toMatchObject({ mapId: 'my-forest', map: { name: 'My Forest' }, mode: 'capture-the-flag', problem: null });
    // Changing only the mode keeps the custom map the room already holds.
    msg(room, a, { t: 'setMap', mapId: mine.id, mode: 'annihilation' });
    expect(b.lobby()).toMatchObject({ mapId: 'my-forest', map: { name: 'My Forest' }, mode: 'annihilation' });
    msg(room, a, { t: 'ready', ready: true });
    msg(room, b, { t: 'ready', ready: true });
    const state = room.getState()!;
    expect(state.board.width).toBe(mine.width);
    expect(state.board.terrain?.['0,0']).toMatchObject({ elevation: 2 });
    expect(b.last()).toMatchObject({ t: 'welcome', setup: { mapId: 'my-forest' } });
  });

  it('drops the custom map once the host picks a built-in one', () => {
    const mine: MapDef = { ...getMap('old-forest')!, id: 'my-forest' };
    const room = new RoomEngine();
    const a = new FakeConn('a');
    join(room, a);
    msg(room, a, { t: 'setMap', mapId: mine.id, map: mine, mode: 'annihilation' });
    expect(a.lobby().map?.id).toBe('my-forest');
    msg(room, a, { t: 'setMap', mapId: 'open-field', mode: 'annihilation' });
    expect(a.lobby().map).toBeUndefined();
    msg(room, a, { t: 'setMap', mapId: 'my-forest', mode: 'annihilation' });
    expectError(a, 'unknown_map');
  });

  it('rejects a custom map that is unplayable, mislabelled or shadows a built-in', () => {
    const base = getMap('old-forest')!;
    const room = new RoomEngine();
    const a = new FakeConn('a');
    join(room, a);
    const broken: MapDef = { ...base, id: 'broken', deployZones: [[], []] };
    msg(room, a, { t: 'setMap', mapId: 'broken', map: broken, mode: 'annihilation' });
    expectError(a, 'invalid_map');
    msg(room, a, { t: 'setMap', mapId: 'other', map: { ...base, id: 'mine' }, mode: 'annihilation' });
    expectError(a, 'invalid_map');
    msg(room, a, { t: 'setMap', mapId: 'old-forest', map: base, mode: 'annihilation' });
    expectError(a, 'invalid_map');
    msg(room, a, { t: 'setMap', mapId: 'huge', map: { ...base, id: 'huge', width: 500 }, mode: 'annihilation' });
    expectError(a, 'bad_frame');
    expect(a.lobby().mapId).toBe('open-field');
  });

  it('reports picks that cannot start a match, and does not start on them', () => {
    const room = new RoomEngine();
    const a = new FakeConn('a');
    const b = new FakeConn('b');
    join(room, a);
    join(room, b);
    msg(room, a, { t: 'setArmy', preset: 'custom', warband: { ...HORDE, name: ' ' }, king: 0 });
    expect(a.lobby().problem).not.toBeNull();
    msg(room, a, { t: 'ready', ready: true });
    msg(room, b, { t: 'ready', ready: true });
    expect(room.getState()).toBeNull();
    expect(b.last().t).toBe('lobby');
  });

  it('clears both ready flags when any pick changes', () => {
    const room = new RoomEngine();
    const a = new FakeConn('a');
    const b = new FakeConn('b');
    join(room, a);
    join(room, b);
    msg(room, a, { t: 'ready', ready: true });
    expect(b.lobby().seats[0].ready).toBe(true);
    msg(room, b, { t: 'setArmy', preset: 'custom', warband: HORDE, king: 0 });
    expect(b.lobby().seats.map((s) => s.ready)).toEqual([false, false]);
  });

  it('does not start with only one player, however ready', () => {
    const room = new RoomEngine();
    const a = new FakeConn('a');
    join(room, a);
    msg(room, a, { t: 'ready', ready: true });
    expect(room.getState()).toBeNull();
  });

  it('starts once both are ready, welcoming each seat with the shared setup', () => {
    const { room, host, guest } = startedRoom();
    const w0 = host.last();
    const w1 = guest.last();
    if (w0.t !== 'welcome' || w1.t !== 'welcome') throw new Error('expected welcomes');
    expect(w0.seat).toBe(0);
    expect(w1.seat).toBe(1);
    expect(w0.setup).toEqual(w1.setup);
    expect(w0.setup).toEqual({
      presets: ['border-watch-small', 'restless-dead-small'],
      warbands: [getPreset('border-watch-small'), getPreset('restless-dead-small')],
      seats: ['human', 'human'],
      seed: 7,
    });
    expect(w0.presence).toEqual([true, true]);
    expect(w0.state).toEqual(room.getState());
  });

  it('builds the chosen map, mode, armies and Kings into the game', () => {
    const room = new RoomEngine(undefined, () => 3);
    const a = new FakeConn('a');
    const b = new FakeConn('b');
    join(room, a);
    join(room, b);
    msg(room, a, { t: 'setMap', mapId: 'open-field', mode: 'kill-the-king' });
    msg(room, b, { t: 'setArmy', preset: 'custom', warband: HORDE, king: 4 });
    msg(room, a, { t: 'ready', ready: true });
    msg(room, b, { t: 'ready', ready: true });
    expect(room.setup).toMatchObject({ mode: 'kill-the-king', kings: [defaultKing(getPreset('border-watch-small')!.units), 4] });
    const state = room.getState()!;
    const guestUnits = state.units.filter((u) => u.owner === 1);
    expect(guestUnits).toHaveLength(9);
    expect(state.mode?.kings?.[1]).toBe(guestUnits[4]!.id);
  });

  it('lets the host pick who escorts the golden Pig, and shows both players', () => {
    const room = new RoomEngine(undefined, () => 3);
    const a = new FakeConn('a');
    const b = new FakeConn('b');
    join(room, a);
    join(room, b);
    msg(room, a, { t: 'setMap', mapId: 'old-forest', mode: 'golden-pig' });
    expect(b.lobby()).toMatchObject({ mode: 'golden-pig', problem: null });
    expect(b.lobby().escort).toBeUndefined();
    msg(room, a, { t: 'setMap', mapId: 'old-forest', mode: 'golden-pig', escort: 1 });
    expect(b.lobby().escort).toBe(1);
    msg(room, a, { t: 'ready', ready: true });
    msg(room, b, { t: 'ready', ready: true });
    expect(room.setup).toMatchObject({ mode: 'golden-pig', escort: 1 });
    const state = room.getState()!;
    expect(state.mode?.pig?.escort).toBe(1);
    expect(state.units.find((u) => u.id === state.mode!.pig!.unitId)).toMatchObject({ owner: 1, name: 'Golden Pig' });
    expect(state.limits?.roundLimit).toBeGreaterThan(0);
  });

  it('carries the host\'s round limit and target score from the lobby into the game', () => {
    const room = new RoomEngine(undefined, () => 3);
    const a = new FakeConn('a');
    const b = new FakeConn('b');
    join(room, a);
    join(room, b);
    expect(a.lobby().limits).toBeUndefined();
    msg(room, b, { t: 'setMap', mapId: 'open-field', mode: 'conquest', limits: { roundLimit: 5 } });
    expectError(b, 'not_host');
    msg(room, a, { t: 'setMap', mapId: 'open-field', mode: 'conquest', limits: { roundLimit: 5, targetScore: 4 } });
    expect(b.lobby().limits).toEqual({ roundLimit: 5, targetScore: 4 });
    msg(room, a, { t: 'ready', ready: true });
    msg(room, b, { t: 'ready', ready: true });
    expect(room.setup).toMatchObject({ mode: 'conquest', limits: { roundLimit: 5, targetScore: 4 } });
    expect(room.getState()!.limits).toEqual({ roundLimit: 5, targetScore: 4 });
    const w = b.last();
    if (w.t !== 'welcome') throw new Error('expected a welcome');
    expect(w.state.limits).toEqual({ roundLimit: 5, targetScore: 4 });
  });

  it('rejects out-of-range limits, and a setMap without limits resets them', () => {
    const room = new RoomEngine();
    const a = new FakeConn('a');
    join(room, a);
    msg(room, a, { t: 'setMap', mapId: 'open-field', mode: 'conquest', limits: { roundLimit: 0 } });
    expectError(a, 'bad_frame');
    msg(room, a, { t: 'setMap', mapId: 'open-field', mode: 'conquest', limits: { targetScore: 51 } });
    expectError(a, 'bad_frame');
    msg(room, a, { t: 'setMap', mapId: 'open-field', mode: 'annihilation', limits: { roundLimit: null } });
    expect(a.lobby().limits).toEqual({ roundLimit: null });
    msg(room, a, { t: 'setMap', mapId: 'open-field', mode: 'annihilation' });
    expect(a.lobby().limits).toBeUndefined();
  });

  it('refuses lobby changes during a game', () => {
    const { room, host } = startedRoom();
    msg(room, host, { t: 'setMap', mapId: 'old-forest', mode: 'annihilation' });
    expectError(host, 'not_in_lobby');
    expect(room.setup?.mapId).toBeUndefined();
  });
});

describe('RoomEngine — game', () => {
  it('rejects commands before a game starts', () => {
    const room = new RoomEngine();
    const a = new FakeConn('a');
    join(room, a);
    send(room, a, { type: 'EndActivation' });
    expectError(a, 'no_game');
  });

  it('rejects a command from the seat that is not active, and an illegal one', () => {
    const { room, host, guest } = startedRoom();
    const [active, idle] = room.getState()!.active === 0 ? [host, guest] : [guest, host];
    send(room, idle, chooseCommand(room.getState()!));
    expectError(idle, 'not_your_turn');
    send(room, active, { type: 'EndActivation' }); // illegal in awaitingActivation
    expectError(active, 'illegal_command');
  });

  it('applies a legal command and broadcasts the delta to both seats', () => {
    const { room, host, guest } = startedRoom();
    host.clear();
    guest.clear();
    const state = room.getState()!;
    const command = chooseCommand(state);
    send(room, state.active === 0 ? host : guest, command);
    for (const c of [host, guest]) {
      const d = c.last();
      if (d.t !== 'delta') throw new Error('expected a delta');
      expect(d.by).toBe(state.active);
      expect(d.command).toEqual(command);
      expect(d.state).toEqual(room.getState());
    }
  });

  it('re-welcomes a player who reconnects mid-game, and tells the other', () => {
    const { room, host, guest } = startedRoom();
    room.onDisconnect(guest);
    expect(host.last()).toEqual({ t: 'presence', presence: [true, false] });
    const back = new FakeConn('back');
    join(room, back);
    expect(back.last()).toMatchObject({ t: 'welcome', seat: 1, state: room.getState() });
    expect(host.last()).toEqual({ t: 'presence', presence: [true, true] });
  });

  it('answers a resync with the game state, or the lobby between games', () => {
    const room = new RoomEngine();
    const a = new FakeConn('a');
    join(room, a);
    a.clear();
    msg(room, a, { t: 'resync' });
    expect(a.last().t).toBe('lobby');
    const started = startedRoom();
    msg(started.room, started.host, { t: 'resync' });
    expect(started.host.last()).toEqual({ t: 'sync', state: started.room.getState() });
  });

  it('plays a full game to a decisive finish with both clients seeing the same end', () => {
    const { room, host, guest } = startedRoom();
    playOut(room, [host, guest]);
    const final = room.getState()!;
    expect(final.winner === 0 || final.winner === 1).toBe(true);
    for (const c of [host, guest]) {
      const d = c.last();
      expect(d.t === 'delta' && d.state).toEqual(final);
    }
    expect(host.received.some((m) => m.t === 'error')).toBe(false);
    expect(guest.received.some((m) => m.t === 'error')).toBe(false);
  });

  it('only allows a rematch after the game, returning both to the lobby with picks kept', () => {
    const { room, host, guest } = startedRoom();
    msg(room, host, { t: 'rematch' });
    expectError(host, 'game_not_over');
    playOut(room, [host, guest]);
    msg(room, guest, { t: 'rematch' });
    expect(room.getState()).toBeNull();
    for (const c of [host, guest]) {
      expect(c.last().t).toBe('lobby');
      expect(c.lobby().seats.map((s) => s.ready)).toEqual([false, false]);
      expect(c.lobby().seats[0].preset).toBe('border-watch-small');
    }
  });
});

describe('RoomEngine — persistence', () => {
  it('resumes a lobby and a game from its snapshot', () => {
    const { room } = startedRoom();
    const resumed = new RoomEngine(structuredClone(room.snapshot()));
    const c = new FakeConn('c');
    join(resumed, c);
    expect(c.last()).toMatchObject({ t: 'welcome', seat: 0, state: room.getState() });
  });

  it('lobbySetup and setupError agree with the default room', () => {
    const setup = lobbySetup(newRoomSnapshot(), 1);
    expect(setupError(setup)).toBeNull();
    expect(setupError({ ...setup, mapId: 'no-such-map' })).toMatch(/unknown map/);
  });
});
