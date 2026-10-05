/**
 * What the dice commitment menu says about each choice. Pure, so the wording
 * (and the inspired guarantee it promises) is tested without a DOM.
 */

/** What one shared roll of this many dice buys a group of `size`, and what it risks. */
export function groupHint(n: number, size: number, inspired: boolean): string {
  const sure = inspired ? ' All are inspired: the first die is a sure 6.' : '';
  const risk =
    n === 1
      ? 'A single die can never turn over, but a miss wastes all of them.'
      : 'Two failures bench you, and a roll with no successes wastes all of them.';
  return `Group of ${size}, ${n === 1 ? 'one die' : `${n} dice`} rolled once — each gets up to ${n} action${n === 1 ? '' : 's'}. ${risk}${sure}`;
}

/** What committing this many dice buys, and what it risks. */
export function diceHint(n: number, inspired: boolean): string {
  if (inspired) {
    // The sure 6 can't fail, so only the other dice can add up to a turnover.
    if (n === 1) return 'One die — inspired: a sure 6, one guaranteed action.';
    const risk =
      n - 1 >= 2 ? 'but two failures on the rest still bench you.' : 'and it can never turn over.';
    return `${n} dice — inspired: the first is a sure 6, so at least one action, up to ${n}, ${risk}`;
  }
  return n === 1
    ? 'One die — at most one action, but a single die can never turn over.'
    : `${n} dice — up to ${n} actions, but two failures bench you for the rest of the round.`;
}

/** The chances one activation roll gives: to earn at least one action, and to turn over. */
export interface ActivationOdds {
  act: number;
  turnover: number;
}

/**
 * The odds of rolling `n` dice against `quality` (each die succeeds on
 * `quality` or more). An inspired roll's first die is a sure 6, so only the
 * rest can fail; two failures turn the side over.
 */
export function activationOdds(n: number, quality: number, inspired: boolean): ActivationOdds {
  const p = Math.min(1, Math.max(0, (7 - quality) / 6));
  const q = 1 - p;
  const free = inspired ? Math.max(0, n - 1) : n;
  const act = inspired && n > 0 ? 1 : 1 - q ** n;
  // At most one failure among the dice that can fail is safe.
  const turnover = free < 2 ? 0 : 1 - p ** free - free * q * p ** (free - 1);
  return { act, turnover };
}

/** A chance as a whole percent that never rounds a maybe into "never" or "always". */
function pct(x: number): string {
  if (x <= 0) return '0%';
  if (x >= 1) return '100%';
  return `${Math.min(99, Math.max(1, Math.round(x * 100)))}%`;
}

/** The odds of a choice in words: "2 dice", "75% to act", "25% turnover" (`safe` when it can't turn over). */
export function oddsParts(
  n: number,
  quality: number,
  inspired: boolean,
): { dice: string; act: string; risk: string; safe: boolean } {
  const { act, turnover } = activationOdds(n, quality, inspired);
  return {
    dice: n === 1 ? '1 die' : `${n} dice`,
    act: act >= 1 ? 'sure to act' : `${pct(act)} to act`,
    risk: turnover <= 0 ? 'no turnover' : `${pct(turnover)} turnover`,
    safe: turnover <= 0,
  };
}

/** The odds of a choice on one line, e.g. "2 dice · 75% to act · 25% turnover". */
export function oddsLine(n: number, quality: number, inspired: boolean): string {
  const o = oddsParts(n, quality, inspired);
  return `${o.dice} · ${o.act} · ${o.risk}`;
}

/** What the odds line says while no choice is hovered: what a turnover costs. */
export const TURNOVER_COST = 'Two failed dice: your side sits out the rest of the round.';
