import { inspect } from 'node:util';
import { mkdirSync } from 'node:fs';
import { app } from 'electron';
import {
  appendAppLog,
  buildAxDataPaths,
  enableAppFileLog,
  setAxDataPaths,
  type AppLogLevel,
} from '@ax-studio/core';
import { resolveDesktopDataRoot } from './data-paths.js';

function formatConsoleArgs(args: unknown[]): string {
  return args
    .map((value) => {
      if (typeof value === 'string') return value;
      if (value instanceof Error) return value.stack || value.message;
      return inspect(value, { depth: 4, breakLength: 120, maxArrayLength: 20 });
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function wrapConsole(level: AppLogLevel, original: (...args: unknown[]) => void) {
  return (...args: unknown[]) => {
    const message = formatConsoleArgs(args);
    if (message) appendAppLog(level, message);
    original.apply(console, args);
  };
}

/** Tee main-process console and app logs into `<dataRoot>/logs/ax-studio-YYYY-MM-DD.log`. */
export function installDesktopFileLog(): string {
  const paths = buildAxDataPaths(resolveDesktopDataRoot());
  mkdirSync(paths.logs, { recursive: true });
  setAxDataPaths(paths);
  enableAppFileLog();

  console.log = wrapConsole('info', console.log.bind(console)) as typeof console.log;
  console.info = wrapConsole('info', console.info.bind(console)) as typeof console.info;
  console.warn = wrapConsole('warn', console.warn.bind(console)) as typeof console.warn;
  console.error = wrapConsole('error', console.error.bind(console)) as typeof console.error;

  appendAppLog('info', 'desktop start', {
    packaged: app.isPackaged,
    pid: process.pid,
    logs: paths.logs,
  });
  return paths.logs;
}
