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

  constructor(
    private readonly present: (item: T) => void,
    private readonly finish: (item: T, idle: boolean) => void,
    /** Pause between one item's animations ending and the next starting. */
    private readonly gapMs = 200,
    /** If the view never reports back, move on after this long. */
    private readonly fallbackMs = 6000,
  ) {}

  /** Whether nothing is playing or waiting. */
  get idle(): boolean {
    return this.current === null && this.queue.length === 0;
  }

  push(item: T): void {
    this.queue.push(item);
    this.pump();
  }

  /** The item being presented takes `ms` to play out. */
  played(ms: number): void {
    if (this.current === null) return;
    this.wait(ms);
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.queue.length = 0;
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
      this.pump();
    };
    // Anything animated gets a breather after it; an instant item settles at once.
    this.timer = setTimeout(done, ms > 0 ? ms + this.gapMs : 0);
  }
}
