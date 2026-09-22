import { describe, expect, it } from 'vitest';
import { createDemoGame } from '@fansong/engine';
import {
  ErrorCode,
  encode,
  parseClientMessage,
  parseServerMessage,
  safeParseClientMessage,
  type ClientMessage,
  type ServerMessage,
} from '../src/messages.js';
import { newRoomCode, normalizeRoomCode, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '../src/codes.js';

describe('client messages', () => {
  it('parses join / command / resync from JSON strings', () => {
    expect(parseClientMessage('{"t":"join"}')).toEqual({ t: 'join' });
    expect(
      parseClientMessage('{"t":"command","command":{"type":"EndActivation"}}'),
    ).toEqual({ t: 'command', command: { type: 'EndActivation' } });
    expect(parseClientMessage('{"t":"resync"}')).toEqual({ t: 'resync' });
  });

  it('rejects an unknown tag', () => {
    expect(() => parseClientMessage('{"t":"nope"}')).toThrow();
  });

  it('rejects a command frame carrying an illegal command shape', () => {
    expect(
      safeParseClientMessage('{"t":"command","command":{"type":"ChooseActivation","unitId":"x","diceCount":9}}')
        .success,
    ).toBe(false);
  });

  it('safeParse reports failure (not throw) for unparseable input', () => {
    expect(safeParseClientMessage('not json {').success).toBe(false);
    expect(safeParseClientMessage(42).success).toBe(false);
  });

  it('encode → parse round-trips every client message', () => {
    const msgs: ClientMessage[] = [
      { t: 'join' },
      { t: 'setArmy', preset: 'custom', warband: { name: 'Few', units: [{ name: 'A', quality: 3, combat: 3, move: 4 }] }, king: 0 },
      { t: 'setMap', mapId: 'old-forest', mode: 'capture-the-flag' },
      { t: 'ready', ready: true },
      { t: 'rematch' },
      { t: 'command', command: { type: 'Move', unitId: 'p0u0', to: { x: 3, y: 4 } } },
      { t: 'resync' },
    ];
    for (const m of msgs) expect(parseClientMessage(encode(m))).toEqual(m);
  });
});

describe('server messages', () => {
  it('encode → parse round-trips a welcome and a delta with real state', () => {
    const state = createDemoGame(5);
    const welcome: ServerMessage = {
      t: 'welcome',
      seat: 0,
      setup: { presets: ['iron-wardens', 'ashfang-raiders'], seats: ['human', 'human'], seed: 5 },
      state,
      presence: [true, false],
    };
    const delta: ServerMessage = {
      t: 'delta',
      by: 0,
      command: { type: 'EndActivation' },
      events: [{ type: 'ActivationEnded', unitId: 'p0u0' }],
      state,
    };
    expect(parseServerMessage(encode(welcome))).toEqual(welcome);
    expect(parseServerMessage(encode(delta))).toEqual(delta);
  });

  it('keeps optional high-ground bonus fields on combat events', () => {
    const state = createDemoGame(5);
    const delta: ServerMessage = {
      t: 'delta',
      by: 0,
      command: { type: 'Attack', attackerId: 'p0u0', targetId: 'p1u0' },
      events: [
        {
          type: 'GuardRiposte',
          guardId: 'p1u0',
          attackerId: 'p0u0',
          guardDie: 2,
          attackerDie: 3,
          guardScore: 6,
          attackerScore: 7,
          attackerBonus: 1,
          result: 'attackerKnockedDown',
          prevented: false,
        },
        {
          type: 'AttackResolved',
          attackerId: 'p0u0',
          targetId: 'p1u0',
          attackDie: 4,
          defenseDie: 2,
          attackScore: 8,
          defenseScore: 5,
          attackBonus: 1,
          result: 'defenderKnockedDown',
        },
      ],
      state,
    };
    expect(parseServerMessage(encode(delta))).toEqual(delta);
  });

  it('round-trips an error message with a stable code', () => {
    const err: ServerMessage = { t: 'error', code: ErrorCode.NotYourTurn, message: 'not your turn' };
    expect(parseServerMessage(encode(err))).toEqual(err);
  });
});

describe('lobby messages', () => {
  it('rejects a bad map pick, a negative King and extra keys', () => {
    expect(safeParseClientMessage({ t: 'setMap', mapId: 'x', mode: 'tag' }).success).toBe(false);
    const army = { t: 'setArmy', preset: 'p', warband: { name: 'W', units: [] }, king: -1 };
    expect(safeParseClientMessage(army).success).toBe(false);
    expect(safeParseClientMessage({ t: 'join', seat: 0 }).success).toBe(false);
  });

  it('round-trips a lobby', () => {
    const seat = { present: true, preset: 'iron-wardens', warband: { name: 'W', units: [] }, king: 0, ready: false };
    const lobby: ServerMessage = {
      t: 'lobby',
      seat: 1,
      lobby: { mapId: 'open-field', mode: 'annihilation', seats: [seat, { ...seat, present: false }], problem: null },
    };
    expect(parseServerMessage(encode(lobby))).toEqual(lobby);
  });

  it('a welcome carries a setup with map, mode and Kings', () => {
    const state = createDemoGame(5);
    const welcome: ServerMessage = {
      t: 'welcome',
      seat: 1,
      setup: {
        presets: ['iron-wardens', 'ashfang-raiders'],
        seats: ['human', 'human'],
        seed: 5,
        mapId: 'rolling-hills',
        mode: 'kill-the-king',
        kings: [1, 0],
      },
      state,
      presence: [true, true],
    };
    expect(parseServerMessage(encode(welcome))).toEqual(welcome);
  });
});

describe('room codes', () => {
  it('draws codes of the right length from the look-alike-free alphabet', () => {
    for (let i = 0; i < 50; i++) {
      const code = newRoomCode();
      expect(code).toHaveLength(ROOM_CODE_LENGTH);
      for (const ch of code) expect(ROOM_CODE_ALPHABET).toContain(ch);
    }
    expect(ROOM_CODE_ALPHABET).not.toMatch(/[01OIL]/);
  });

  it('normalises typed codes', () => {
    expect(normalizeRoomCode(' ab-c 7d ')).toBe('ABC7D');
  });
});
