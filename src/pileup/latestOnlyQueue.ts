export class LatestOnlyQueue<T> {
  private pending: T | null = null;
  private inFlight = false;
  private dropped = 0;

  enqueue(value: T): void {
    if (this.pending !== null) this.dropped += 1;
    this.pending = value;
  }

  take(): T | null {
    if (this.inFlight || this.pending === null) return null;
    const value = this.pending;
    this.pending = null;
    this.inFlight = true;
    return value;
  }

  complete(): void {
    this.inFlight = false;
  }

  clear(): void {
    this.pending = null;
    this.inFlight = false;
  }

  get depth(): number {
    return Number(this.inFlight) + Number(this.pending !== null);
  }

  get droppedCount(): number {
    return this.dropped;
  }
}
