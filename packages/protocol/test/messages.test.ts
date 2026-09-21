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

  it('round-trips an error message with a stable code', () => {
    const err: ServerMessage = { t: 'error', code: ErrorCode.NotYourTurn, message: 'not your turn' };
    expect(parseServerMessage(encode(err))).toEqual(err);
  });
});
