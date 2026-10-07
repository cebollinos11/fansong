import { createGame, type UnitSpec } from '@fansong/engine';
import { describe, expect, it } from 'vitest';
import { coinDim, coinPose, COIN_LAND_MS, COIN_TOSS_MS } from '../src/three/coin.js';
import { championOf, coinTossView, tossWords } from '../src/ui/coinView.js';

describe('coinPose', () => {
  it('lands showing the winner: whole turns for player 0, a half turn more for player 1', () => {
    for (const ms of [COIN_LAND_MS, COIN_LAND_MS + 500, COIN_TOSS_MS - 1]) {
      // The cosine of the turn: 1 with player 0's face square to the view, -1 with player 1's.
      expect(Math.cos(coinPose(ms, 0).spin)).toBeCloseTo(1, 6);
      expect(Math.cos(coinPose(ms, 1).spin)).toBeCloseTo(-1, 6);
    }
  });

  it('only ever turns one way, and never after it has landed', () => {
    let last = -1;
    for (let ms = 0; ms <= COIN_TOSS_MS; ms += 10) {
      const { spin } = coinPose(ms, 1);
      expect(spin).toBeGreaterThanOrEqual(last);
      last = spin;
    }
    expect(coinPose(COIN_LAND_MS, 1).spin).toBe(coinPose(COIN_TOSS_MS, 1).spin);
  });

  it('comes up from under the view, flies above its middle, and rests on it', () => {
    expect(coinPose(0, 0).rise).toBeLessThan(-0.6);
    expect(Math.max(...[800, 1300, 1600].map((ms) => coinPose(ms, 0).rise))).toBeGreaterThan(0.2);
    expect(coinPose(COIN_LAND_MS + 600, 0).rise).toBe(0);
  });

  it('fades in, burns once it has landed, and is gone by the end', () => {
    expect(coinPose(0, 0).opacity).toBe(0);
    expect(coinPose(1000, 0).opacity).toBe(1);
    expect(coinPose(1000, 0).glow).toBe(0);
    expect(coinPose(COIN_LAND_MS + 400, 0).glow).toBe(1);
    expect(coinPose(COIN_TOSS_MS, 0).opacity).toBe(0);
  });

  it('darkens the board for the toss and gives it back at the end', () => {
    expect(coinDim(0)).toBe(0);
    expect(coinDim(COIN_LAND_MS)).toBe(1);
    expect(coinDim(COIN_TOSS_MS)).toBe(0);
  });
});

describe('coin toss view', () => {
  const unit = (name: string, x: number, more: Partial<UnitSpec> = {}): UnitSpec => ({ name, quality: 3, combat: 3, pos: { x, y: 0 }, ...more });
  const game = (p0: UnitSpec[], p1: UnitSpec[], leader: 0 | 1 = 0) =>
    createGame({ seed: 1, board: { width: 8, height: 4 }, warbands: [p0, p1], initiativeLeader: leader });

  it('strikes each face with the side\'s Leader, else its best fighter', () => {
    const state = game(
      [unit('Levy', 0), unit('Warden-Captain', 1, { leader: true }), unit('Ironguard', 2, { combat: 5 })],
      [unit('Whelp', 5), unit('Reaver', 6, { combat: 4 }), unit('Marauder', 7, { combat: 4, quality: 2 })],
    );
    expect(championOf(state, 0)?.name).toBe('Warden-Captain');
    expect(championOf(state, 1)?.name).toBe('Marauder');
  });

  it('strikes the look a unit is drawn as, not its name', () => {
    const state = game([unit('My Hero', 0, { look: 'Knight' })], [unit('Whelp', 7)], 1);
    expect(coinTossView(state, ['You', 'AI'])).toEqual({ winner: 1, champions: ['Knight', 'Whelp'], names: ['You', 'AI'] });
  });

  it('reads the verdict out in the side\'s own name', () => {
    const state = game([unit('Levy', 0)], [unit('Whelp', 7)]);
    expect(tossWords(coinTossView(state, ['You', 'AI'])).verdict).toBe('You begin!');
    expect(tossWords({ ...coinTossView(state, ['You', 'AI']), winner: 1 }).verdict).toBe('AI begins!');
    expect(tossWords(coinTossView(state, ['Iron Wardens', 'Ashfang Raiders'])).verdict).toBe('Iron Wardens begins!');
  });
});
