import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PresentationQueue } from '../src/game/presentation.js';

describe('PresentationQueue', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup() {
    const log: string[] = [];
    const q = new PresentationQueue<string>(
      (item) => log.push(`present ${item}`),
      (item, idle) => log.push(`finish ${item}${idle ? ' idle' : ''}`),
      100,
      5000,
    );
    return { q, log };
  }

  it('presents at once, then settles after the animation and gap', () => {
    const { q, log } = setup();
    q.push('a');
    expect(log).toEqual(['present a']);
    expect(q.idle).toBe(false);
    q.played(1000);
    vi.advanceTimersByTime(1099);
    expect(log).toEqual(['present a']);
    vi.advanceTimersByTime(1);
    expect(log).toEqual(['present a', 'finish a idle']);
    expect(q.idle).toBe(true);
  });

  it('holds later items until the current one has played', () => {
    const { q, log } = setup();
    q.push('a');
    q.push('b');
    q.played(500);
    expect(log).toEqual(['present a']);
    vi.advanceTimersByTime(600);
    expect(log).toEqual(['present a', 'finish a', 'present b']);
    q.played(0);
    vi.advanceTimersByTime(0);
    expect(log).toEqual(['present a', 'finish a', 'present b', 'finish b idle']);
  });

  it('moves on if the view never reports back', () => {
    const { q, log } = setup();
    q.push('a');
    vi.advanceTimersByTime(5100);
    expect(log).toEqual(['present a', 'finish a idle']);
  });

  it('ignores a report with nothing presented, and stops when disposed', () => {
    const { q, log } = setup();
    q.played(100);
    q.push('a');
    q.push('b');
    q.dispose();
    vi.advanceTimersByTime(10000);
    expect(log).toEqual(['present a']);
  });
});
