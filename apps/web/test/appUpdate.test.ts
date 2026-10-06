import { describe, expect, it } from 'vitest';
import { updateStatus, type UpdateState } from '../src/ui/appUpdate.js';

describe('updateStatus', () => {
  it('lets the player check whenever nothing is under way', () => {
    for (const state of ['idle', 'latest', 'failed'] satisfies UpdateState[]) {
      expect(updateStatus(state).action).toBe('check');
    }
    expect(updateStatus('latest').text).toMatch(/up to date/i);
  });

  it('holds the button while it checks or downloads', () => {
    expect(updateStatus('checking').action).toBeNull();
    expect(updateStatus('downloading').action).toBeNull();
  });

  it('offers a restart once a newer build is fetched', () => {
    expect(updateStatus('ready').action).toBe('restart');
  });
});
