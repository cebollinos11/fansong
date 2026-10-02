import { createMatchFromPresets, type MatchSetup } from '@fansong/content';
import type { GameEvent, GameMode, GameState } from '@fansong/engine';
import { describe, expect, it } from 'vitest';
import { appendEvents, buildLog, emptyLog, itemText, partsText, type BattleLog, type LogItem } from '../src/ui/log.js';

function match(mode: GameMode | undefined, mapId?: string): GameState {
  const setup: MatchSetup = { presets: ['iron-wardens-medium', 'ashfang-raiders-medium'], seats: ['ai', 'ai'], seed: 5 };
  return createMatchFromPresets({ ...setup, ...(mapId ? { mapId } : {}), ...(mode ? { mode } : {}) });
}

const items = (log: BattleLog): LogItem[] => log.rounds.flatMap((r) => r.groups.flatMap((g) => g.items));
const lines = (log: BattleLog): string[] => items(log).map(itemText);
/** The line one event makes on its own. */
const lineFor = (s: GameState, e: GameEvent): string => lines(appendEvents(emptyLog(), s, [e])).at(-1)!;

const s = match(undefined);
const [a, d] = [s.units.find((u) => u.owner === 0)!, s.units.find((u) => u.owner === 1)!];
const blow = {
  attackerId: a.id,
  targetId: d.id,
  attackDie: 4,
  defenseDie: 2,
  attackScore: 4 + a.combat,
  defenseScore: 2 + d.combat,
} as const;

describe('objective lines', () => {
  it('names the hill in king-of-the-hill scoring', () => {
    const hill = match('king-of-the-hill', 'rolling-hills');
    expect(lineFor(hill, { type: 'ScoreChanged', player: 1, points: 1, scores: [2, 3] })).toBe(
      '★ P1 scores 1 for holding the hill 2–3',
    );
  });

  it('letters conquest zones like the HUD', () => {
    const conquest = match('conquest', 'crossroads');
    expect(lineFor(conquest, { type: 'ScoreChanged', player: 0, points: 1, scores: [4, 1], zone: 2 })).toBe(
      '★ P0 scores 1 for holding zone C 4–1',
    );
  });

  it('tells flag events without coordinates', () => {
    const ctf = match('capture-the-flag', 'twin-towers');
    const u = ctf.units.find((x) => x.owner === 1)!;
    expect(lineFor(ctf, { type: 'FlagPickedUp', player: 0, unitId: u.id })).toBe(`⚑ ${u.name} seizes P0's flag`);
    expect(lineFor(ctf, { type: 'FlagDropped', player: 0, unitId: u.id, at: { x: 3, y: 4 } })).toBe(
      `⚑ ${u.name} drops P0's flag`,
    );
    expect(lineFor(ctf, { type: 'FlagCaptured', player: 1, unitId: u.id })).toMatch(/P1 captures it!$/);
  });

  it('explains why the game ended only in objective modes', () => {
    expect(lineFor(s, { type: 'GameOver', winner: 0 })).toBe('🏆 Game over — P0 wins');
    expect(lineFor(s, { type: 'GameOver', winner: 1, reason: 'king' })).toBe('🏆 Game over — P1 wins (the King has fallen)');
  });
});

