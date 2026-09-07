/** At most one in-flight refresh and one latest trailing refresh. No result cache. */
export class CoalescedRefresh<T> {
  private active: Promise<T> | undefined;
  private pending: (() => Promise<T>) | undefined;

  run(task: () => Promise<T>): Promise<T> {
    this.pending = task;
    if (this.active) return this.active;
    this.active = Promise.resolve().then(async () => {
      let value!: T;
      try {
        while (this.pending) {
          const next = this.pending;
          this.pending = undefined;
          value = await next();
        }
        return value;
      } finally { this.active = undefined; this.pending = undefined; }
    });
    return this.active;
  }

  clearPending(): void { this.pending = undefined; }
}
