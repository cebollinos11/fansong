/**
 * Plays transitions one at a time. The engine resolves a command instantly, but
 * the board takes a while to show it (dice tumble, then the blow lands), so
 * transitions that arrive meanwhile — an AI's next move, an online opponent's
 * delta — wait their turn. `present` hands an item to the view, which reports
 * back through {@link played} how long it takes; after that, `finish` settles
 * it (the HUD and log catch up) and the next item is presented.
 */
export class PresentationQueue<T> {
  private readonly queue: T[] = [];
  private current: T | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private readonly waiters: (() => void)[] = [];
  /** Set by {@link hold}; consumed the next time the current item finishes. */
  private pendingHoldMs = 0;
  /** True from that finish until the held delay elapses — {@link idle} stays false throughout. */
  private holding = false;

  constructor(
    private readonly present: (item: T) => void,
    private readonly finish: (item: T, idle: boolean) => void,
    /** Pause between one item's animations ending and the next starting. */
    private readonly gapMs = 200,
    /** If the view never reports back, move on after this long. */
    private readonly fallbackMs = 6000,
  ) {}

  /** Whether nothing is playing, waiting, or deliberately held back. */
  get idle(): boolean {
    return this.current === null && this.queue.length === 0 && !this.holding;
  }

  push(item: T): void {
    this.queue.push(item);
    this.pump();
  }

  /**
   * Resolves once nothing is playing or waiting — at once if that is already so.
   * Lets a caller sending a chain of commands hold each one until the board has
   * finished showing the last. A disposed queue resolves rather than hanging.
   */
  whenIdle(): Promise<void> {
    if (this.idle || this.disposed) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  /** The item being presented takes `ms` to play out. */
  played(ms: number): void {
    if (this.current === null) return;
    this.wait(ms);
  }

  /**
   * Once the item now finishing has settled, wait at least `ms` more before
   * presenting the next one — for a banner or callout that covers the view and
   * must not be undercut by whatever plays next. Calls from `finish` (this
   * item's own settling) still land in time, since `finish` runs before this is
   * consulted.
   */
  hold(ms: number): void {
    this.pendingHoldMs = Math.max(this.pendingHoldMs, ms);
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.pendingHoldMs = 0;
    this.holding = false;
    this.queue.length = 0;
    this.wake();
  }

  /** Release everyone waiting on {@link whenIdle}. */
  private wake(): void {
    const waiting = this.waiters.splice(0);
    for (const resolve of waiting) resolve();
  }

  private pump(): void {
    if (this.disposed || this.current !== null) return;
    const next = this.queue.shift();
    if (next === undefined) return;
    this.current = next;
    this.wait(this.fallbackMs);
    this.present(next);
  }

  private wait(ms: number): void {
    if (this.timer !== null) clearTimeout(this.timer);
    const done = (): void => {
      this.timer = null;
      const item = this.current;
      if (item === null || this.disposed) return;
      this.current = null;
      this.finish(item, this.queue.length === 0);
      const advance = (): void => {
        this.holding = false;
        this.pump();
        // After `pump`, so `idle` is settled — and as a microtask, so whoever was
        // waiting resumes with the finished state already applied.
        if (this.idle) this.wake();
      };
      const holdMs = this.pendingHoldMs;
      this.pendingHoldMs = 0;
      if (holdMs > 0) {
        this.holding = true;
        this.timer = setTimeout(() => { this.timer = null; advance(); }, holdMs);
      } else {
        advance();
      }
    };
    // Anything animated gets a breather after it; an instant item settles at once.
    this.timer = setTimeout(done, ms > 0 ? ms + this.gapMs : 0);
  }
}
