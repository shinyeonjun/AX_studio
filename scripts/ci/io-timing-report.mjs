// Prints what scripts/ci/io-timing.cjs recorded (issue #162), plus the machine it ran on:
//   node scripts/ci/io-timing-report.mjs <dir>
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { availableParallelism, cpus, freemem, totalmem } from 'node:os';
import { join } from 'node:path';

const dir = process.argv[2];
const gib = (bytes) => `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
console.log(`machine: ${availableParallelism()} usable CPUs (${cpus()[0]?.model ?? '?'}), memory ${gib(freemem())} free of ${gib(totalmem())}`);
if (!dir || !existsSync(dir)) {
  console.log('no io-timing records');
  process.exit(0);
}

const records = readdirSync(dir).filter((file) => file.endsWith('.json')).flatMap((file) => {
  try {
    return [JSON.parse(readFileSync(join(dir, file), 'utf8'))];
  } catch {
    return [];
  }
});
const totals = {};
for (const record of records) {
  for (const [op, entry] of Object.entries(record.ops)) {
    const total = (totals[op] ??= { count: 0, ms: 0, maxMs: 0 });
    total.count += entry.count;
    total.ms += entry.ms;
    total.maxMs = Math.max(total.maxMs, entry.maxMs);
  }
}
console.log(`${records.length} processes/threads recorded`);
console.log('operation          count    total ms    max ms');
for (const [op, total] of Object.entries(totals).sort((a, b) => b[1].ms - a[1].ms)) {
  console.log(`${op.padEnd(16)} ${String(total.count).padStart(7)} ${String(Math.round(total.ms)).padStart(11)} ${String(Math.round(total.maxMs)).padStart(9)}`);
}
const slow = records.flatMap((record) => record.slow.map((entry) => ({ ...entry, pid: record.pid, threadId: record.threadId }))).sort((a, b) => b.ms - a.ms);
console.log(`slow operations (>= 250 ms): ${slow.length}`);
for (const entry of slow.slice(0, 30)) console.log(`  ${entry.at} ${entry.op} ${entry.target} ${entry.ms} ms (pid ${entry.pid}/${entry.threadId})`);
const gaps = records.flatMap((record) => record.loopGaps.map((gap) => ({ ...gap, pid: record.pid, threadId: record.threadId }))).sort((a, b) => b.ms - a.ms);
console.log(`max event-loop stall: ${Math.max(0, ...records.map((record) => record.maxLoopGapMs))} ms; stalls >= 1 s: ${gaps.length}`);
for (const gap of gaps.slice(0, 20)) console.log(`  ${gap.at} ${gap.ms} ms (pid ${gap.pid}/${gap.threadId}) ${gap.file ?? '?'} > ${gap.test ?? '?'}`);
