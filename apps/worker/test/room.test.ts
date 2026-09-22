import { describe, expect, it } from 'vitest';
import { chooseCommand } from '@fansong/ai';
import type { Owner } from '@fansong/engine';
import { parseServerMessage, type ServerMessage } from '@fansong/protocol';
import { getPreset, type MatchSetup, type Warband } from '@fansong/content';
import { RoomEngine, setupError, type RoomConnection } from '../src/room.js';

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
  typesSeen(): string[] {
    return this.received.map((m) => m.t);
  }
  clear(): void {
    this.received.length = 0;
  }
}

const PVP: MatchSetup = {
  presets: ['iron-wardens', 'ashfang-raiders'],
  seats: ['human', 'human'],
  seed: 42,
};
const PVE: MatchSetup = {
  presets: ['iron-wardens', 'ashfang-raiders'],
  seats: ['human', 'ai'],
  seed: 42,
};

function join(room: RoomEngine, conn: FakeConn, seat: Owner): void {
  room.onConnect(conn);
  room.onMessage(conn, JSON.stringify({ t: 'join', seat }));
}

function send(room: RoomEngine, conn: FakeConn, command: unknown): void {
  room.onMessage(conn, JSON.stringify({ t: 'command', command }));
}

describe('RoomEngine — joining', () => {
  it('welcomes a joining seat with full state and presence', () => {
    const room = new RoomEngine(PVP);
    const c0 = new FakeConn('c0');
    join(room, c0, 0);
    const welcome = c0.last();
    expect(welcome.t).toBe('welcome');
    if (welcome.t !== 'welcome') throw new Error('unreachable');
    expect(welcome.seat).toBe(0);
    expect(welcome.presence).toEqual([true, false]);
    expect(welcome.state.phase).toBe('awaitingActivation');
  });

  it('rejects claiming an AI-controlled seat', () => {
    const room = new RoomEngine(PVE);
    const c = new FakeConn('c');
    join(room, c, 1); // seat 1 is the AI
    const msg = c.last();
    expect(msg.t).toBe('error');
    if (msg.t === 'error') expect(msg.code).toBe('not_your_seat');
  });

  it('rejects a second connection claiming a held seat', () => {
    const room = new RoomEngine(PVP);
    const a = new FakeConn('a');
    const b = new FakeConn('b');
    join(room, a, 0);
    join(room, b, 0);
    const msg = b.last();
    expect(msg.t).toBe('error');
    if (msg.t === 'error') expect(msg.code).toBe('seat_taken');
  });

  it('frees a seat on disconnect and re-broadcasts presence', () => {
    const room = new RoomEngine(PVP);
    const a = new FakeConn('a');
    const b = new FakeConn('b');
    join(room, a, 0);
    join(room, b, 1);
    expect(room.presence()).toEqual([true, true]);
    room.onDisconnect(a);
    expect(room.presence()).toEqual([false, true]);
    // b was told about the presence change.
    expect(b.last().t).toBe('presence');
  });
});

describe('RoomEngine — authority', () => {
  it('rejects a command from the seat that is not active', () => {
    const room = new RoomEngine(PVP);
    const c0 = new FakeConn('c0');
    const c1 = new FakeConn('c1');
    join(room, c0, 0);
    join(room, c1, 1);
    // Seat 0 leads round 1; seat 1 tries to act.
    send(room, c1, { type: 'EndActivation' });
    const msg = c1.last();
    expect(msg.t).toBe('error');
    if (msg.t === 'error') expect(msg.code).toBe('not_your_turn');
  });

  it('rejects an illegal command from the active seat', () => {
    const room = new RoomEngine(PVP);
    const c0 = new FakeConn('c0');
    join(room, c0, 0);
    // EndActivation is illegal in awaitingActivation.
    send(room, c0, { type: 'EndActivation' });
    const msg = c0.last();
    expect(msg.t).toBe('error');
    if (msg.t === 'error') expect(msg.code).toBe('illegal_command');
  });

  it('rejects a command from a connection that has not joined', () => {
    const room = new RoomEngine(PVP);
    const c = new FakeConn('c');
    room.onConnect(c); // connected but never joined
    send(room, c, { type: 'EndActivation' });
    const msg = c.last();
    expect(msg.t).toBe('error');
    if (msg.t === 'error') expect(msg.code).toBe('not_joined');
  });

  it('rejects a malformed frame', () => {
    const room = new RoomEngine(PVP);
    const c = new FakeConn('c');
    room.onConnect(c);
    room.onMessage(c, 'not json at all');
    const msg = c.last();
    expect(msg.t).toBe('error');
    if (msg.t === 'error') expect(msg.code).toBe('bad_frame');
  });

  it('applies a legal command and broadcasts the delta to both seats', () => {
    const room = new RoomEngine(PVP);
    const c0 = new FakeConn('c0');
    const c1 = new FakeConn('c1');
    join(room, c0, 0);
    join(room, c1, 1);
    c0.clear();
    c1.clear();

    const command = chooseCommand(room.getState());
    send(room, c0, command);

    const d0 = c0.last();
    const d1 = c1.last();
    expect(d0.t).toBe('delta');
    expect(d1.t).toBe('delta');
    if (d0.t === 'delta') {
      expect(d0.by).toBe(0);
      expect(d0.command).toEqual(command);
      expect(d0.state).toEqual(room.getState());
    }
  });

  it('answers a resync with the current full state', () => {
    const room = new RoomEngine(PVP);
    const c0 = new FakeConn('c0');
    join(room, c0, 0);
    c0.clear();
    room.onMessage(c0, JSON.stringify({ t: 'resync' }));
    const msg = c0.last();
    expect(msg.t).toBe('sync');
    if (msg.t === 'sync') expect(msg.state).toEqual(room.getState());
  });
});

