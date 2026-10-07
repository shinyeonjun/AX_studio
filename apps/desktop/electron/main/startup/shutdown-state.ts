/** Set once quitting begins; read by anything that must not start new work against the core. */
let shuttingDown = false;

export function markDesktopShuttingDown(): void {
  shuttingDown = true;
}

export function isDesktopShuttingDown(): boolean {
  return shuttingDown;
}
