import { describe, expect, it } from 'vitest';
import { installOffer } from '../src/ui/install.js';

const facts = { installed: false, dismissed: false, canPrompt: false, ios: false };

describe('installOffer', () => {
  it('offers nothing until the browser can install the app', () => {
    expect(installOffer(facts)).toBeNull();
  });

  it("opens the browser's own dialog when it has one", () => {
    expect(installOffer({ ...facts, canPrompt: true })).toBe('prompt');
    expect(installOffer({ ...facts, canPrompt: true, ios: true })).toBe('prompt');
  });

  it('points an iPhone or iPad at the Share menu', () => {
    expect(installOffer({ ...facts, ios: true })).toBe('ios');
  });

  it('stays away once installed or turned down', () => {
    expect(installOffer({ ...facts, canPrompt: true, installed: true })).toBeNull();
    expect(installOffer({ ...facts, ios: true, dismissed: true })).toBeNull();
  });
});
