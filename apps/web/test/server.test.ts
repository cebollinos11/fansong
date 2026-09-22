import { describe, expect, it } from 'vitest';
import { withScheme } from '../src/net/server.js';

describe('withScheme', () => {
  it('keeps a full URL and adds https to a bare host', () => {
    expect(withScheme('http://localhost:8787')).toBe('http://localhost:8787');
    expect(withScheme('https://fansong.x.workers.dev/')).toBe('https://fansong.x.workers.dev');
    expect(withScheme('fansong.x.workers.dev')).toBe('https://fansong.x.workers.dev');
  });
});
