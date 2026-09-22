import { signed, type ActivationRoll, type NerveRoll, type OpposedRoll, type RollSide, type RollVerdict } from '../ui/rollView.js';

/**
 * Dice over the board. A DOM layer on top of the WebGL canvas: each roll is a
 * card anchored above the rolling unit (re-projected every frame, so it follows
 * the camera), whose dice tumble, land, then reveal modifiers and the total in
 * turn. Everything runs on the board's clock, so the view can sequence the
 * blow (and its knockdown or death) after the card has shown the outcome.
 */

// Card stages, in ms from the card's start.
const TUMBLE_MS = 650; // dice spin, then land
const FACE_SWAP_MS = 75; // a tumbling die shows a new random face this often
const MODS_AT = 820; // first modifier chip
const MOD_STEP_MS = 180; // each further chip
const TOTAL_AT = 1180; // the total appears
const OUTCOME_AT = 1400; // winner glows, loser dims

/** Opposed roll: when the blow may begin (the card has shown who won). */
export const OPPOSED_ROLL_MS = 1600;

// Activation dice land one after another.
const ACTIVATION_STAGGER_MS = 140;
const ACTIVATION_SUMMARY_GAP_MS = 250;
/** Activation roll: when the dice's result is shown (from the card's start). */
export function activationResolveMs(dice: number): number {
  return TUMBLE_MS + ACTIVATION_STAGGER_MS * Math.max(0, dice - 1) + ACTIVATION_SUMMARY_GAP_MS;
}
/** Activation roll: when play may move on. */
export function activationRollMs(dice: number): number {
  return activationResolveMs(dice) + 550;
}

/** Nerve check: when its outcome is shown, and when play may move on. */
export const NERVE_RESOLVE_MS = TUMBLE_MS + 200;
export const NERVE_ROLL_MS = NERVE_RESOLVE_MS + 500;

/** How long a card lingers after its result, for callers sizing a card's life. */
export const ROLL_LINGER_MS = 900;
const LEAVE_MS = 250; // fade-out at the end of a card's life
const VERDICT_MS = 1700;

/** World heights (above a unit's base) that cards and verdicts anchor at. */
const CARD_HEIGHT = 1.5;
const VERDICT_HEIGHT = 0.9;

/** A unit's anchor on screen, in container pixels; null when off screen. */
export type Projector = (unitId: string, height: number) => { x: number; y: number } | null;

