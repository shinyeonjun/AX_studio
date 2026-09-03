import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from 'electron';
import { applyDesktopAppIdentity } from './data-paths.js';
import { installDesktopFileLog } from './file-log.js';
import {
  registerDesktopInstanceGuards,
  registerDesktopShutdown,
} from './startup/lifecycle.js';
import { registerDesktopReadyHandler } from './startup/ready.js';

process.env.AX_SCAN_WORKER_PATH = join(dirname(fileURLToPath(import.meta.url)), 'scan-worker.js');

if (!app.isPackaged) {
  app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
}
applyDesktopAppIdentity();
installDesktopFileLog();
registerDesktopInstanceGuards();
registerDesktopReadyHandler();
registerDesktopShutdown();
