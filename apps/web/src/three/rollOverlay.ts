import { modifierHelp, signed, type ActivationRoll, type NerveRoll, type OpposedRoll, type RollSide, type RollVerdict } from '../ui/rollView.js';

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

/**
 * Opposed roll: when the blow may begin. Combat cards skip the tumble and show
 * their result at once, so this is only a beat to take the numbers in.
 */
export const OPPOSED_ROLL_MS = 350;

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
const HOLD_MS = 600; // how long a card lingers after the pointer leaves the chip that held it
const VERDICT_MS = 1700;
const STAMP_MS = 2600; // a gruesome kill's headline stays up longer
/** Where a gruesome kill's headline sits, as a fraction of the view's height: above the fight, clear of the dice. */
const STAMP_TOP = 0.15;

/** World heights (above a unit's base) that cards and verdicts anchor at. */
const CARD_HEIGHT = 1.5;
const VERDICT_HEIGHT = 0.9;
/** A compact verdict's foot: just over the unit's head, so the unit itself stays in view. */
const HEAD_HEIGHT = 1.5;

/** Inset of a pinned card from the bottom corner it sits in. */
const PIN_MARGIN = 14;
/** How far a pinned verdict's foot sits above the bottom edge. */
const VERDICT_BOTTOM = 30;
/**
 * Narrower or shorter than this (a phone), the overlay goes compact: small
 * labels over units' heads in place of the big floating words (a fight's
 * conclusion included), and smaller dice. Upright, where the two corner cards
 * would meet, one combat strip along an edge replaces them and takes the
 * conclusion; on its side (short but wide), the corner cards stay, shrunk.
 */
const COMPACT_WIDTH = 560;
const COMPACT_HEIGHT = 480;
/** Where a strip docked at the top sits: under the camera tools. */
const STRIP_TOP = 54;
/** Room kept for the verdict a strip gains on the blow, when choosing its edge. */
const STRIP_VERDICT_ROOM = 44;

/** A unit's anchor on screen, in container pixels; null when off screen. */
export type Projector = (unitId: string, height: number) => { x: number; y: number } | null;

