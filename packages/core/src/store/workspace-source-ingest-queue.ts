export type WorkspaceSourceIngestTask = () => Promise<void>;

/**
 * Keeps source registration independent from document-engine work.
 *
 * The queue owns ordering and rejection handling only. The source service
 * owns persistence and knows how to update a source when a task settles.
 */
export class WorkspaceSourceIngestQueue {
  private tail: Promise<void> = Promise.resolve();
  private readonly tasks = new Map<string, Promise<void>>();

  enqueue(sourceId: string, task: WorkspaceSourceIngestTask): void {
    if (this.tasks.has(sourceId)) return;
    const run = this.tail.then(task);
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    this.tasks.set(sourceId, run);
    void run.then(
      () => this.removeSettled(sourceId, run),
      () => this.removeSettled(sourceId, run),
    );
  }

  waitForIdle(): Promise<void> {
    return this.tail;
  }

  private removeSettled(sourceId: string, task: Promise<void>): void {
    if (this.tasks.get(sourceId) === task) this.tasks.delete(sourceId);
  }
}
