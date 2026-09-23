/**
 * Placing a card over the board. The board projects a unit to a point in its
 * own pixels; a card anchored there wants to sit centred above it and stay
 * fully on screen, however close to an edge the unit has wandered.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/** A unit's anchor in board pixels, `height` world units above its base; null when off screen. */
export type UnitProjector = (unitId: string, height: number) => Point | null;

/**
 * The top-left (board pixels) for a `card` centred on `anchor.x` and sitting
 * `gap` px above `anchor.y`, kept inside `area` with `margin` of clearance.
 * A card with nowhere to fit is pinned to the margin rather than pushed off.
 */
export function anchoredCard(anchor: Point, card: Size, area: Size, gap = 8, margin = 6): Point {
  return {
    x: clamp(anchor.x - card.width / 2, margin, area.width - card.width - margin),
    y: clamp(anchor.y - gap - card.height, margin, area.height - card.height - margin),
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), Math.max(lo, hi));
}