// Which of a 3×3 grid's cells hold a pip, per face.
export const DIE_PIPS: Record<number, number[]> = {
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

/**
 * Where a card is parked rather than following its unit: a bottom corner, or
 * (compact) the one combat strip along the top or bottom edge.
 */
type Pin = 'left' | 'right' | 'strip' | null;

interface Card {
  el: HTMLElement;
  unitId: string;
  /** The other side of an opposed roll: the pair sits side by side. */
  partnerId: string | null;
  /** Bottom corner this card is pinned to, or null to follow its unit. */
  pin: Pin;
  /** A strip's edge, chosen on its first frame (away from the fight) and kept. */
  dock?: 'top' | 'bottom';
  height: number;
  dice: Die[];
  reveals: Reveal[];
  endAt: number;
  leaving: boolean;
  /** The pointer is on one of its modifier chips: the card stays up while its tooltip is read. */
  held?: boolean;
}

/** What a zone's verdict says as it is scored at a round's end. */
export interface ZoneScoreText {
  /** "The hill", "Zone A". */
  name: string;
  /** Standing units of player 0 and player 1 in it. */
  counts: [number, number];
  /** Who takes the point; null when nobody does. */
  owner: 0 | 1 | null;
  /** "+1 You", "No points". */
  headline: string;
  /** Why: "more units standing in it", "contested: ...". */
  reason: string;
}

interface Verdict {
  el: HTMLElement;
  on: string[];
  /** Sits just above this point on screen (a zone's far edge) rather than over units. */
  anchor?: () => { x: number; y: number } | null;
  /** Fixed to the bottom centre (a combat's conclusion) rather than over its unit. */
  pin: boolean;
  /** A gruesome kill's headline, stamped across the upper middle of the view. */
  stamp: boolean;
  /** A small label just over its unit's head (compact), rather than big words across it. */
  compact: boolean;
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

  constructor(
    container: HTMLElement,
    private readonly owners: (unitId: string) => 0 | 1 | undefined,
    private readonly nameOf: (unitId: string) => string | undefined = () => undefined,
  ) {
    this.layer = h('div', 'roll-layer');
    container.appendChild(this.layer);
  }

  /**
   * An attack, shot or riposte: one card in each bottom corner — aggressor on
   * the left, defender on the right — so the blow itself stays in the clear.
   * The dice arrive already settled: combat is frequent, and waiting on a
   * tumble before every blow drags.
   */
  addOpposed(roll: OpposedRoll, now: number, lifeMs: number): void {
    this.now = now;
    // A new fight replaces the last one's cards, however long they had left.
    this.cards = this.cards.filter((c) => {
      if (!c.pin) return true;
      c.el.remove();
      return false;
    });
    if (this.layer.clientWidth < COMPACT_WIDTH) {
      this.addStrip(roll, now, lifeMs);
      return;
    }
    for (const [s, other] of [
      [roll.a, roll.b],
      [roll.b, roll.a],
    ] as const) {
      this.retire(s.unitId);
      const aggressor = s === roll.a;
      const card = this.card(
        s.unitId,
        other.unitId,
        lifeMs,
        `roll-card opposed pinned ${aggressor ? 'aggressor' : 'defender'}`,
        aggressor ? 'left' : 'right',
      );
      // Parked away from its unit, the card has to say whose roll it is.
      card.el.append(this.header(s.role, s.unitId, true));
      const line = h('div', 'roll-line');
      const die = this.die(s.unitId, s.die, now);
      card.dice.push(die);
      line.append(die.el);
      s.mods.forEach((m) => {
        const chip = h('span', `roll-mod${m.value === 0 ? ' zero' : ''}`);
        chip.append(h('b', '', signed(m.value)), document.createTextNode(` ${m.label}`));
        this.explain(card, chip, m.label);
        line.append(chip);
        this.reveal(card, chip, now);
      });
      card.el.append(line);
      const total = h('div', 'roll-total', `= ${s.total}`);
      card.el.append(total);
      this.reveal(card, total, now);
      if (s.note) {
        const note = h('div', 'roll-note', s.note);
        card.el.append(note);
        this.reveal(card, note, now);
      }
      this.reveal(card, card.el, now, outcomeClass(s));
    }
  }

  /** An activation: the committed dice, each marked a success or failure against Quality. */
  addActivation(roll: ActivationRoll, now: number, lifeMs: number): void {
    this.now = now;
    this.retire(roll.unitId);
    const card = this.card(roll.unitId, null, lifeMs, 'roll-card activation');
    card.el.append(this.header(`Activation · need ${roll.quality}+${roll.inspired ? ' · inspired' : ''}`, roll.unitId, true));
    const line = h('div', 'roll-line');
    roll.dice.forEach((d, i) => {
      const landAt = now + TUMBLE_MS + i * ACTIVATION_STAGGER_MS;
      const die = this.die(roll.unitId, d.value, landAt);
      if (d.inspired) die.el.classList.add('inspired');
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

  /**
   * Big floating text: over the affected unit(s) (mid-board when `on` is
   * empty), or — with `place` 'bottom' — across the bottom centre, between the
   * two combat cards, where a fight's conclusion always reads the same way
   * (on an upright phone, it joins the combat strip). A gruesome kill's
   * verdict is stamped as a headline over the fight instead.
   */
  addVerdict(v: RollVerdict, now: number, place: 'unit' | 'bottom' = 'unit'): void {
    this.now = now;
    const stamp = v.gruesome === true;
    const pin = !stamp && place === 'bottom';
    const compact = !stamp && this.compact();
    // On an upright phone a fight's conclusion joins its strip.
    if (pin && compact && this.stripVerdict(v, now)) return;
    const el = h('div', `roll-verdict ${v.tone}${pin ? ' pinned' : ''}${stamp ? ' stamp' : ''}${compact ? ' compact' : ''}`);
    el.append(h('div', 'verdict-text', v.text));
    if (v.detail) el.append(h('div', 'verdict-detail', v.detail));
    this.layer.append(el);
    this.verdicts.push({ el, on: v.on, pin, stamp, compact: compact && !pin, start: now, endAt: now + (stamp ? STAMP_MS : VERDICT_MS) });
  }

  /**
   * A zone scored at a round's end: its name, each side's standing units in
   * their colours, then who takes the point and why. Held over the zone (see
   * `anchor`) for `lifeMs`, replacing the last zone's.
   */
  addZoneScore(z: ZoneScoreText, now: number, lifeMs: number, anchor: () => { x: number; y: number } | null): void {
    this.now = now;
    this.verdicts = this.verdicts.filter((v) => {
      if (!v.anchor) return true;
      v.el.remove();
      return false;
    });
    const el = h('div', `roll-verdict zone-score ${z.owner === null ? 'unheld' : `p${z.owner}`}`);
    const count = h('div', 'zone-score-count');
    count.append(h('b', 'p0', String(z.counts[0])), document.createTextNode(' vs '), h('b', 'p1', String(z.counts[1])));
    el.append(h('div', 'zone-score-name', z.name), count, h('div', 'verdict-text', z.headline), h('div', 'verdict-detail', z.reason));
    this.layer.append(el);
    this.verdicts.push({ el, on: [], anchor, pin: false, stamp: false, compact: false, start: now, endAt: now + lifeMs });
  }

  /**
   * Fade out every card still up over a unit (the rolls that follow are about
   * something else). Combat cards sit in the corners, out of the way, and keep
   * their time: only the next fight replaces them.
   */
  retireAll(): void {
    for (const c of this.cards) if (!c.pin) c.endAt = Math.min(c.endAt, this.now + LEAVE_MS);
  }

  /**
   * Fade out the last fight's corner cards and its verdict: a new unit is
   * stepping up, and its dice should not share the screen with an old result.
   */
  retireFight(): void {
    const end = this.now + LEAVE_MS;
    for (const c of this.cards) if (c.pin) c.endAt = Math.min(c.endAt, end);
    for (const v of this.verdicts) if (v.pin) v.endAt = Math.min(v.endAt, end);
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
    this.layer.classList.toggle('compact', this.compact());

    this.cards = this.cards.filter((c) => {
      if (c.held && c.endAt < now + LEAVE_MS + HOLD_MS) {
        // Kept up while the pointer is on it, and back from fading if it had begun to.
        c.endAt = now + LEAVE_MS + HOLD_MS;
        if (c.leaving) {
          c.leaving = false;
          c.el.classList.remove('leaving');
        }
      }
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
      if (c.pin === 'strip') {
        c.el.style.visibility = '';
        const w = c.el.offsetWidth;
        const hgt = c.el.offsetHeight;
        c.dock ??= this.dockAway(c, project, height, hgt);
        const left = Math.max(4, (width - w) / 2);
        const top = c.dock === 'top' ? STRIP_TOP : Math.max(4, height - hgt - PIN_MARGIN);
        c.el.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
        continue;
      }
      if (c.pin) {
        // A bottom corner, whatever the camera does: the pair reads left to
        // right (aggressor, then defender) and never covers the fight.
        c.el.style.visibility = '';
        const w = c.el.offsetWidth;
        const hgt = c.el.offsetHeight;
        const left = c.pin === 'left' ? PIN_MARGIN : Math.max(PIN_MARGIN, width - w - PIN_MARGIN);
        const top = Math.max(4, height - hgt - PIN_MARGIN);
        c.el.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
        continue;
      }
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
      const f = (now - v.start) / (v.endAt - v.start);
      const rise = v.stamp || v.anchor ? 0 : (v.compact ? 10 : 28) * f;
      const w = v.el.offsetWidth;
      const hgt = v.el.offsetHeight;
      let x = width / 2;
      let y = height * 0.32;
      if (v.stamp) {
        y = Math.max(hgt / 2 + 4, height * STAMP_TOP);
      } else if (v.anchor) {
        // Its foot on the anchor, and kept on screen when the zone itself isn't.
        const p = v.anchor();
        if (p) {
          x = p.x;
          y = Math.max(hgt / 2 + 4, Math.min(height - hgt / 2 - 4, p.y - hgt / 2 - 6));
        }
      } else if (v.pin) {
        // Between the corner cards: level with their middles on a phone on its
        // side, clear of the action panel along the bottom.
        const cards = this.cards.filter((c) => c.pin === 'left' || c.pin === 'right').map((c) => c.el.offsetHeight);
        y =
          this.compact() && cards.length > 0
            ? height - PIN_MARGIN - Math.max(...cards) / 2
            : height - VERDICT_BOTTOM - hgt / 2;
      } else if (v.compact) {
        // Its foot just over the unit's head, lifted clear of any card there.
        const points = v.on.map((id) => project(id, HEAD_HEIGHT)).filter((p) => p !== null);
        if (points.length > 0) {
          x = points.reduce((s, p) => s + p.x, 0) / points.length;
          y = Math.min(...points.map((p) => p.y)) - hgt / 2;
        }
        // Lifted clear of any card or label already over the same units.
        const left = Math.max(4, Math.min(width - w - 4, x - w / 2));
        for (const r of placed) {
          const top = y - rise - hgt / 2;
          if (left < r.left + r.w && r.left < left + w && top < r.top + r.h && r.top < top + hgt) y = r.top - 4 - hgt / 2 + rise;
        }
        y = Math.max(hgt / 2 + 4, y);
        placed.push({ left, top: y - rise - hgt / 2, w, h: hgt });
      } else {
        const points = v.on.map((id) => project(id, VERDICT_HEIGHT)).filter((p) => p !== null);
        if (points.length > 0) {
          x = points.reduce((s, p) => s + p.x, 0) / points.length;
          y = points.reduce((s, p) => s + p.y, 0) / points.length;
        }
      }
      const left = Math.max(4, Math.min(width - w - 4, x - w / 2));
      v.el.style.transform = `translate(${Math.round(left)}px, ${Math.round(y - hgt / 2 - rise)}px)`;
      v.el.style.opacity = String(f < 0.75 ? 1 : 1 - (f - 0.75) / 0.25);
      return true;
    });
  }

  // --- internals ----------------------------------------------------------

  /** Whether the board is phone-sized, and the overlay goes compact. */
  private compact(): boolean {
    return this.layer.clientWidth < COMPACT_WIDTH || this.layer.clientHeight < COMPACT_HEIGHT;
  }

  /**
   * A fight on a phone: both sides on one slim strip, aggressor left and
   * defender right, each with its die, its modifiers summed into one number
   * (the battle log has the breakdown) and its total.
   */
  private addStrip(roll: OpposedRoll, now: number, lifeMs: number): void {
    this.retire(roll.a.unitId);
    this.retire(roll.b.unitId);
    const card = this.card(roll.a.unitId, roll.b.unitId, lifeMs, 'roll-strip', 'strip');
    card.el.classList.remove('p0', 'p1'); // the strip is both sides'
    const row = h('div', 'strip-row');
    for (const s of [roll.a, roll.b]) {
      const owner = this.owners(s.unitId);
      const el = h('div', `strip-side ${s === roll.a ? 'aggressor' : 'defender'}${owner === undefined ? '' : ` p${owner}`}`);
      const head = h('div', 'strip-head');
      head.append(h('span', 'roll-role', s.role));
      const name = this.nameOf(s.unitId);
      if (name) head.append(h('span', 'strip-name', name));
      const line = h('div', 'strip-line');
      const die = this.die(s.unitId, s.die, now);
      card.dice.push(die);
      line.append(die.el);
      const mods = s.mods.reduce((sum, m) => sum + m.value, 0);
      if (s.mods.length > 0) {
        const chip = h('span', `strip-mod${mods === 0 ? ' zero' : ''}`, signed(mods));
        chip.title = s.mods
          .map((m) => {
            const help = modifierHelp(m.label);
            return `${signed(m.value)} ${m.label}${help ? ` — ${help}` : ''}`;
          })
          .join('\n');
        this.hold(card, chip);
        line.append(chip);
      }
      line.append(h('span', 'strip-total', `= ${s.total}`));
      el.append(head, line);
      if (s.note) el.append(h('div', 'strip-note', s.note));
      this.reveal(card, el, now, outcomeClass(s));
      row.append(el);
    }
    row.insertBefore(h('div', 'strip-vs', 'vs'), row.lastChild);
    card.el.append(row);
  }

  /** Put a fight's conclusion on its strip, under the dice. False when no strip is up for it. */
  private stripVerdict(v: RollVerdict, now: number): boolean {
    const card = this.cards.find((c) => c.pin === 'strip' && !c.leaving);
    if (!card) return false;
    card.el.querySelector('.strip-verdict')?.remove();
    const el = h('div', `strip-verdict ${v.tone}`);
    el.append(h('span', 'verdict-text', v.text));
    if (v.detail) el.append(h('span', 'verdict-detail', v.detail));
    card.el.append(el);
    card.endAt = Math.max(card.endAt, now + VERDICT_MS);
    return true;
  }

  /**
   * The edge a strip docks on: the bottom, unless it (and the verdict it will
   * gain) would cover the two fighters there and the top covers them less.
   */
  private dockAway(c: Card, project: Projector, height: number, hgt: number): 'top' | 'bottom' {
    const ys = [c.unitId, c.partnerId]
      .flatMap((id) => (id ? [project(id, 0), project(id, CARD_HEIGHT)] : []))
      .filter((p) => p !== null)
      .map((p) => p.y);
    if (ys.length === 0) return 'bottom';
    const room = hgt + STRIP_VERDICT_ROOM;
    const below = height - PIN_MARGIN - room - Math.max(...ys);
    const above = Math.min(...ys) - (STRIP_TOP + room);
    return below >= 8 || below >= above ? 'bottom' : 'top';
  }

  private card(unitId: string, partnerId: string | null, lifeMs: number, cls: string, pin: Pin = null): Card {
    const owner = this.owners(unitId);
    const el = h('div', `${cls}${owner === undefined ? '' : ` p${owner}`}`);
    el.style.visibility = 'hidden'; // until placed on the next frame
    this.layer.append(el);
    const card: Card = { el, unitId, partnerId, pin, height: CARD_HEIGHT, dice: [], reveals: [], endAt: this.now + lifeMs, leaving: false };
    this.cards.push(card);
    return card;
  }

  /** Role on the left; on the right the roller's side, or their name when the card sits away from them. */
  private header(role: string, unitId: string, named = false): HTMLElement {
    const el = h('div', 'roll-head');
    el.append(h('span', 'roll-role', role));
    const owner = this.owners(unitId);
    const who = (named ? this.nameOf(unitId) : undefined) ?? (owner === undefined ? null : `P${owner}`);
    if (who !== null) el.append(h('span', `roll-owner${owner === undefined ? '' : ` p${owner}`}`, who));
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
    const on = DIE_PIPS[face] ?? [];
    d.pips.forEach((p, i) => p.classList.toggle('on', on.includes(i)));
  }

  /** Give a modifier chip its hover tooltip: what the modifier is and when it applies. */
  private explain(card: Card, chip: HTMLElement, label: string): void {
    const help = modifierHelp(label);
    if (!help) return;
    chip.dataset.help = help;
    this.hold(card, chip);
  }

  /** While the pointer is on `el`, its card stays up. */
  private hold(card: Card, el: HTMLElement): void {
    el.addEventListener('pointerenter', () => (card.held = true));
    el.addEventListener('pointerleave', () => (card.held = false));
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
