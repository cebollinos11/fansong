import { BREAK_FREE_COST, SPELL_RANGES } from '@fansong/engine';

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

/** What a spell turn on this many dice can reach, and what it risks. */
export function spellHint(n: number): string {
  const reach = SPELL_RANGES[n - 1] ?? SPELL_RANGES.at(-1)!;
  const risk = n === 1 ? 'A single die can never turn over.' : 'Two failures still bench you.';
  return `Spell turn, ${n === 1 ? 'one die' : `${n} dice`} — every success is a point of power: a spell of up to power ${n}, reaching ${reach} hexes, and no other action. ${risk}`;
}

/** Why a spell turn on this many dice is not on offer: even at full power it reaches no one. */
export function spellOutOfReach(n: number): string {
  const reach = SPELL_RANGES[n - 1] ?? SPELL_RANGES.at(-1)!;
  return `no enemy within ${reach} hexes`;
}

/** What rolling this many dice to break free takes, and what it risks. */
export function breakFreeHint(n: number): string {
  return n <= BREAK_FREE_COST
    ? `${n} dice — both must succeed to break free, and both failing benches you.`
    : `${n} dice — ${BREAK_FREE_COST} successes break free and a third is an action to spend, but two failures bench you.`;
}

/** The chance of at least `k` successes on `n` dice against `quality`, the first a sure one when `inspired`. */
function atLeast(k: number, n: number, quality: number, inspired: boolean): number {
  const p = Math.min(1, Math.max(0, (7 - quality) / 6));
  const sure = inspired && n > 0 ? 1 : 0;
  const rolled = n - sure;
  let total = 0;
  for (let hits = Math.max(0, k - sure); hits <= rolled; hits++) {
    let ways = 1;
    for (let i = 1; i <= hits; i++) ways = (ways * (rolled - hits + i)) / i;
    total += ways * p ** hits * (1 - p) ** (rolled - hits);
  }
  return Math.min(1, total);
}

/** {@link oddsParts} for a spell turn: the chance of any power at all, then of the full reach. */
export function spellParts(n: number, quality: number, inspired: boolean): ReturnType<typeof oddsParts> {
  const base = oddsParts(n, quality, inspired);
  const full = atLeast(n, n, quality, inspired);
  const act = n === 1 ? `${pct(full)} to cast` : `${pct(atLeast(1, n, quality, inspired))} to cast · ${pct(full)} power ${n}`;
  return { ...base, act };
}

/** {@link oddsParts} for a transfixed unit's roll: the chance it breaks free. */
export function breakFreeParts(n: number, quality: number, inspired: boolean): ReturnType<typeof oddsParts> {
  return { ...oddsParts(n, quality, inspired), act: `${pct(atLeast(BREAK_FREE_COST, n, quality, inspired))} to break free` };
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