describe('fight lines', () => {
  it('reads as who, the scores and the outcome, with the breakdown kept aside', () => {
    const log = appendEvents(emptyLog(), s, [
      { type: 'AttackResolved', ...blow, attackScore: blow.attackScore + 1, attackBig: 1, defenseScore: blow.defenseScore - 1, defenseOutnumbered: 1, result: 'defenderKnockedDown' },
    ]);
    const [item] = items(log);
    expect(itemText(item!)).toBe(`⚔ ${a.name} attacks ${d.name} ${blow.attackScore + 1}–${blow.defenseScore - 1} → knocked down`);
    expect(item!.detail).toEqual([
      `${a.name}: rolled 4 + ${a.combat} combat +1 size = ${blow.attackScore + 1}`,
      `${d.name}: rolled 2 + ${d.combat} combat −1 outnumbered = ${blow.defenseScore - 1}`,
    ]);
    expect(item!.unitIds).toEqual([a.id, d.id]);
  });

  it('mentions high ground only where it applied', () => {
    const plain = appendEvents(emptyLog(), s, [{ type: 'AttackResolved', ...blow, result: 'clash' }]);
    expect(items(plain)[0]!.detail!.join(' ')).not.toMatch(/high ground/);
    const shot = appendEvents(emptyLog(), s, [
      { type: 'ShotResolved', ...blow, defenseScore: blow.defenseScore + 1, defenseBonus: 1, result: 'clash' },
    ]);
    expect(itemText(items(shot)[0]!)).toMatch(/^➶ .* shoots /);
    expect(items(shot)[0]!.detail![1]).toBe(`${d.name}: rolled 2 + ${d.combat} combat +1 high ground = ${blow.defenseScore + 1}`);
  });

  it('folds the death a blow causes into its line', () => {
    const log = appendEvents(emptyLog(), s, [
      { type: 'AttackResolved', ...blow, result: 'defenderKilled', gruesome: true },
      { type: 'UnitKilled', unitId: d.id, byId: a.id },
    ]);
    expect(lines(log)).toEqual([`⚔ ${a.name} attacks ${d.name} ${blow.attackScore}–${blow.defenseScore} → killed gruesome!`]);
    expect(items(log)[0]!.tone).toBe('danger');
  });

  it('turns a Tough save into a knockdown on the same line', () => {
    const log = appendEvents(emptyLog(), s, [
      { type: 'AttackResolved', ...blow, result: 'defenderKilled' },
      { type: 'ToughnessSaved', unitId: d.id },
      { type: 'UnitKnockedDown', unitId: d.id },
    ]);
    expect(lines(log)).toHaveLength(1);
    expect(lines(log)[0]).toMatch(/→ knocked down \(Tough\)$/);
    expect(items(log)[0]!.tone).toBeUndefined();
  });

  it('says a tie killed by Combat Mastery, naming the master in the breakdown', () => {
    const log = appendEvents(emptyLog(), s, [
      { type: 'AttackResolved', ...blow, defenseScore: blow.attackScore, result: 'attackerKilled' },
      { type: 'MasteryStruck', unitId: d.id },
      { type: 'UnitKilled', unitId: a.id, byId: d.id },
    ]);
    expect(lines(log)).toEqual([
      `⚔ ${a.name} attacks ${d.name} ${blow.attackScore}–${blow.attackScore} → ${a.name} killed by Combat Mastery`,
    ]);
    expect(items(log)[0]!.detail).toContain(`Combat Mastery: ${d.name}'s tie kills a foe without it.`);
  });

  it('names the attacker when the blow backfires', () => {
    const log = appendEvents(emptyLog(), s, [
      { type: 'AttackResolved', ...blow, result: 'attackerRecoiled' },
      { type: 'UnitRecoiled', unitId: a.id, from: a.pos, to: a.pos },
    ]);
    expect(lines(log)).toEqual([`⚔ ${a.name} attacks ${d.name} ${blow.attackScore}–${blow.defenseScore} → ${a.name} pushed back`]);
  });

  it('says a braced unit held, and by whom', () => {
    const friend = s.units.find((u) => u.owner === 1 && u.id !== d.id)!;
    const log = appendEvents(emptyLog(), s, [
      { type: 'AttackResolved', ...blow, result: 'defenderRecoiled' },
      { type: 'UnitSupported', unitId: d.id, supporterId: friend.id },
    ]);
    expect(lines(log)[0]).toMatch(new RegExp(`→ braced by ${friend.name}$`));
    expect(items(log)[0]!.unitIds).toContain(friend.id);
  });

  it('keeps a riposte and the attack that follows it apart', () => {
    const log = appendEvents(emptyLog(), s, [
      {
        type: 'GuardRiposte',
        guardId: d.id,
        attackerId: a.id,
        guardDie: 1,
        attackerDie: 2,
        guardScore: 5,
        attackerScore: 6,
        result: 'clash',
        prevented: false,
      },
      { type: 'AttackResolved', ...blow, result: 'defenderRecoiled', powerPenalty: 1 },
      { type: 'UnitRecoiled', unitId: d.id, from: d.pos, to: d.pos },
    ]);
    expect(lines(log)).toEqual([
      `🛡 ${d.name} ripostes ${a.name} 5–6 → attack goes through`,
      `⚔ ${a.name} lands a power blow on ${d.name} ${blow.attackScore}–${blow.defenseScore} → pushed back`,
    ]);
  });
});

