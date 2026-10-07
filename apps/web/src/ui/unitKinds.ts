import type { WarbandUnit } from '@fansong/content';

/**
 * A warband's units folded into distinct kinds, in order of first appearance:
 * units that differ only by name (same stats, look and tint) count as one.
 */
export function unitKinds(units: readonly WarbandUnit[]): { unit: WarbandUnit; count: number }[] {
  const kinds = new Map<string, { unit: WarbandUnit; count: number }>();
  for (const u of units) {
    const key = unitKindKey(u);
    const kind = kinds.get(key);
    if (kind) kind.count++;
    else kinds.set(key, { unit: u, count: 1 });
  }
  return [...kinds.values()];
}

/**
 * What makes two units the same kind: everything but the name, with the look a
 * unit drawn by its own name spells out, so equal kinds give equal strings.
 */
export function unitKindKey(u: WarbandUnit): string {
  const { name, look, ...rest } = u;
  return canonicalJson({ ...rest, look: look ?? name });
}

/** JSON with object keys sorted, so equal values give equal strings. */
function canonicalJson(v: unknown): string {
  return JSON.stringify(v, (_k, x: unknown) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : x,
  );
}
