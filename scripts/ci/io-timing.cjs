// CI diagnostic for issue #162 (Windows Desktop unit-test timeouts): preloaded with
// NODE_OPTIONS=--require, it records how long synchronous file operations and event-loop
// stalls take in every Node process and worker thread, without changing what the tests do.
// Each process writes its numbers to AX_IO_TIMING_DIR; scripts/ci/io-timing-report.mjs sums them.
'use strict';

const dir = process.env.AX_IO_TIMING_DIR;
if (dir) {
  const fs = require('node:fs');
  const path = require('node:path');
  const { threadId } = require('node:worker_threads');
  const SLOW_OP_MS = 250;
  const LOOP_TICK_MS = 100;
  const original = { writeFileSync: fs.writeFileSync, mkdirSync: fs.mkdirSync };
  const stats = { pid: process.pid, threadId, argv: process.argv.slice(1, 3).map((arg) => path.basename(arg)), ops: {}, slow: [], maxLoopGapMs: 0, loopGaps: [] };

  for (const name of ['fsyncSync', 'fdatasyncSync', 'renameSync', 'openSync', 'closeSync', 'writeSync', 'writeFileSync', 'readFileSync', 'rmSync', 'unlinkSync', 'copyFileSync']) {
    const operation = fs[name];
    if (typeof operation !== 'function') continue;
    fs[name] = function timed(...args) {
      const startedAt = performance.now();
      try {
        return operation.apply(this, args);
      } finally {
        const ms = performance.now() - startedAt;
        const entry = (stats.ops[name] ??= { count: 0, ms: 0, maxMs: 0 });
        entry.count += 1;
        entry.ms += ms;
        entry.maxMs = Math.max(entry.maxMs, ms);
        if (ms >= SLOW_OP_MS && stats.slow.length < 200) {
          const target = typeof args[0] === 'string' ? path.basename(args[0]) : typeof args[0];
          stats.slow.push({ op: name, target, ms: Math.round(ms), at: new Date().toISOString() });
        }
      }
    };
  }
  require('node:module').syncBuiltinESMExports();

  let last = performance.now();
  const out = path.join(dir, `${process.pid}-${threadId}.json`);
  const flush = () => {
    try {
      original.mkdirSync(dir, { recursive: true });
      original.writeFileSync(out, JSON.stringify(stats));
    } catch { /* Diagnostics never fail a test. */ }
  };
  setInterval(() => {
    const now = performance.now();
    const gap = now - last - LOOP_TICK_MS;
    last = now;
    if (gap > stats.maxLoopGapMs) stats.maxLoopGapMs = Math.round(gap);
    if (gap >= 1000 && stats.loopGaps.length < 100) stats.loopGaps.push({ ms: Math.round(gap), at: new Date().toISOString() });
  }, LOOP_TICK_MS).unref();
  setInterval(flush, 1000).unref();
  process.on('exit', flush);
}
