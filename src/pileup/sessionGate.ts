export class PileupSessionGate {
  private readonly pending = new Set<number>();
  private closed = false;
  readonly sessionId: string;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  register(requestId: number): void {
    if (this.closed) throw new Error("The Pileup session is closed.");
    this.pending.add(requestId);
  }

  accept(responseSessionId: string, requestId: number): boolean {
    if (
      this.closed ||
      responseSessionId !== this.sessionId ||
      !this.pending.has(requestId)
    ) {
      return false;
    }
    this.pending.delete(requestId);
    return true;
  }

  close(): void {
    this.closed = true;
    this.pending.clear();
  }

  get pendingCount(): number {
    return this.pending.size;
  }
}
