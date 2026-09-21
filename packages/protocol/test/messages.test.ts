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

describe('client messages', () => {
  it('parses join / command / resync from JSON strings', () => {
    expect(parseClientMessage('{"t":"join","seat":1}')).toEqual({ t: 'join', seat: 1 });
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
      { t: 'join', seat: 0 },
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
