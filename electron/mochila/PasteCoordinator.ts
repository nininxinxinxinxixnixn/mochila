/** Serialize completed physical gestures; cancel queued work on pause/target change. */
export class PasteCoordinator {
  private pending = 0
  private draining = false
  private generation = 0
  private auto = false
  constructor(private readonly armed: () => boolean, private readonly deliver: () => Promise<void>, private readonly failed: (error: unknown) => void) {}
  request(): void {
    if (!this.armed() || this.auto) return
    this.pending = Math.min(this.pending + 1, 1000)
    if (!this.draining) void this.drain()
  }
  get automatic(): boolean { return this.auto && this.armed() }
  startAutomatic(): void { if (!this.armed()) return; this.auto = true; if (!this.draining) void this.drain() }
  cancel(): void { this.generation++; this.pending = 0; this.auto = false }
  private async drain(): Promise<void> {
    this.draining = true
    const token = this.generation
    try {
      while ((this.pending || this.auto) && this.armed() && token === this.generation) {
        if (this.pending) this.pending--
        await this.deliver()
      }
    } catch (error) { this.cancel(); this.failed(error) }
    finally {
      this.draining = false
      if (!this.armed()) { this.pending = 0; this.auto = false }
      // A new armed session may have requested work while the previous one ended.
      if ((this.pending || this.auto) && this.armed()) void this.drain()
    }
  }
}