// Which of a 3×3 grid's cells hold a pip, per face.
const PIPS: Record<number, number[]> = {
  1: [4],
  2: [2, 6],
  3: [2, 4, 6],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

interface Die {
  el: HTMLElement;
  pips: HTMLElement[];
  value: number;
  /** Board time it lands. */
  landAt: number;
  landed: boolean;
  face: number;
  nextSwap: number;
  spin: number;
}

/** A timed reveal: add `cls` to `el` once board time reaches `at`. */
interface Reveal {
  at: number;
  el: HTMLElement;
  cls: string;
  done: boolean;
}

interface Card {
  el: HTMLElement;
  unitId: string;
  /** The other side of an opposed roll: the pair sits side by side. */
  partnerId: string | null;
  height: number;
  dice: Die[];
  reveals: Reveal[];
  endAt: number;
  leaving: boolean;
}

interface Verdict {
  el: HTMLElement;
  on: string[];
  start: number;
  endAt: number;
}

function h(tag: string, cls: string, text?: string): HTMLElement {
  const el = document.createElement(tag);
  el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

export class RollOverlay {
  private readonly layer: HTMLElement;
  private cards: Card[] = [];
  private verdicts: Verdict[] = [];
  private now = 0;

  constructor(container: HTMLElement, private readonly owners: (unitId: string) => 0 | 1 | undefined) {
    this.layer = h('div', 'roll-layer');
    container.appendChild(this.layer);
  }

  /** An attack, shot or riposte: two cards side by side, one per combatant. */
  addOpposed(roll: OpposedRoll, now: number, lifeMs: number): void {
    this.now = now;
    for (const [s, other] of [
      [roll.a, roll.b],
      [roll.b, roll.a],
    ] as const) {
      this.retire(s.unitId);
      const card = this.card(s.unitId, other.unitId, lifeMs, `roll-card opposed ${s === roll.a ? 'aggressor' : 'defender'}`);
      card.el.append(this.header(s.role, s.unitId));
      const line = h('div', 'roll-line');
      const die = this.die(s.unitId, s.die, now + TUMBLE_MS);
      card.dice.push(die);
      line.append(die.el);
      s.mods.forEach((m, i) => {
        const chip = h('span', `roll-mod${m.value === 0 ? ' zero' : ''}`);
        chip.append(h('b', '', signed(m.value)), document.createTextNode(` ${m.label}`));
        line.append(chip);
        this.reveal(card, chip, now + MODS_AT + i * MOD_STEP_MS);
      });
      card.el.append(line);
      const total = h('div', 'roll-total', `= ${s.total}`);
      card.el.append(total);
      this.reveal(card, total, now + TOTAL_AT);
      if (s.note) {
        const note = h('div', 'roll-note', s.note);
        card.el.append(note);
        this.reveal(card, note, now + OUTCOME_AT);
      }
      this.reveal(card, card.el, now + OUTCOME_AT, outcomeClass(s));
    }
  }

  /** An activation: the committed dice, each marked a success or failure against Quality. */
  addActivation(roll: ActivationRoll, now: number, lifeMs: number): void {
    this.now = now;
    this.retire(roll.unitId);
    const card = this.card(roll.unitId, null, lifeMs, 'roll-card activation');
    card.el.append(this.header(`Activation · need ${roll.quality}+`, roll.unitId));
    const line = h('div', 'roll-line');
    roll.dice.forEach((d, i) => {
      const landAt = now + TUMBLE_MS + i * ACTIVATION_STAGGER_MS;
      const die = this.die(roll.unitId, d.value, landAt);
      card.dice.push(die);
      line.append(die.el);
      this.reveal(card, die.el, landAt, d.success ? 'success' : 'failure');
    });
    card.el.append(line);
    const summary = h('div', `roll-summary${roll.turnover ? ' bad' : ''}`, roll.summary);
    card.el.append(summary);
    this.reveal(card, summary, now + activationResolveMs(roll.dice.length));
  }

  /** A nerve check: one die against Quality. */
  addNerve(roll: NerveRoll, now: number, lifeMs: number): void {
    this.now = now;
    this.retire(roll.unitId);
    const card = this.card(roll.unitId, null, lifeMs, 'roll-card nerve');
    card.el.append(this.header(`Nerve · need ${roll.quality}+`, roll.unitId));
    const line = h('div', 'roll-line');
    const die = this.die(roll.unitId, roll.die, now + TUMBLE_MS);
    card.dice.push(die);
    line.append(die.el);
    this.reveal(card, die.el, now + TUMBLE_MS, roll.passed ? 'success' : 'failure');
    const summary = h('div', `roll-summary${roll.passed ? '' : ' bad'}`, roll.summary);
    line.append(summary);
    card.el.append(line);
    this.reveal(card, summary, now + NERVE_RESOLVE_MS);
  }

  /** Big floating text over the affected unit(s), or mid-board when `on` is empty. */
  addVerdict(v: RollVerdict, now: number): void {
    this.now = now;
    const el = h('div', `roll-verdict ${v.tone}`);
    el.append(h('div', 'verdict-text', v.text));
    if (v.detail) el.append(h('div', 'verdict-detail', v.detail));
    this.layer.append(el);
    this.verdicts.push({ el, on: v.on, start: now, endAt: now + VERDICT_MS });
  }

  /** Fade out every card still up (the rolls that follow are about something else). */
  retireAll(): void {
    for (const c of this.cards) c.endAt = Math.min(c.endAt, this.now + LEAVE_MS);
  }

  /** Drop everything at once (a replay jump). */
  clear(): void {
    for (const c of this.cards) c.el.remove();
    for (const v of this.verdicts) v.el.remove();
    this.cards = [];
    this.verdicts = [];
  }

  dispose(): void {
    this.clear();
    this.layer.remove();
  }

  /** Per frame: tumble dice, run reveals, place cards, retire the finished. */
  update(now: number, project: Projector): void {
    this.now = now;
    const width = this.layer.clientWidth;
    const height = this.layer.clientHeight;

    this.cards = this.cards.filter((c) => {
      if (now >= c.endAt) {
        c.el.remove();
        return false;
      }
      if (!c.leaving && now >= c.endAt - LEAVE_MS) {
        c.leaving = true;
        c.el.classList.add('leaving');
      }
      for (const d of c.dice) this.tumble(d, now);
      for (const r of c.reveals) {
        if (!r.done && now >= r.at) {
          r.done = true;
          r.el.classList.add(r.cls);
        }
      }
      return true;
    });

    const placed: { left: number; top: number; w: number; h: number }[] = [];
    for (const c of this.cards) {
      const p = project(c.unitId, c.height);
      if (!p) {
        c.el.style.visibility = 'hidden';
        continue;
      }
      c.el.style.visibility = '';
      const w = c.el.offsetWidth;
      const hgt = c.el.offsetHeight;
      let left = p.x - w / 2;
      // A pair sits either side of the gap between its two units.
      const q = c.partnerId ? project(c.partnerId, c.height) : null;
      if (q) {
        const mid = (p.x + q.x) / 2;
        const onLeft = p.x < q.x || (p.x === q.x && c.el.classList.contains('aggressor'));
        left = onLeft ? Math.min(left, mid - 5 - w) : Math.max(left, mid + 5);
      }
      left = Math.max(4, Math.min(width - w - 4, left));
      let top = Math.max(4, Math.min(height - hgt - 4, p.y - hgt));
      // Cards over neighbouring units (a run of nerve checks) stack upward rather than overlap.
      for (let moved = true, guard = 0; moved && guard < 8; guard++) {
        moved = false;
        for (const r of placed) {
          if (left < r.left + r.w && r.left < left + w && top < r.top + r.h && r.top < top + hgt) {
            // Above the card in the way, or below it when that would leave the board.
            top = r.top - hgt - 4 >= 4 ? r.top - hgt - 4 : r.top + r.h + 4;
            moved = true;
          }
        }
      }
      placed.push({ left, top, w, h: hgt });
      c.el.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    }

    this.verdicts = this.verdicts.filter((v) => {
      if (now >= v.endAt) {
        v.el.remove();
        return false;
      }
      let x = width / 2;
      let y = height * 0.32;
      const points = v.on.map((id) => project(id, VERDICT_HEIGHT)).filter((p) => p !== null);
      if (points.length > 0) {
        x = points.reduce((s, p) => s + p.x, 0) / points.length;
        y = points.reduce((s, p) => s + p.y, 0) / points.length;
      }
      const f = (now - v.start) / (v.endAt - v.start);
      const rise = 28 * f;
      const w = v.el.offsetWidth;
      const hgt = v.el.offsetHeight;
      const left = Math.max(4, Math.min(width - w - 4, x - w / 2));
      v.el.style.transform = `translate(${Math.round(left)}px, ${Math.round(y - hgt / 2 - rise)}px)`;
      v.el.style.opacity = String(f < 0.75 ? 1 : 1 - (f - 0.75) / 0.25);
      return true;
    });
  }

  // --- internals ----------------------------------------------------------

  private card(unitId: string, partnerId: string | null, lifeMs: number, cls: string): Card {
    const owner = this.owners(unitId);
    const el = h('div', `${cls}${owner === undefined ? '' : ` p${owner}`}`);
    el.style.visibility = 'hidden'; // until placed on the next frame
    this.layer.append(el);
    const card: Card = { el, unitId, partnerId, height: CARD_HEIGHT, dice: [], reveals: [], endAt: this.now + lifeMs, leaving: false };
    this.cards.push(card);
    return card;
  }

  private header(role: string, unitId: string): HTMLElement {
    const el = h('div', 'roll-head');
    el.append(h('span', 'roll-role', role));
    const owner = this.owners(unitId);
    if (owner !== undefined) el.append(h('span', 'roll-owner', `P${owner}`));
    return el;
  }

  private die(unitId: string, value: number, landAt: number): Die {
    const owner = this.owners(unitId);
    const el = h('div', `die${owner === undefined ? '' : ` p${owner}`}`);
    const pips: HTMLElement[] = [];
    for (let i = 0; i < 9; i++) {
      const pip = h('span', 'pip');
      pips.push(pip);
      el.append(pip);
    }
    const d: Die = { el, pips, value, landAt, landed: false, face: 0, nextSwap: 0, spin: Math.random() * 360 };
    this.showFace(d, 1 + Math.floor(Math.random() * 6));
    return d;
  }

  private tumble(d: Die, now: number): void {
    if (d.landed) return;
    if (now >= d.landAt) {
      d.landed = true;
      this.showFace(d, d.value);
      d.el.style.transform = '';
      d.el.classList.add('landed');
      return;
    }
    if (now >= d.nextSwap) {
      let face = 1 + Math.floor(Math.random() * 5);
      if (face >= d.face) face++; // never the same face twice running
      this.showFace(d, face);
      d.nextSwap = now + FACE_SWAP_MS;
    }
    const left = Math.max(0, d.landAt - now);
    const hop = Math.abs(Math.sin(left / 110)) * Math.min(1, left / 300) * 7;
    d.el.style.transform = `translateY(${-hop.toFixed(1)}px) rotate(${(d.spin + left * 0.9).toFixed(0)}deg)`;
  }

  private showFace(d: Die, face: number): void {
    d.face = face;
    const on = PIPS[face] ?? [];
    d.pips.forEach((p, i) => p.classList.toggle('on', on.includes(i)));
  }

  private reveal(card: Card, el: HTMLElement, at: number, cls = 'shown'): void {
    card.reveals.push({ at, el, cls, done: false });
  }

  /** A new roll over a unit replaces any card still lingering over it. */
  private retire(unitId: string): void {
    this.cards = this.cards.filter((c) => {
      if (c.unitId !== unitId) return true;
      c.el.remove();
      return false;
    });
  }
}

function outcomeClass(s: RollSide): string {
  return s.outcome === 'win' ? 'won' : s.outcome === 'lose' ? 'lost' : 'tied';
}
