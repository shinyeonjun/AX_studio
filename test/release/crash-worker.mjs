import { openCore } from './fixtures.mjs';

const [dataRoot, baseUrl, approvalId] = process.argv.slice(2);
const core = await openCore(dataRoot, baseUrl);
if (approvalId) await core.runtime.continueAfterApproval(approvalId);
else await core.runtime.executeWorkflow(core.store.getWorkflow('release-delivery'), { triggerType: 'schedule' });
// The parent must kill the process while the fixture is holding the real HTTP response.
throw new Error('crash_window_was_not_held');
