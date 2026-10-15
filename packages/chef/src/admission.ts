// Fixed per-server limits; waiting requests have no body reader or database view.
const ACTIVE_LIMIT = 2;
const WAITING_LIMIT = 8;
const WAIT_MS = 250;

export class AdmissionError extends Error {}
type Waiter = { grant: () => void; reject: (error: Error) => void };

export class RequestAdmission {
  private active = 0;
  private closed = false;
  private readonly waiting: Waiter[] = [];

  acquire(signal: AbortSignal): Promise<() => void> {
    if (signal.aborted) return Promise.reject(signal.reason);
    if (this.closed) return Promise.reject(new AdmissionError("Server is closing"));
    if (this.active < ACTIVE_LIMIT) { this.active++; return Promise.resolve(this.permit()); }
    if (this.waiting.length >= WAITING_LIMIT) return Promise.reject(new AdmissionError("Query capacity reached"));
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", cancel);
        const index = this.waiting.indexOf(waiter);
        if (index !== -1) this.waiting.splice(index, 1);
      };
      const waiter: Waiter = {
        grant: () => { cleanup(); this.active++; resolve(this.permit()); },
        reject: (error) => { cleanup(); reject(error); },
      };
      const cancel = () => waiter.reject(signal.reason);
      const timer = setTimeout(() => waiter.reject(new AdmissionError("Query admission deadline exceeded")), WAIT_MS);
      signal.addEventListener("abort", cancel, { once: true });
      this.waiting.push(waiter);
    });
  }

  close(): void {
    this.closed = true;
    for (const waiter of [...this.waiting]) waiter.reject(new AdmissionError("Server is closing"));
  }

  private permit(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      this.waiting[0]?.grant();
    };
  }
}
