import { clipDuration, type Clip, type SpriteAnimations } from './unitAnimations.js';

const IDLE_MIN_MS = 6000;
const IDLE_MAX_MS = 15000;

interface Playing {
  clip: Clip;
  t: number;
  /** Stay on the last frame when done (death) instead of returning to rest. */
  hold: boolean;
}

/**
 * Picks the frame a unit shows, Wesnoth-style. In priority order:
 *   1. a one-shot clip (attack, defend, death, rally…), played to its end;
 *   2. the move loop while the unit is sliding between hexes;
 *   3. a held pose (e.g. braced while on Guard);
 *   4. the standing loop, broken up now and then by the idle clip;
 *   5. the base image.
 * It only tracks time and names images — the view maps them onto the atlas.
 */
export class UnitAnimator {
  private playing: Playing | null = null;
  private moveLeftMs = 0;
  private moveT = 0;
  private standT = 0;
  private idleInMs = randomIdleDelay();
  /** A still frame to hold at rest, or null for the standing loop. */
  pose: string | null = null;
  /** Suppress the idle flourish (knocked down, dying…). */
  restless = true;

  constructor(
    readonly base: string,
    readonly anims: SpriteAnimations,
  ) {}

  play(clip: Clip | undefined, opts: { hold?: boolean } = {}): number {
    if (!clip || clip.frames.length === 0) return 0;
    this.playing = { clip, t: 0, hold: opts.hold ?? false };
    return clipDuration(clip);
  }

  /** Drop any clip in progress (including a held death) and return to rest. */
  stop(): void {
    this.playing = null;
    this.moveLeftMs = 0;
  }

  /** Loop the move clip (if any) for the next `ms`; `reset` replaces (rather than extends) what's left. */
  moveFor(ms: number, opts: { reset?: boolean } = {}): void {
    this.moveLeftMs = opts.reset ? ms : Math.max(this.moveLeftMs, ms);
  }

  get busy(): boolean {
    return this.playing !== null && !this.playing.hold;
  }

  /** Advance by `dtMs` and return the image to show. */
  update(dtMs: number): string {
    this.standT += dtMs;
    if (this.playing) {
      const p = this.playing;
      p.t += dtMs;
      const total = clipDuration(p.clip);
      if (p.t < total || p.hold) return frameAt(p.clip, Math.min(p.t, total - 1));
      this.playing = null;
    }

    if (this.moveLeftMs > 0) {
      this.moveLeftMs -= dtMs;
      this.moveT += dtMs;
      if (this.anims.move) return loopFrame(this.anims.move, this.moveT);
    }

    if (this.pose) return this.pose;

    if (this.restless && this.anims.idle) {
      this.idleInMs -= dtMs;
      if (this.idleInMs <= 0) {
        this.idleInMs = randomIdleDelay();
        this.play(this.anims.idle);
        return frameAt(this.anims.idle, 0);
      }
    }
    return this.anims.standing ? loopFrame(this.anims.standing, this.standT) : this.base;
  }
}

function frameAt(clip: Clip, t: number): string {
  let acc = 0;
  for (const [image, ms] of clip.frames) {
    acc += ms;
    if (t < acc) return image;
  }
  return clip.frames[clip.frames.length - 1]![0];
}

const loopFrame = (clip: Clip, t: number): string => frameAt(clip, t % clipDuration(clip));

function randomIdleDelay(): number {
  return IDLE_MIN_MS + Math.random() * (IDLE_MAX_MS - IDLE_MIN_MS);
}
