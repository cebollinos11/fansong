import { describe, expect, it } from 'vitest';
import { anchoredCard } from '../src/ui/anchorView.js';

const AREA = { width: 800, height: 600 };
const CARD = { width: 120, height: 60 };

describe('anchoredCard', () => {
  it('centres the card on the anchor and sits it above', () => {
    expect(anchoredCard({ x: 400, y: 300 }, CARD, AREA)).toEqual({ x: 340, y: 232 });
  });

  it('keeps a card over a unit at the edge on screen', () => {
    expect(anchoredCard({ x: 5, y: 300 }, CARD, AREA).x).toBe(6);
    expect(anchoredCard({ x: 795, y: 300 }, CARD, AREA).x).toBe(674);
    expect(anchoredCard({ x: 400, y: 10 }, CARD, AREA).y).toBe(6);
    expect(anchoredCard({ x: 400, y: 700 }, CARD, AREA).y).toBe(534);
  });

  it('pins a card larger than the board to the margin rather than off it', () => {
    expect(anchoredCard({ x: 400, y: 300 }, { width: 900, height: 700 }, AREA)).toEqual({ x: 6, y: 6 });
  });
});
