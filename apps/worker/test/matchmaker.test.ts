import { describe, expect, it } from 'vitest';
import { Matchmaker } from '../src/matchmaker.js';

/** Deterministic id source: r0, r1, r2, … */
function ids(): () => string {
  let n = 0;
  return () => `r${n++}`;
}

describe('Matchmaker — PvE', () => {
  it('matches instantly against the AI in a fresh room', () => {
    const mm = new Matchmaker(ids());
    const t = mm.request({ mode: 'pve', presets: ['iron-wardens', 'ashfang-raiders'], seed: 42 });
    expect(t).toEqual({
      roomId: 'r0',
      seat: 0,
      status: 'matched',
      setup: { presets: ['iron-wardens', 'ashfang-raiders'], seats: ['human', 'ai'], seed: 42 },
    });
    expect(mm.pendingCount()).toBe(0);
  });
});

describe('Matchmaker — PvP', () => {
  it('the first player hosts (seat 0, waiting); the second joins (seat 1, matched)', () => {
    const mm = new Matchmaker(ids());
    const host = mm.request({ mode: 'pvp', presets: ['iron-wardens', 'free-company'], seed: 7 });
    expect(host.status).toBe('waiting');
    expect(host.seat).toBe(0);
    expect(host.roomId).toBe('r0');
    expect(mm.pendingCount()).toBe(1);

    const joiner = mm.request({ mode: 'pvp', presets: ['whatever', 'ignored'], seed: 999 });
    expect(joiner.status).toBe('matched');
    expect(joiner.seat).toBe(1);
    // The joiner drops into the host's room and shares the host's setup exactly.
    expect(joiner.roomId).toBe('r0');
    expect(joiner.setup).toEqual(host.setup);
    expect(mm.pendingCount()).toBe(0);
  });

  it('forms one pair at a time as players arrive', () => {
    const mm = new Matchmaker(ids());
    // Each odd arrival hosts; the next arrival immediately pairs with it.
    const hostA = mm.request({ mode: 'pvp', presets: ['a0', 'a1'], seed: 1 }); // r0, waiting
    expect(mm.pendingCount()).toBe(1);
    const joinA = mm.request({ mode: 'pvp', presets: ['x', 'y'], seed: 2 }); // pairs r0
    expect(joinA.roomId).toBe(hostA.roomId);
    expect(mm.pendingCount()).toBe(0);

    const hostB = mm.request({ mode: 'pvp', presets: ['b0', 'b1'], seed: 3 }); // r1, waiting
    expect(hostB.roomId).not.toBe(hostA.roomId);
    const joinB = mm.request({ mode: 'pvp', presets: ['x', 'y'], seed: 4 }); // pairs r1
    expect(joinB.roomId).toBe(hostB.roomId);
    expect(mm.pendingCount()).toBe(0);
  });

  it('cancel removes a waiting host', () => {
    const mm = new Matchmaker(ids());
    const host = mm.request({ mode: 'pvp', presets: ['a', 'b'], seed: 1 });
    expect(mm.cancel(host.roomId)).toBe(true);
    expect(mm.pendingCount()).toBe(0);
    expect(mm.cancel(host.roomId)).toBe(false); // already gone
  });

  it('snapshot restores a waiting queue across restarts', () => {
    const mm1 = new Matchmaker(ids());
    mm1.request({ mode: 'pvp', presets: ['a', 'b'], seed: 1 });
    const snap = mm1.snapshot();
    expect(snap).toHaveLength(1);

    // A "restarted" matchmaker rehydrated from the snapshot pairs the joiner.
    const mm2 = new Matchmaker(ids(), snap);
    const joiner = mm2.request({ mode: 'pvp', presets: ['c', 'd'], seed: 2 });
    expect(joiner.status).toBe('matched');
    expect(joiner.roomId).toBe(snap[0]!.roomId);
  });
});

describe('Matchmaker — map and mode', () => {
  it('a plain request yields a setup with no map/mode keys', () => {
    const t = new Matchmaker(ids()).request({ mode: 'pve', presets: ['a', 'b'], seed: 1 });
    expect(Object.keys(t.setup).sort()).toEqual(['presets', 'seats', 'seed']);
  });

  it('copies map, game mode and Kings into the setup', () => {
    const mm = new Matchmaker(ids());
    const pve = mm.request({
      mode: 'pve',
      presets: ['iron-wardens', 'ashfang-raiders'],
      seed: 3,
      mapId: 'rolling-hills',
      gameMode: 'king-of-the-hill',
    });
    expect(pve.setup).toEqual({
      presets: ['iron-wardens', 'ashfang-raiders'],
      seats: ['human', 'ai'],
      seed: 3,
      mapId: 'rolling-hills',
      mode: 'king-of-the-hill',
    });
    const kings = mm.request({ mode: 'pve', presets: ['a', 'b'], seed: 3, gameMode: 'kill-the-king', kings: [1, 2] });
    expect(kings.setup.mode).toBe('kill-the-king');
    expect(kings.setup.kings).toEqual([1, 2]);
  });

  it('a pvp joiner plays the host map and mode, not its own', () => {
    const mm = new Matchmaker(ids());
    const host = mm.request({
      mode: 'pvp',
      presets: ['iron-wardens', 'ashfang-raiders'],
      seed: 3,
      mapId: 'old-forest',
      gameMode: 'capture-the-flag',
    });
    const joiner = mm.request({ mode: 'pvp', presets: ['x', 'y'], seed: 9, mapId: 'rolling-hills' });
    expect(joiner.setup).toEqual(host.setup);
    expect(joiner.setup.mapId).toBe('old-forest');
    expect(joiner.setup.mode).toBe('capture-the-flag');
  });
});
