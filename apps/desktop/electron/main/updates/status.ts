/** What the app knows about a newer version; shared with the renderer over IPC. */
export type UpdateStatus =
  | { state: 'idle'; currentVersion: string }
  | { state: 'downloading'; currentVersion: string; version: string; percent: number }
  | { state: 'ready'; currentVersion: string; version: string };