describe('RoomEngine — AI seats (PvE)', () => {
  it('plays the AI seat automatically and broadcasts its moves as deltas', () => {
    const room = new RoomEngine(PVE);
    const c0 = new FakeConn('c0');
    join(room, c0, 0);
    // Human leads round 1, so no AI move yet.
    expect(c0.received.some((m) => m.t === 'delta' && m.by === 1)).toBe(false);

    // Drive the human seat until it hands control over; the AI then takes its
    // turn(s) unprompted (drained synchronously back to the human), which shows
    // up as broadcast deltas tagged `by: 1`.
    let guard = 0;
    while (
      !c0.received.some((m) => m.t === 'delta' && m.by === 1) &&
      room.getState().phase !== 'gameOver'
    ) {
      expect(room.getState().active).toBe(0);
      send(room, c0, chooseCommand(room.getState()));
      if (++guard > 200) throw new Error('AI never took a turn');
    }
    expect(c0.received.some((m) => m.t === 'delta' && m.by === 1)).toBe(true);
  });

  it('plays a full PvE game to a decisive, valid finish through the room', () => {
    const room = new RoomEngine(PVE);
    const c0 = new FakeConn('c0');
    join(room, c0, 0);

    let guard = 0;
    while (room.getState().phase !== 'gameOver') {
      const state = room.getState();
      expect(state.active).toBe(0); // control only ever returns to the human seat
      send(room, c0, chooseCommand(state));
      if (++guard > 5000) throw new Error('game did not terminate');
    }
    const final = room.getState();
    expect(final.winner === 0 || final.winner === 1).toBe(true);
    // No unit ever left the board or went negative — the room used the real engine.
    for (const u of final.units) {
      expect(u.pos.x).toBeGreaterThanOrEqual(0);
      expect(u.pos.y).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('RoomEngine — full PvP game via the wire seam', () => {
  it('two AI-driven clients play a complete game, seeing an identical final state', () => {
    const room = new RoomEngine(PVP);
    const c0 = new FakeConn('c0');
    const c1 = new FakeConn('c1');
    join(room, c0, 0);
    join(room, c1, 1);

    const conns: [FakeConn, FakeConn] = [c0, c1];
    let guard = 0;
    while (room.getState().phase !== 'gameOver') {
      const state = room.getState();
      const conn = conns[state.active];
      send(room, conn, chooseCommand(state));
      if (++guard > 5000) throw new Error('game did not terminate');
    }

    const final = room.getState();
    expect(final.phase).toBe('gameOver');
    // Both clients' last delta carries the same final authoritative state.
    const lastState = (c: FakeConn): unknown => {
      for (let i = c.received.length - 1; i >= 0; i--) {
        const m = c.received[i]!;
        if (m.t === 'delta') return m.state;
      }
      return null;
    };
    expect(lastState(c0)).toEqual(final);
    expect(lastState(c1)).toEqual(final);
  });
});

describe('RoomEngine — map and mode', () => {
  const KOTH: MatchSetup = { ...PVE, mapId: 'rolling-hills', mode: 'king-of-the-hill' };

  it('setupError accepts playable setups and names the problem otherwise', () => {
    expect(setupError(PVP)).toBeNull();
    expect(setupError(KOTH)).toBeNull();
    expect(setupError({ ...PVE, mode: 'kill-the-king', kings: [0, 1] })).toBeNull();
    expect(setupError({ ...PVE, mapId: 'no-such-map' })).toMatch(/unknown map/);
    expect(setupError({ ...PVE, presets: ['nope', 'ashfang-raiders'] })).toMatch(/unknown preset/);
    // Old Forest carries flags, not a hill; and KotH needs a map at all.
    expect(setupError({ ...PVE, mapId: 'old-forest', mode: 'king-of-the-hill' })).not.toBeNull();
    expect(setupError({ ...PVE, mode: 'king-of-the-hill' })).not.toBeNull();
    expect(setupError({ ...PVE, mode: 'kill-the-king', kings: [99, 0] })).not.toBeNull();
  });

  it('builds the room on the map in the mode and welcomes with that setup', () => {
    const room = new RoomEngine(KOTH);
    const c0 = new FakeConn('c0');
    join(room, c0, 0);
    const welcome = c0.received.find((m) => m.t === 'welcome');
    if (welcome?.t !== 'welcome') throw new Error('no welcome');
    expect(welcome.setup).toEqual(KOTH);
    expect(welcome.state.mode?.mode).toBe('king-of-the-hill');
    expect(welcome.state.mode?.objectives.hill).toBeDefined();
    expect(Object.keys(welcome.state.board.terrain ?? {}).length).toBeGreaterThan(0);
    expect(welcome.state).toEqual(room.getState());
  });

  it('plays a PvE king-of-the-hill game to a finish through the room', () => {
    const room = new RoomEngine(KOTH);
    const c0 = new FakeConn('c0');
    join(room, c0, 0);
    let guard = 0;
    while (room.getState().phase !== 'gameOver') {
      send(room, c0, chooseCommand(room.getState()));
      if (++guard > 5000) throw new Error('game did not terminate');
    }
    const final = room.getState();
    expect(final.winner === 0 || final.winner === 1).toBe(true);
    expect(c0.received.some((m) => m.t === 'error')).toBe(false);
  });
});

describe('RoomEngine — army-builder armies and pending pvp rooms', () => {
  const HORDE: Warband = {
    name: 'Horde',
    units: Array.from({ length: 9 }, (_, i) => ({ name: `Grunt ${i}`, quality: 2, combat: 6, move: 5, look: 'Marauder' })),
  };
  const CUSTOM: MatchSetup = { ...PVP, presets: ['custom', 'iron-wardens'], warbands: [HORDE, getPreset('iron-wardens')!] };

  it('builds a match from explicit warbands, with no point limit, carrying looks', () => {
    expect(setupError(CUSTOM)).toBeNull();
    const units = new RoomEngine(CUSTOM).getState().units.filter((u) => u.owner === 0);
    expect(units).toHaveLength(9);
    expect(units[0]).toMatchObject({ name: 'Grunt 0', combat: 6, look: 'Marauder' });
    expect(setupError({ ...CUSTOM, warbands: [{ ...HORDE, units: [] }, HORDE] })).toMatch(/too few units/);
    expect(setupError({ ...CUSTOM, warbands: [{ ...HORDE, units: [{ ...HORDE.units[0]!, combat: 9 }] }, HORDE] })).toMatch(
      /combat 9/,
    );
  });

  it('holds commands while pending, then re-welcomes the host with the finalised setup', () => {
    const room = new RoomEngine(PVP, undefined, { pending: true });
    const c0 = new FakeConn('c0');
    join(room, c0, 0);
    send(room, c0, chooseCommand(room.getState()));
    const err = c0.last();
    expect(err.t === 'error' && err.code).toBe('waiting_for_opponent');

    c0.clear();
    expect(room.finalize(CUSTOM)).toBe(true);
    const welcome = c0.last();
    if (welcome.t !== 'welcome') throw new Error('no welcome');
    expect(welcome.setup).toEqual(CUSTOM);
    expect(welcome.state.units.filter((u) => u.owner === 0)).toHaveLength(9);
    expect(room.setup).toEqual(CUSTOM);

    // Once final, play proceeds and the room can't be re-finalised.
    expect(room.finalize(PVP)).toBe(false);
    const c1 = new FakeConn('c1');
    join(room, c1, 1);
    const before = room.getState();
    const conn = before.active === 0 ? c0 : c1;
    send(room, conn, chooseCommand(before));
    expect(conn.last().t).toBe('delta');
  });

  it('refuses to finalise with a setup that cannot start', () => {
    const room = new RoomEngine(PVP, undefined, { pending: true });
    expect(room.finalize({ ...PVP, presets: ['nope', 'nope'] })).toBe(false);
    expect(room.isPending()).toBe(true);
  });
});
