import assert from 'node:assert/strict';

export const CALCULATED_OUTPUT = { version: 1, fields: [{ path: 'synthetic.total', label: 'Synthetic total', valueJson: '731' }] };
export const TAIL_MESSAGES = { interrupted: 'AX interrupted append-only tail', pending: 'AX pending append-only tail' };

export function retentionCheckpointName(phase) {
  assert(['initial', 'final'].includes(phase), 'Only owned initial/final retention checkpoints are allowed');
  return `uninstall-retention-${phase}.json`;
}

export function assertProcessedPdfSource(source, document) {
  assert.equal(source.status, 'ready', 'A queued PDF is not worker acceptance');
  assert(source.documentArtifactId, 'The real worker must persist its document artifact');
  assert.equal(source.summary?.pageCount, 1);
  assert(source.summary.chunkCount > 0, 'The worker must extract real text');
  assert(typeof source.engine === 'string' && !/mock|fake/i.test(source.engine), 'A real engine is required');
  assert(JSON.stringify(document).includes('AX installed synthetic PDF'), 'Parsed document lost the synthetic text');
}

export function assertUpgradeObservation(observation) {
  assert.equal(observation.producer.sourceSha, '0ba5e22f54cc9fe2bb777f085290bb03de5f457b');
  assert.equal(observation.producer.version, '0.1.0-preview.1');
  assert.equal(observation.producer.installedAppPersisted, true, 'Preview installed app must save its own DB');
  assert.equal(observation.rawPreserved, true, 'Raw output_json and append-only tails must survive');
  for (const path of ['getExecution', 'listExecutions']) {
    assert.deepEqual(observation[path].output, CALCULATED_OUTPUT, `${path} lost output_json`);
    for (const [kind, message] of Object.entries(TAIL_MESSAGES)) {
      assert(observation[path][kind].some(entry => entry.message === message), `${path} lost ${kind} log tail`);
    }
  }
  assert.equal(observation.hasOutput, true, 'State must retain hasOutput for lazy loading');
  assert.deepEqual(observation.ipcOutput, CALCULATED_OUTPUT, 'Real preload/IPC must load calculated output');
  assert.equal(observation.renderedOutput, '731', 'CalculatedOutput must render the retained value');
  assert.equal(observation.pendingTailVisible, true, 'The pending log tail must reach the real activity UI');
}