describe('grouping', () => {
  const walk = (x: number): GameEvent => ({
    type: 'UnitMoved',
    unitId: a.id,
    from: { x, y: 0 },
    to: { x: x + 2, y: 0 },
    path: [{ x, y: 0 }, { x: x + 1, y: 0 }, { x: x + 2, y: 0 }],
  });

  it('gathers an activation with its dice, and one walk across chained moves', () => {
    let log = appendEvents(emptyLog(2), s, [
      { type: 'ActivationChosen', player: 0, unitId: a.id, diceCount: 2 },
      { type: 'DiceRolled', unitId: a.id, quality: 4, dice: [5, 2], successes: 1, failures: 1 },
    ]);
    log = appendEvents(log, s, [walk(0)]);
    log = appendEvents(log, s, [walk(2), { type: 'ActivationEnded', unitId: a.id }]);

    expect(log.rounds).toHaveLength(1);
    const [g] = log.rounds[0]!.groups;
    expect(g!.unit?.id).toBe(a.id);
    expect(g!.roll).toMatchObject({ dice: [5, 2], quality: 4, successes: 1 });
    expect(g!.open).toBe(false);
    expect(g!.items.map(itemText)).toEqual([`➜ ${a.name} moves 4 hexes`]);
    expect(g!.items[0]!.path).toHaveLength(5);
    expect(partsText(g!.items[0]!.brief!)).toBe('➜ 4 hexes');
  });

  it('gives each member of a group activation its own entry under the shared roll', () => {
    const [b, c] = s.units.filter((u) => u.owner === 0 && u.id !== a.id);
    let log = appendEvents(emptyLog(), s, [
      { type: 'ActivationChosen', player: 0, unitId: a.id, diceCount: 2, group: [a.id, b!.id, c!.id] },
      { type: 'DiceRolled', unitId: a.id, quality: 4, dice: [5, 6], successes: 2, failures: 0 },
    ]);
    // The picked unit steps back before acting: the other takes over its entry.
    log = appendEvents(log, s, [{ type: 'GroupMemberActivated', unitId: c!.id, actions: 2 }]);
    log = appendEvents(log, s, [
      walk(0),
      { type: 'ActivationEnded', unitId: c!.id },
      { type: 'GroupMemberActivated', unitId: a.id, actions: 2 },
    ]);
    const groups = log.rounds[0]!.groups;
    expect(groups.map((g) => g.unit?.id)).toEqual([c!.id, a.id]);
    expect(groups.map((g) => g.groupOf)).toEqual([3, 3]);
    expect(groups[1]!.roll).toEqual(groups[0]!.roll);
    expect(groups.map((g) => g.open)).toEqual([false, true]);
  });

  it('starts a new round section and puts events outside activations in a loose group', () => {
    const log = appendEvents(emptyLog(), s, [
      { type: 'ActivationChosen', player: 0, unitId: a.id, diceCount: 1 },
      { type: 'ActivationEnded', unitId: a.id },
      { type: 'ScoreChanged', player: 0, points: 1, scores: [1, 0] },
      { type: 'RoundEnded', round: 2, nextLeader: 1 },
      { type: 'ActivationChosen', player: 1, unitId: d.id, diceCount: 3 },
      { type: 'Turnover', player: 1, unitId: d.id },
    ]);
    expect(log.rounds.map((r) => [r.round, r.leader])).toEqual([
      [1, undefined],
      [2, 1],
    ]);
    const [act, loose] = log.rounds[0]!.groups;
    expect(act!.items).toHaveLength(0);
    expect(loose!.unit).toBeUndefined();
    expect(loose!.items.map((i) => i.tone)).toEqual(['objective']);
    const next = log.rounds[1]!.groups[0]!;
    expect(next.turnover).toBe(true);
    expect(next.items[0]!.tone).toBe('danger');
  });

  it('surfaces the newest objective line as the callout', () => {
    const log = appendEvents(emptyLog(), s, [
      { type: 'ScoreChanged', player: 0, points: 1, scores: [1, 0] },
      { type: 'UnitKilled', unitId: d.id, byId: null },
    ]);
    expect(log.callout).toMatchObject({ tone: 'objective', text: '★ P0 scores 1 1–0' });
    expect(emptyLog().callout).toBeNull();
  });

  it('numbers lines the same way every time, so a rebuilt log keeps its keys', () => {
    const steps = [
      { state: s, events: [{ type: 'ActivationChosen', player: 0, unitId: a.id, diceCount: 1 }, walk(0)] as GameEvent[] },
      { state: s, events: [{ type: 'AttackResolved', ...blow, result: 'clash' }] as GameEvent[] },
    ];
    expect(buildLog(1, steps)).toEqual(buildLog(1, steps));
  });
});
